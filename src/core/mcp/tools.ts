import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OperationResult,
  RegistrarName,
} from '@aoxborrow/registrar-client';
import {
  resolveDomainAccount,
  resolveAccount,
  findRegistrarsForDomain,
  getActiveRegistrars,
  getConfiguredRegistrars,
  getDomainDetail,
  getMergedPortfolio,
  getPortfolio,
  getRegistrarClient,
  getRegistrarMetadata,
  registerDomainCached,
  registrarNames,
  getRenewalPriceLive,
  syncRegistrar,
} from '../services/registrars';
import { accountById } from '../services/accounts';
import { applyDomainOp } from '../services/domain-ops';
import { eventsFor, listEvents } from '../services/domain-events';
import {
  assignFolder,
  createFolder,
  deleteFolder,
  getFolders,
  updateFolder,
} from '../services/folders';
import { broadcastPortfolioChanged } from '../events';
import { assertDomainName, toAscii } from '../../shared/domain-name';
import {
  FOLDER_COLORS,
  HIDDEN_FOLDER_ID,
  type DomainOp,
  type FolderColor,
  type Portfolio,
} from '../../shared/ipc';
import { archiveRows, ownershipByDomain } from '../../shared/ownership';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isStaleAt,
  queryPortfolio,
  resolveFolderId,
  type QueryArgs,
  type QueryResult,
} from './portfolio-query';

// Serialize a service result as a pretty-printed JSON text block — the simplest
// MCP tool payload. (Dates become ISO strings via JSON.stringify.)
function json(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

// Runs a cache-backed write (via a service fn that patches the portfolio/detail
// caches on success) and, when the registrar reports success, notifies open
// windows so an open Domains table reflects the change without a manual Sync.
// The raw OperationResult is returned so the caller sees the provider's message.
async function cachedWrite(op: () => Promise<OperationResult>) {
  const result = await op();
  if (result.success) broadcastPortfolioChanged();
  return json(result);
}

// Runs a per-domain op through the shared dispatcher (services/domain-ops.ts) —
// the exact path the table's row controls use — so capability gating, cache
// patching, and the window notification are identical. Returns the provider's
// message plus the classified `status` (ok / failed / unsupported / …); `success`
// is kept for callers that only check a boolean.
async function domainOp(
  registrar: RegistrarName,
  domain: string,
  op: DomainOp,
  accountId?: string,
) {
  const r = await applyDomainOp(
    { registrar, domainName: domain, accountId },
    op,
  );
  return json({
    accountId: r.target?.accountId ?? accountId,
    registrar,
    success: r.status === 'ok',
    status: r.status,
    message: r.message,
  });
}

// Resolves the registrar for a domain-scoped call. Returns `registrar` verbatim
// when given; otherwise looks the domain up in the cached portfolio. Throws a
// guiding error when the cache can't resolve it — unknown (so the caller can
// sync or pass it explicitly) or ambiguous (a stale cache listing it twice).
function resolveRegistrar(
  domainName: string,
  registrar?: RegistrarName,
  accountId?: string,
): RegistrarName {
  if (accountId && !registrar) return accountById(accountId).registrar;
  if (registrar) return registrar;
  const matches = findRegistrarsForDomain(domainName);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    // A name that left your accounts is in Archive: syncing won't bring it
    // back, so say that instead.
    const key = toAscii(domainName);
    const left = ownershipByDomain(eventsFor(key)).get(key);
    if (left?.label) {
      throw new Error(
        `"${domainName}" is in Archive (${left.label}) and none of your accounts reports it, so there's no registrar to act on. Pass "registrar" if it's in an account DomBot doesn't sync. If it just came back to one of your accounts, run portfolio_sync.`,
      );
    }
    throw new Error(
      `"${domainName}" isn't in the cached portfolio, so its registrar can't be resolved automatically. Pass "registrar" explicitly, or run portfolio_sync if the domain was added recently.`,
    );
  }
  throw new Error(
    `"${domainName}" appears under multiple registrars in the cache (${matches.join(', ')}). Pass "registrar" to disambiguate; if it was transferred, run portfolio_sync to refresh.`,
  );
}

// ── shared parameter schemas ─────────────────────────────────────────────────
//
// Scope is encoded in the tool name prefix and its parameters:
//   portfolio_* → ()                    global / cross-registrar aggregate
//   registrar_* → (registrar)           one provider (registrar required)
//   domain_*    → (domain[, registrar]) one domain you own
//   folder_*    → ([folder])            DomBot's own folders; no registrar calls
// For domain_* tools the registrar is optional: omitted, it's resolved from the
// cached portfolio (you own the domain, so DomBot knows who holds it); pass it
// to skip the lookup, or to act on a name not yet in the cache. registrar_*
// tools still require it — there's no owned domain to resolve from.

