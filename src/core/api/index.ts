import { z } from 'zod';
import type { DombotApi, DomainTarget } from '../../shared/ipc';
import { clearAll } from '../services/cache';
import { applyDomainOp } from '../services/domain-ops';
import {
  cancelBulk,
  getBulkJob,
  startBulk,
  stepBulk,
} from '../services/bulk-jobs';
import {
  assignFolder,
  createFolder,
  deleteFolder,
  getFolders,
  updateFolder,
} from '../services/folders';
import { setManualPrice } from '../services/pricing';
import {
  getCachedDetail,
  getCachedPortfolio,
  getConfiguredRegistrars,
  getDomainDetail,
  getPortfolio,
  getPortfolioPricing,
  getRegistrarClient,
  getRegistrarCredentialValues,
  getRegistrarFeatures,
  getRegistrarMetadata,
  saveRegistrarCredentials,
  setRegistrarEnabledCached,
  syncRegistrar,
} from '../services/registrars';
import { getSettings, updateSettings } from '../services/settings';
import { restartAutoSync } from '../services/auto-sync';
import { getRevisions, trackRevisions } from '../revision';
import {
  listMcpClients,
  listPendingApprovals,
  resolvePending,
  revokeMcpClient,
} from '../mcp/oauth';
import * as s from './schemas';

// The API method table: one entry per request/response method of `DombotApi`,
// each with a zod schema for its arguments and the handler. Hosts generate
// their transport from it — Electron loops it into `ipcMain.handle`, the web
// host into an HTTP route — so the contract, its validation, and its behavior
// live in exactly one place. Event subscriptions (`onX`) aren't methods; each
// host wires those itself.
//
// `coreMethods` covers everything host-agnostic. A host supplies the rest
// (`getAppInfo`, `saveCsv`, the MCP approval methods…) as its own table and
// merges the two; `ApiTable` makes the compiler check the union is complete.

/** The request/response methods of DombotApi (everything but `onX`). */
export type ApiMethodName = {
  [K in keyof DombotApi]: DombotApi[K] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? K
    : never;
}[keyof DombotApi];

type Args<K extends ApiMethodName> = Parameters<DombotApi[K]>;
type Result<K extends ApiMethodName> = Awaited<ReturnType<DombotApi[K]>>;

export interface ApiMethod<K extends ApiMethodName = ApiMethodName> {
  /** Tuple schema for the argument list. Trailing optional args may be omitted. */
  args: z.ZodTuple<[z.ZodTypeAny, ...z.ZodTypeAny[]]> | z.ZodTuple<[]>;
  handler: (...args: Args<K>) => Promise<Result<K>> | Result<K>;
}

export type ApiTable = { [K in ApiMethodName]: ApiMethod<K> };

/** Typed constructor: pins `handler`'s signature to the DombotApi method. */
export function method<K extends ApiMethodName>(
  args: ApiMethod<K>['args'],
  handler: ApiMethod<K>['handler'],
): ApiMethod<K> {
  return { args, handler };
}

/** Bad arguments to an API method. `issues` carries zod's detail; the message
 *  is short enough to show a user. */
