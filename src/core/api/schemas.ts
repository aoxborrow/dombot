import { z } from 'zod';
import { registrars } from '@aoxborrow/registrar-client';
import { FOLDER_COLORS } from '../../shared/ipc';

// Input schemas for the API method table (api/index.ts). Every method's
// arguments are validated against one of these before a handler runs — the
// same check whether the call came over Electron IPC or the web host's HTTP
// route, where it's a real trust boundary.

const registrarNames = Object.keys(registrars) as [string, ...string[]];

export const registrarName = z.enum(registrarNames);

export const domainName = z.string().trim().min(1).max(253);

export const domainTarget = z.object({
  registrar: registrarName,
  domainName,
});

const hostLabel = z.string().trim().min(1).max(253);

// Forwarding values are shape-checked only; the renderer validates them for
// the user and the registrar has the final say (e.g. catch-all aliases).
export const urlForwardInput = z.object({
  host: z.string().trim().min(1).max(253),
  url: z.string().trim().min(1).max(2048),
  type: z.enum(['temporary', 'permanent']),
});

export const emailForward = z.object({
  alias: z.string().trim().min(1).max(253),
  forwardTo: z.string().trim().min(1).max(320),
});

export const domainOp = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('autoRenew'), enabled: z.boolean() }),
  z.object({ kind: z.literal('privacy'), enabled: z.boolean() }),
  z.object({ kind: z.literal('lock'), locked: z.boolean() }),
  z.object({
    kind: z.literal('nameservers'),
    nameservers: z.array(hostLabel).max(13),
  }),
  z.object({
    kind: z.literal('urlForwarding'),
    forwards: z.array(urlForwardInput),
    skipIfExisting: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('emailForwarding'),
    forwards: z.array(emailForward),
    skipIfExisting: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('authCode') }),
  z.object({
    kind: z.literal('renew'),
    years: z.number().int().min(1).max(10),
  }),
]);

export const folderColor = z.enum(FOLDER_COLORS as [string, ...string[]]);

export const folderInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500),
  color: folderColor,
});

export const folderPatch = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500),
    color: folderColor,
    settings: z.object({ forSale: z.boolean().optional() }).strict(),
  })
  .partial()
  .strict();

export const appSettingsPatch = z
  .object({
    autoSyncIntervalMinutes: z.number(),
    recentNameservers: z.array(z.array(z.string())),
  })
  .partial()
  .strict();

/** Credential form values: field name → string. */
export const credentialValues = z.record(z.string(), z.string());

/** `${registrar}:${domainName}` — the key folders and caches use. */
export const domainKey = z.string().trim().min(3).max(300);

export const uuid = z.string().uuid();