const registrar = z
  .enum(registrarNames)
  .describe('Registrar id, e.g. "dynadot" or "godaddy".');

// For domain-scoped tools: the registrar is optional and resolved from the
// cached portfolio when omitted (you own the domain, so DomBot already knows who
// holds it). Pass it to skip the lookup, or for a domain not yet in the cache.
const optionalRegistrar = z
  .enum(registrarNames)
  .optional()
  .describe(
    'Registrar id holding this domain. Optional — resolved from your cached portfolio when omitted. Pass it to skip the lookup, or for a domain not yet synced into the cache.',
  );

const accountId = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Stable account ID from registrar_list. Required when account selection is ambiguous; labels are not selectors.',
  );

const domain = z.string().describe('The domain name, e.g. example.com');

// Read tools that are cache-backed accept this to bypass the cache: fetch live
// and write the result through, so the next read is fresh.
const refreshParam = z
  .boolean()
  .optional()
  .describe('Bypass the cache: fetch live and refresh the cached value.');

// A registrant/admin/tech/billing contact (mirrors registrar-client's Contact).
const contact = z.object({
  firstName: z.string(),
  lastName: z.string(),
  organization: z.string().optional(),
  email: z.string(),
  phone: z.string().describe('International format, e.g. "+1.4805551234"'),
  fax: z.string().optional(),
  address1: z.string(),
  address2: z.string().optional(),
  city: z.string(),
  state: z.string().optional().describe('State/province/region; may be empty'),
  postalCode: z.string(),
  country: z.string().describe('ISO 3166-1 alpha-2 country code, e.g. "US"'),
});

// The four contact roles on a domain; registrant is the legal owner.
const contactSet = z.object({
  registrant: contact.optional(),
  admin: contact.optional(),
  tech: contact.optional(),
  billing: contact.optional(),
});

// A single DNS record in provider-agnostic form.
const dnsRecord = z.object({
  type: z
    .string()
    .describe(
      'Record type, uppercased: A, AAAA, CNAME, MX, TXT, NS, SRV, CAA…',
    ),
  name: z
    .string()
    .describe('Host relative to the zone apex; "@" denotes the apex.'),
  value: z.string().describe('Record data (IP, target host, text, …).'),
  ttl: z.number().int().optional().describe('Time-to-live in seconds.'),
  priority: z.number().int().optional().describe('Priority, for MX and SRV.'),
  weight: z.number().int().optional().describe('Weight, SRV only.'),
  port: z.number().int().optional().describe('Port, SRV only.'),
});

// An alias-style email forward: mail to `alias`@domain redirects to `forwardTo`
// (redirect only — no mailbox is provisioned).
const emailForward = z.object({
  alias: z
    .string()
    .describe(
      'Local part at the domain, e.g. "hello" for hello@example.com. "@" or "*" is a catch-all, where the registrar supports it.',
    ),
  forwardTo: z
    .string()
    .describe('The destination address mail is forwarded to.'),
});

// A URL/domain forward: requests to `host` at the domain redirect to `url`. The
// `masked` type is read-only (get can report it; set rejects it), so the set
// schema offers only the two real redirect styles.
const domainForward = z.object({
  host: z
    .string()
    .describe(
      'Source host relative to the apex; "@" is the apex, "www" the www subdomain.',
    ),
  url: z.string().describe('The destination URL requests are redirected to.'),
  type: z
    .enum(['temporary', 'permanent'])
    .describe(
      'Redirect style: "temporary" (302) or "permanent" (301). Both show the destination URL in the address bar.',
    ),
});

// Consent to a registrar's registration/transfer agreements, where required
// (e.g. GoDaddy). The provider fetches the agreement docs itself; the caller
// only affirms who consented.
const consent = z.object({
  agreedBy: z
    .string()
    .describe(
      'Identifier of the consenting party; registrars that record it expect the user’s IP (e.g. GoDaddy).',
    ),
  agreedAt: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp of consent; defaults to now.'),
});

// Input for registering a new domain. A registrant contact is always required.
const registerInput = z.object({
  years: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Registration length in years (defaults to 1).'),
  contacts: contactSet
    .extend({ registrant: contact })
    .describe('Contacts for the registration; a registrant is required.'),
  nameservers: z
    .array(z.string())
    .optional()
    .describe('Initial nameservers; omit to use the registrar’s defaults.'),
  privacy: z
    .boolean()
    .optional()
    .describe('Enable WHOIS privacy, where supported.'),
  autoRenew: z.boolean().optional().describe('Enable auto-renew.'),
  consent: consent.optional(),
});