export class ApiValidationError extends Error {
  constructor(
    readonly method: string,
    readonly issues: z.ZodIssue[],
  ) {
    const detail = issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'args'}: ${i.message}`)
      .join('; ');
    super(`Invalid arguments to ${method} (${detail})`);
    this.name = 'ApiValidationError';
  }
}

/**
 * Validates `rawArgs` against a method's schema and runs it. Omitted trailing
 * arguments are padded with `undefined` so optional parameters behave like
 * they do in a direct call. Throws ApiValidationError on bad input.
 */
export async function invoke<K extends ApiMethodName>(
  name: K,
  entry: ApiMethod<K>,
  rawArgs: unknown[],
): Promise<Result<K>> {
  const arity = entry.args.items.length;
  const padded =
    rawArgs.length < arity
      ? [...rawArgs, ...new Array<undefined>(arity - rawArgs.length)]
      : rawArgs;
  const parsed = entry.args.safeParse(padded);
  if (!parsed.success) throw new ApiValidationError(name, parsed.error.issues);
  return entry.handler(...(parsed.data as Args<K>));
}

/** Throws a plain message when the registrar lacks an extended read feature. */
function requireFeature(target: DomainTarget, feature: string, what: string) {
  if (!getRegistrarFeatures(target.registrar).includes(feature)) {
    throw new Error(`This registrar doesn’t offer ${what} through its API.`);
  }
}

const none = z.tuple([]);

export type CoreMethodName = Exclude<
  ApiMethodName,
  'ping' | 'getAppInfo' | 'openExternal' | 'saveCsv' | 'getMcpInfo'
>;

export const coreMethods: { [K in CoreMethodName]: ApiMethod<K> } = {
  // ── Cache ─────────────────────────────────────────────────────────────────
  // Launch hydration reads only the store — no registrar calls — so the UI can
  // paint the full portfolio the moment it opens, then refresh on demand.
  hydrateFromCache: method(none, async () => {
    // The portfolio/detail/pricing caches were all fetched under registrar
    // credentials. If none are configured now — a fresh install, or every
    // credential removed — that cached data is orphaned: it would paint stale
    // domain counts over a UI that otherwise (correctly) reports no
    // registrars. Drop it and hydrate nothing.
    if (getConfiguredRegistrars().length === 0) {
      clearAll();
      return { portfolio: null, detail: {}, pricing: {} };
    }
    return {
      portfolio: getCachedPortfolio(),
      detail: getCachedDetail(),
      pricing: getPortfolioPricing(),
    };
  }),
  clearAllCaches: method(none, async () => {
    clearAll();
  }),

  // ── Pricing ───────────────────────────────────────────────────────────────
  getPortfolioPricing: method(none, async () => getPortfolioPricing()),
  setManualPrice: method(
    z.tuple([s.registrarName, s.domainName, z.number().nullable()]),
    async (registrar, domain, price) => {
      setManualPrice(registrar, domain, price);
    },
  ),

  // ── Registrars ────────────────────────────────────────────────────────────
  listDynadotDomains: method(none, async () =>
    getRegistrarClient('dynadot').listDomains(),
  ),
  listPortfolio: method(
    z.tuple([z.boolean().optional()]),
    async (refresh = true) => getPortfolio(refresh),
  ),
  syncRegistrar: method(z.tuple([s.registrarName]), async (name) =>
    syncRegistrar(name),
  ),
  getDomainDetail: method(
    z.tuple([s.registrarName, s.domainName, z.boolean().optional()]),
    async (name, domainName, refresh = false) =>
      getDomainDetail(name, domainName, refresh),
  ),
  getRegistrarMetadata: method(none, async () => getRegistrarMetadata()),
  getRegistrarCredentials: method(z.tuple([s.registrarName]), async (name) =>
    getRegistrarCredentialValues(name),
  ),
  saveRegistrarCredentials: method(
    z.tuple([s.registrarName, s.credentialValues]),
    async (name, creds) => {
      await saveRegistrarCredentials(name, creds);
    },
  ),
  setRegistrarEnabled: method(
    z.tuple([s.registrarName, z.boolean()]),
    async (name, enabled) => setRegistrarEnabledCached(name, enabled),
  ),

  // ── Domain operations ─────────────────────────────────────────────────────
  // One method for every per-domain write the table can make. Never rejects
  // for a registrar-side outcome — `DomainOpResult.status` carries it.
  applyDomainOp: method(
    z.tuple([s.domainTarget, s.domainOp]),
    async (target, op) => applyDomainOp(target, op),
  ),
  // Forwarding reads back the per-row dialogs. Live — not part of the cache.
  getUrlForwarding: method(z.tuple([s.domainTarget]), async (target) => {
    requireFeature(target, 'getDomainForwarding', 'URL forwarding');
    return getRegistrarClient(target.registrar).getDomainForwarding(
      target.domainName,
    );
  }),
  getEmailForwarding: method(z.tuple([s.domainTarget]), async (target) => {
    requireFeature(target, 'getEmailForwarding', 'email forwarding');
    return getRegistrarClient(target.registrar).getEmailForwarding(
      target.domainName,
    );
  }),

  // ── Bulk jobs ─────────────────────────────────────────────────────────────
  startBulk: method(
    z.tuple([z.array(s.domainTarget).min(1), s.domainOp]),
    async (targets, op) => startBulk(targets, op),
  ),
  cancelBulk: method(z.tuple([z.string()]), async (jobId) => {
    cancelBulk(jobId);
  }),
  getBulkJob: method(none, async () => getBulkJob()),
  stepBulk: method(z.tuple([z.string()]), async (jobId) => stepBulk(jobId)),

  // ── Folders ───────────────────────────────────────────────────────────────
  getFolders: method(none, async () => getFolders()),
  createFolder: method(z.tuple([s.folderInput]), async (input) =>
    createFolder(input),
  ),
  updateFolder: method(
    z.tuple([z.string(), s.folderPatch]),
    async (id, patch) => {
      updateFolder(id, patch);
    },
  ),
  deleteFolder: method(z.tuple([z.string()]), async (id) => {
    deleteFolder(id);
  }),
  assignFolder: method(
    z.tuple([s.domainKey, z.string().nullable()]),
    async (domainKey, folderId) => {
      assignFolder(domainKey, folderId);
    },
  ),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: method(none, async () => getSettings()),
  updateSettings: method(z.tuple([s.appSettingsPatch]), async (patch) => {
    const next = updateSettings(patch);
    // Apply live: the auto-sync interval may have changed (or been disabled).
    // No-op on a host that never started the timer.
    restartAutoSync();
    return next;
  }),

  // ── Events (polling) ──────────────────────────────────────────────────────
  getRevisions: method(none, async () => getRevisions()),

  // ── MCP pairing ───────────────────────────────────────────────────────────
  // The OAuth state is in the store, so the approval UI works on both hosts;
  // only the server's status (`getMcpInfo`) is host-specific.
  listPendingApprovals: method(none, async () => listPendingApprovals()),
  resolveApproval: method(
    z.tuple([z.string(), z.boolean()]),
    async (id, approve) => {
      resolvePending(id, approve);
    },
  ),
  listMcpClients: method(none, async () => listMcpClients()),
  revokeMcpClient: method(z.tuple([z.string()]), async (clientId) => {
    await revokeMcpClient(clientId);
  }),
};

trackRevisions();