// Input for transferring a domain in. The EPP/auth code is always required.
const transferInput = z.object({
  authCode: z
    .string()
    .describe('The EPP/authorization code from the current registrar.'),
  years: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Registration length to add on transfer, in years.'),
  contacts: contactSet
    .optional()
    .describe('Contacts, where the registrar requires them.'),
  consent: consent.optional(),
  privacy: z.boolean().optional().describe('Enable WHOIS privacy on transfer.'),
  autoRenew: z.boolean().optional().describe('Enable auto-renew on transfer.'),
});

// ── portfolio_query ──────────────────────────────────────────────────────────
//
// Reads the *cached* portfolio (assembled from the per-registrar sync slices,
// merged with any cached per-domain detail) rather than hitting every registrar
// live — the whole portfolio can be 10k+ domains. `refresh` re-syncs first for a
// caller that needs fresh data.

const querySort = z
  .enum(['domainName', 'registrar', 'expirationDate', 'createdDate'])
  .describe('Field to sort by (default expirationDate).');

// Shared filter/sort/page params for portfolio_query. Every filter is optional
// and ANDed together; an omitted filter doesn't constrain the results.
const queryShape = {
  ownership: z
    .enum(['owned', 'archive', 'all'])
    .optional()
    .describe(
      'Which names to cover, like the Domains page’s Owned / Archive switch (default "owned"). "owned": names you hold, Hidden ones included. "archive": names you sold, dropped, or archived, or that left your accounts; rows say why in `archiveLabel`. "all": both.',
    ),
  accountId,
  registrar: registrar.optional().describe('Only this registrar.'),
  tld: z
    .string()
    .optional()
    .describe('Only this TLD, e.g. "com" or ".com" (no leading dot needed).'),
  folder: z
    .string()
    .optional()
    .describe(
      'Only domains in this folder — a folder name or id, or "Hidden" for the built-in Hidden folder. Unknown folder → no rows.',
    ),
  nameContains: z
    .string()
    .optional()
    .describe(
      'Only domains whose name contains this substring (case-insensitive).',
    ),
  nameserverContains: z
    .string()
    .optional()
    .describe(
      'Only domains with a nameserver containing this substring (case-insensitive). Needs the domain enriched with detail; un-enriched domains without list nameservers are excluded.',
    ),
  autoRenew: z.boolean().optional().describe('Filter by auto-renew on/off.'),
  locked: z.boolean().optional().describe('Filter by transfer lock on/off.'),
  privacy: z.boolean().optional().describe('Filter by WHOIS privacy on/off.'),
  status: z
    .string()
    .optional()
    .describe(
      'Only domains whose status contains this text (case-insensitive), e.g. "expired".',
    ),
  expiresBefore: z
    .string()
    .optional()
    .describe(
      'Only domains expiring before this date (ISO 8601). Excludes domains with no known expiry.',
    ),
  expiresAfter: z
    .string()
    .optional()
    .describe(
      'Only domains expiring on/after this date (ISO 8601). Excludes domains with no known expiry.',
    ),
  expiringWithinDays: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Only domains expiring within this many days from now (includes already-expired). Excludes domains with no known expiry.',
    ),
  sort: querySort.optional(),
  order: z
    .enum(['asc', 'desc'])
    .optional()
    .describe('Sort direction (default asc). Null dates always sort last.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `Max rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
    ),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Rows to skip, for paging (default 0).'),
};

/** Gathers the cache reads and runs the pure query logic (filter/sort/page). */
function runQuery(args: QueryArgs): QueryResult {
  const { domains, fetchedAt, registrars, errors } = getMergedPortfolio();
  const { folders, assignments } = getFolders();
  const ownership = ownershipByDomain(listEvents());
  return queryPortfolio(
    // Names in Archive that no account reports come from the event log, as
    // in the Archive view.
    [...domains, ...archiveRows(ownership, domains, getRegistrarMetadata())],
    folders,
    assignments,
    { fetchedAt, registrars, errors },
    args,
    ownership,
  );
}

/** Compact per-registrar sync status for the sync tools: what synced, how many
 *  domains it holds, when, and any per-registrar error, plus the aggregate
 *  freshness. Derives the per-registrar counts from the cache metadata. */
function syncSummary(portfolio: Portfolio) {
  const meta = getRegistrarMetadata();
  const registrars = meta
    .filter((r) => r.configured && r.enabled)
    .map((r) => ({
      registrar: r.name,
      accountId: r.accountId,
      accountLabel: r.accountLabel,
      ...r.sync,
    }));
  return {
    total: portfolio.domains.length,
    fetchedAt: portfolio.fetchedAt,
    stale: isStaleAt(portfolio.fetchedAt),
    registrars,
    errors: portfolio.errors,
  };
}

// ── folders ──────────────────────────────────────────────────────────────────
//
// Folders are DomBot-local (services/folders.ts, the same store Settings →
// Folders and the Domains table write), so these tools never reach a registrar.
// A folder is named by its name or id; "Hidden" is the built-in folder, which
// can hold domains but can't be renamed or deleted. Names are matched
// case-insensitively, so the tools keep them unique.

const HIDDEN_NAME = 'Hidden';

const folderParam = z
  .string()
  .min(1)
  .describe('A folder name or id, as folder_list reports it.');

// Same limits as the app's folder form (api/schemas.ts folderInput).
const folderName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('The folder name, unique among your folders (case-insensitive).');

type FolderRef = { id: string; name: string };

/** The folder with this id (Hidden included), or null. */
function folderById(id: string | null | undefined): FolderRef | null {
  if (!id) return null;
  if (id === HIDDEN_FOLDER_ID) return { id, name: HIDDEN_NAME };
  const folder = getFolders().folders.find((f) => f.id === id);
  return folder ? { id: folder.id, name: folder.name } : null;
}

/** The folder a name or id names, or a guiding error. "Hidden" resolves to
 *  the built-in folder. */
function resolveFolder(param: string): FolderRef {
  const folder = folderById(resolveFolderId(param, getFolders().folders));
  if (!folder) {
    throw new Error(
      `No folder named "${param}". Call folder_list for your folders' names and ids, or folder_create to make it.`,
    );
  }
  return folder;
}

/** resolveFolder, refusing the built-in Hidden folder (for rename/delete). */
function resolveUserFolder(param: string, action: string) {
  const folder = resolveFolder(param);
  if (folder.id === HIDDEN_FOLDER_ID) {
    throw new Error(`Hidden is a built-in folder and can't be ${action}.`);
  }
  return folder;
}

/** Throws when `name` would collide with another folder (or Hidden). */
function assertFolderNameFree(name: string, exceptId?: string): void {
  const lower = name.toLowerCase();
  if (lower === HIDDEN_NAME.toLowerCase()) {
    throw new Error(`"${name}" is the built-in Hidden folder's name.`);
  }
  const clash = getFolders().folders.find(
    (f) => f.id !== exceptId && f.name.toLowerCase() === lower,
  );
  if (clash) {
    throw new Error(`A folder named "${clash.name}" already exists.`);
  }
}

/** Domains assigned to each folder id. */
function folderCounts(assignments: Record<string, string>) {
  const counts: Record<string, number> = {};
  for (const id of Object.values(assignments))
    counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

/** Folder writes don't touch the portfolio cache, but the same event tells an
 *  open window to re-read folders (store/app.ts applyPortfolioCacheUpdate). */
function folderWrite<T>(result: T) {
  broadcastPortfolioChanged();
  return json(result);
}

/**
 * Registers the MCP portfolio tools. Each calls into the shared `services/`
 * layer — the same lower-level core the UI's IPC handlers use — and shapes its
 * own output. Tools group by scope prefix (portfolio / registrar / domain / folder).
 */
export function registerTools(server: McpServer): void {
  // ── Portfolio / account (no scope params) ──────────────────────────────────

  server.registerTool(
    'registrar_list',
    {
      title: 'List registrars',
      description:
        'List every built-in registrar id, which have credentials configured, and which are active (configured and enabled). A disabled registrar keeps its credentials but does not sync or contribute domains.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      json({
        all: registrarNames,
        accounts: getRegistrarMetadata().map((r) => ({
          accountId: r.accountId,
          registrar: r.name,
          label: r.accountLabel,
          configured: r.configured,
          enabled: r.enabled,
          // Whether its API traffic goes through the fixed IP proxy. Never the
          // proxy's address or credentials.
          proxy: Boolean(r.proxy),
          sync: r.sync,
        })),
        configured: getConfiguredRegistrars(),
        active: getActiveRegistrars(),
      }),
  );

  server.registerTool(
    'portfolio_query',
    {
      title: 'Query portfolio',
      description:
        'List, search, and filter your whole portfolio across every configured registrar — the primary way to read the portfolio. Covers the names you own by default; pass `ownership` for Archive (sold, dropped, archived, or gone from your accounts) or both. Filter by registrar, TLD, folder, name, nameserver, auto-renew/lock/privacy, status, and expiry (before/after a date or within N days); sort and page the results. With no filters it returns every name you own (paged), so use it as a plain list too. Each row says `ownership` (owned/archive), `archiveLabel`, `hidden` (in the Hidden folder: still yours, still renews), and `inAccount` (false for an Archive name no account reports, which the domain_* tools can’t act on). Reads the local cache only — no registrar calls; run portfolio_sync first (or whenever this reports stale:true or an empty result) to refresh it. Returns { total, fetchedAt, stale, registrars, errors, rows }: `total` is the full match count before paging (page with `limit`/`offset`); `errors` lists any registrar whose sync failed, so a non-empty `errors` means the result may be incomplete. Rows carry only the fields you need — call domain_get for a single domain’s full record.',
      inputSchema: queryShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => json(runQuery(args)),
  );

  server.registerTool(
    'portfolio_sync',
    {
      title: 'Sync portfolio',
      description:
        'Re-sync every configured registrar and refresh the local cache that portfolio_query and the domain_* reads serve from. A live network pass across all registrars — call it to pull fresh data (e.g. on first use, or when portfolio_query reports stale:true or comes back empty), then read with portfolio_query. Returns a per-registrar summary: domain counts, last-synced times, and any sync errors.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const portfolio = await getPortfolio(true);
      broadcastPortfolioChanged();
      return json(syncSummary(portfolio));
    },
  );

  // ── Folders (DomBot-local; no registrar calls) ─────────────────────────────

  server.registerTool(
    'folder_list',
    {
      title: 'List folders',
      description:
        'List your folders — DomBot’s own groupings of domains, as in Settings → Folders — with each one’s id, name, description, color, and how many domains it holds. Includes the built-in Hidden folder (id "__hidden__", `builtIn: true`), which holds names you own but keep out of the usual list. Use a folder’s name or id with folder_rename, folder_delete, domain_set_folder, and portfolio_query’s `folder` filter.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { folders, assignments } = getFolders();
      const counts = folderCounts(assignments);
      return json({
        folders: [
          ...folders.map((f) => ({
            id: f.id,
            name: f.name,
            description: f.description,
            color: f.color,
            builtIn: false,
            domainCount: counts[f.id] ?? 0,
          })),
          {
            id: HIDDEN_FOLDER_ID,
            name: HIDDEN_NAME,
            description: 'Names you own but keep out of the usual list.',
            color: null,
            builtIn: true,
            domainCount: counts[HIDDEN_FOLDER_ID] ?? 0,
          },
        ],
      });
    },
  );

  server.registerTool(
    'folder_create',
    {
      title: 'Create a folder',
      description:
        'Create a folder to group domains in. The name must not match an existing folder (case-insensitive) or "Hidden". Returns the new folder with its id; assign domains to it with domain_set_folder.',
      inputSchema: {
        name: folderName,
        description: z
          .string()
          .max(500)
          .optional()
          .describe('A short description (default none).'),
        color: z
          .enum(FOLDER_COLORS as [FolderColor, ...FolderColor[]])
          .optional()
          .describe('The folder’s color in the app (default "blue").'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, description, color }) => {
      assertFolderNameFree(name);
      const folder = createFolder({
        name,
        description: description?.trim() ?? '',
        color: color ?? 'blue',
      });
      return folderWrite({ ...folder, builtIn: false, domainCount: 0 });
    },
  );

  server.registerTool(
    'folder_rename',
    {
      title: 'Rename a folder',
      description:
        'Rename a folder. Its domains stay in it. The built-in Hidden folder can’t be renamed, and the new name must not match another folder (case-insensitive).',
      inputSchema: { folder: folderParam, name: folderName },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ folder, name }) => {
      const target = resolveUserFolder(folder, 'renamed');
      assertFolderNameFree(name, target.id);
      updateFolder(target.id, { name });
      return folderWrite({ id: target.id, name, previousName: target.name });
    },
  );

  server.registerTool(
    'folder_delete',
    {
      title: 'Delete a folder',
      description:
        'Delete a folder. Its domains aren’t deleted or changed at any registrar — they just go back to no folder. The built-in Hidden folder can’t be deleted. Returns how many domains were unassigned.',
      inputSchema: { folder: folderParam },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ folder }) => {
      const target = resolveUserFolder(folder, 'deleted');
      const unassigned = folderCounts(getFolders().assignments)[target.id] ?? 0;
      deleteFolder(target.id);
      return folderWrite({ ...target, deleted: true, unassigned });
    },
  );

  // ── Registrar-level (registrar required) ───────────────────────────────────

  server.registerTool(
    'registrar_test',
    {
      title: 'Test registrar connection',
      description:
        'At one registrar: verify the configured credentials work (a connection test).',
      inputSchema: { accountId, registrar },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar }) =>
      json(await getRegistrarClient(registrar, accountId).testConnection()),
  );

  server.registerTool(
    'registrar_domains',
    {
      title: 'List a registrar’s domains',
      description: 'At one registrar: list every domain in the account.',
      inputSchema: { accountId, registrar },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar }) => {
      const account = resolveAccount(registrar, accountId);
      const domains = await getRegistrarClient(
        registrar,
        account.id,
      ).listDomains();
      return json(
        domains.map((d) => ({
          ...d,
          registrar,
          accountId: account.id,
          accountLabel: account.label,
        })),
      );
    },
  );

  server.registerTool(
    'registrar_sync',
    {
      title: 'Sync a registrar',
      description:
        'Re-sync one registrar’s domains into the local cache — a targeted refresh (e.g. after registering a domain, or when just one registrar is stale) that avoids a full portfolio_sync. Returns the same per-registrar summary as portfolio_sync.',
      inputSchema: { accountId, registrar },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar }) => {
      const portfolio = await syncRegistrar(registrar, accountId);
      broadcastPortfolioChanged();
      return json(syncSummary(portfolio));
    },
  );

  server.registerTool(
    'registrar_check_availability',
    {
      title: 'Check domain availability',
      description:
        'At one registrar: check whether one or more domains are available to register.',
      inputSchema: {
        accountId,
        registrar,
        domains: z
          .array(z.string())
          .min(1)
          .describe(
            'Domain names to check, e.g. ["example.com", "example.net"]',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domains }) =>
      json(
        await getRegistrarClient(registrar, accountId).checkAvailability(
          domains,
        ),
      ),
  );

  server.registerTool(
    'registrar_pricing',
    {
      title: 'Get TLD pricing',
      description:
        'At one registrar: look up live registration/renewal/transfer pricing for a TLD (or a specific domain). This is the registrar’s own quote — for DomBot’s estimated renewal price use domain_renewal_price.',
      inputSchema: {
        accountId,
        registrar,
        tld: z
          .string()
          .describe('A TLD ("com") or a full domain ("example.com").'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, tld }) =>
      json(await getRegistrarClient(registrar, accountId).getPricing(tld)),
  );

  server.registerTool(
    'registrar_register_domain',
    {
      title: 'Register a domain',
      description:
        'At one registrar: register a new domain. This creates a registration and costs money.',
      inputSchema: { accountId, registrar, domain, input: registerInput },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ accountId, registrar, domain, input }) =>
      cachedWrite(() =>
        registerDomainCached(
          registrar,
          domain,
          input,
          resolveAccount(registrar, accountId).id,
        ),
      ),
  );

  server.registerTool(
    'registrar_transfer_domain',
    {
      title: 'Transfer a domain in',
      description:
        'At one registrar: transfer a domain in using its EPP/auth code. This costs money.',
      inputSchema: { accountId, registrar, domain, input: transferInput },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ accountId, registrar, domain, input }) =>
      json(
        await getRegistrarClient(registrar, accountId).transferIn(
          domain,
          input,
        ),
      ),
  );

  // ── Domain-level (domain required; registrar auto-resolved from cache) ──────

  server.registerTool(
    'domain_get',
    {
      title: 'Get domain',
      description:
        'For a single domain: its full record — status, creation/expiration dates, auto-renew, transfer lock, WHOIS privacy, and nameservers. Served from the local detail cache when fresh; otherwise fetched live and written through. Pass `refresh` to force a live fetch.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        refresh: refreshParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain, refresh }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      const detail = await getDomainDetail(
        r,
        domain,
        refresh ?? false,
        account.id,
      );
      // getDomainDetail returns null only when neither the registrar nor the
      // registry could resolve anything — fall back to a live getDomain so the
      // error (or record) still comes from the provider.
      return json({
        ...(detail ??
          (await getRegistrarClient(r, account.id).getDomain(domain))),
        registrar: r,
        accountId: account.id,
        accountLabel: account.label,
      });
    },
  );

  server.registerTool(
    'domain_set_folder',
    {
      title: 'Set a domain’s folder',
      description:
        'For a single domain: put it in a folder (by name or id; "Hidden" for the built-in Hidden folder), or pass `folder: null` to take it out of its folder. A domain is in at most one folder, so this replaces any current one. DomBot-local — no registrar call. The domain must be in your portfolio (owned or Archive); run portfolio_sync if it was added recently.',
      inputSchema: {
        domain,
        folder: folderParam
          .nullable()
          .describe(
            'A folder name or id from folder_list, "Hidden", or null for no folder.',
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ domain, folder }) => {
      const key = assertDomainName(domain);
      const known =
        getMergedPortfolio().domains.some(
          (d) => toAscii(d.domainName) === key,
        ) || eventsFor(key).length > 0;
      if (!known) {
        throw new Error(
          `"${domain}" isn't in your portfolio. Run portfolio_sync if it was added recently.`,
        );
      }
      const previous = folderById(getFolders().assignments[key]);
      const target = folder === null ? null : resolveFolder(folder);
      assignFolder(key, target?.id ?? null);
      return folderWrite({ domain: key, folder: target, previous });
    },
  );

  server.registerTool(
    'domain_contacts_get',
    {
      title: 'Get domain contacts',
      description:
        'For a single domain: read its registrant, admin, tech, and billing contacts.',
      inputSchema: { accountId, registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return json(await getRegistrarClient(r, account.id).getContacts(domain));
    },
  );

  server.registerTool(
    'domain_renew',
    {
      title: 'Renew a domain',
      description:
        'For a single domain: renew it (extend its registration). This costs money.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        years: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of years to renew (defaults to 1).'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ accountId, registrar, domain, years }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return domainOp(
        r,
        domain,
        { kind: 'renew', years: years ?? 1 },
        account.id,
      );
    },
  );

  server.registerTool(
    'domain_nameservers_get',
    {
      title: 'Get nameservers',
      description:
        'For a single domain: its nameservers. Served from the local detail cache when fresh; otherwise fetched live (registrar, then the public registry) and written through. Pass `refresh` to force a live fetch.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        refresh: refreshParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain, refresh }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      const detail = await getDomainDetail(
        r,
        domain,
        refresh ?? false,
        account.id,
      );
      return json(
        detail?.nameservers ??
          (await getRegistrarClient(r, account.id).getNameservers(domain)),
      );
    },
  );

  server.registerTool(
    'domain_nameservers_set',
    {
      title: 'Set nameservers',
      description:
        'For a single domain: replace its nameservers with the full set given.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        nameservers: z
          .array(z.string())
          .min(1)
          .describe(
            'The full nameserver set, e.g. ["ns1.example.net", "ns2.example.net"]',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ accountId, registrar, domain, nameservers }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return domainOp(
        r,
        domain,
        { kind: 'nameservers', nameservers },
        account.id,
      );
    },
  );

  server.registerTool(
    'domain_dns_get',
    {
      title: 'Get DNS records',
      description: 'For a single domain: read its DNS records.',
      inputSchema: { accountId, registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return json(
        await getRegistrarClient(r, account.id).getDnsRecords(domain),
      );
    },
  );

  server.registerTool(
    'domain_dns_set',
    {
      title: 'Set DNS records',
      description:
        'For a single domain: replace its DNS records with the full set given. This is a full replace — any record you omit is removed, and an empty array clears the zone.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        records: z
          .array(dnsRecord)
          .describe('The complete DNS record set to write.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    // DNS records aren't part of the portfolio/detail cache (nothing in the
    // Domains table shows them), so there's no cached field to patch — but we
    // still emit the change event for consistency with the other writes.
    async ({ accountId, registrar, domain, records }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return cachedWrite(() =>
        getRegistrarClient(r, account.id).setDnsRecords(domain, records),
      );
    },
  );

  server.registerTool(
    'domain_contacts_set',
    {
      title: 'Set domain contacts',
      description:
        'For a single domain: update its contacts. Provide only the roles you want to change (registrant, admin, tech, billing).',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        contacts: contactSet,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    // Contacts aren't part of the portfolio/detail cache; emit the event for
    // consistency (see domain_dns_set).
    async ({ accountId, registrar, domain, contacts }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return cachedWrite(() =>
        getRegistrarClient(r, account.id).updateContacts(domain, contacts),
      );
    },
  );

  server.registerTool(
    'domain_set_privacy',
    {
      title: 'Set WHOIS privacy',
      description: 'For a single domain: enable or disable WHOIS privacy.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        enabled: z
          .boolean()
          .describe('true to enable WHOIS privacy, false to disable'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ accountId, registrar, domain, enabled }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return domainOp(r, domain, { kind: 'privacy', enabled }, account.id);
    },
  );

  server.registerTool(
    'domain_set_autorenew',
    {
      title: 'Set auto-renew',
      description: 'For a single domain: enable or disable auto-renew.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        enabled: z
          .boolean()
          .describe('true to enable auto-renew, false to disable'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ accountId, registrar, domain, enabled }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return domainOp(r, domain, { kind: 'autoRenew', enabled }, account.id);
    },
  );

  server.registerTool(
    'domain_set_lock',
    {
      title: 'Set domain lock',
      description:
        'For a single domain: lock or unlock it (registrar transfer lock).',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        locked: z.boolean().describe('true to lock, false to unlock'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ accountId, registrar, domain, locked }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return domainOp(r, domain, { kind: 'lock', locked }, account.id);
    },
  );

  server.registerTool(
    'domain_email_forwarding_get',
    {
      title: 'Get email forwarding',
      description:
        'For a single domain: read its alias-style email forwarding rules (mail sent to an alias at the domain redirects to a destination address). Not supported by every registrar.',
      inputSchema: { accountId, registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return json(
        await getRegistrarClient(r, account.id).getEmailForwarding(domain),
      );
    },
  );

  server.registerTool(
    'domain_email_forwarding_set',
    {
      title: 'Set email forwarding',
      description:
        'For a single domain: replace its email forwarding rules with the full set given. This is a full replace — any alias you omit is removed, and an empty array clears all email forwarding. Not supported by every registrar.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        forwards: z
          .array(emailForward)
          .describe('The complete set of email forwarding rules to write.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ accountId, registrar, domain, forwards }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return domainOp(
        r,
        domain,
        { kind: 'emailForwarding', forwards },
        account.id,
      );
    },
  );

  server.registerTool(
    'domain_url_forwarding_get',
    {
      title: 'Get URL forwarding',
      description:
        'For a single domain: read its URL forwarding rules (HTTP redirects from a host at the domain to a destination URL). A rule may report a read-only "masked" type; the set tool cannot create one. Not supported by every registrar.',
      inputSchema: { accountId, registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return json(
        await getRegistrarClient(r, account.id).getDomainForwarding(domain),
      );
    },
  );

  server.registerTool(
    'domain_url_forwarding_set',
    {
      title: 'Set URL forwarding',
      description:
        'For a single domain: replace its URL forwarding rules with the full set given. This is a full replace — any rule you omit is removed, and an empty array clears all URL forwarding. Only "temporary"/"permanent" redirects can be set. Not supported by every registrar.',
      inputSchema: {
        accountId,
        registrar: optionalRegistrar,
        domain,
        forwards: z
          .array(domainForward)
          .describe('The complete set of URL forwarding rules to write.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ accountId, registrar, domain, forwards }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return domainOp(
        r,
        domain,
        { kind: 'urlForwarding', forwards },
        account.id,
      );
    },
  );

  server.registerTool(
    'domain_auth_code_get',
    {
      title: 'Get auth code',
      description:
        'For a single domain: read its authorization code (also called the EPP code or transfer secret) — the token the gaining registrar needs to transfer the domain away. Treat it as a secret. Not supported by every registrar.',
      inputSchema: { accountId, registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      const result = await applyDomainOp(
        { registrar: r, domainName: domain, accountId: account.id },
        { kind: 'authCode' },
      );
      // A read: surface a non-ok outcome as the tool's error, as before.
      if (result.status !== 'ok') throw new Error(result.message);
      return json({ domain, authCode: result.data?.authCode });
    },
  );

  server.registerTool(
    'domain_dnssec_get',
    {
      title: 'Get DNSSEC status',
      description:
        'For a single domain: read whether DNSSEC is enabled and, if so, its DS records (keyTag, algorithm, digestType, digest). Not supported by every registrar.',
      inputSchema: { accountId, registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      // The RegistrarClient wrapper doesn't re-expose this extended method;
      // reach through to the underlying provider.
      return json(
        await getRegistrarClient(r, account.id).provider.getDnssec(domain),
      );
    },
  );

  server.registerTool(
    'domain_renewal_price',
    {
      title: 'Estimate renewal price',
      description:
        'For a single domain: DomBot’s estimated annual renewal price, with provenance — a manual override, else a per-name registrar quote where supported, else the account’s own TLD rate captured on Sync, else the base per-TLD database. Distinct from registrar_pricing, which is the registrar’s own live quote.',
      inputSchema: { accountId, registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId, registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar, accountId);
      const account = resolveDomainAccount(r, domain, accountId);
      return json(await getRenewalPriceLive(r, domain, account.id));
    },
  );
}
