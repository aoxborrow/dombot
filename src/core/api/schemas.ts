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

export const domainNameList = z.array(domainName).max(2000);

export const accountId = z.string().min(1).max(100).optional();

export const domainTarget = z.object({
  accountId,
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
    mcpEnabled: z.boolean(),
    preferredCurrency: z.string(),
    numberFormat: z.enum(['us', 'eu-dot', 'fr', 'si', 'ch', 'ch-comma']),
  })
  .partial()
  .strict();

/** Credential form values: field name → string. */
export const credentialValues = z.record(z.string(), z.string());

/** `${registrar}:${domainName}` — the key folders and caches use. */
export const domainKey = z.string().trim().min(3).max(300);

export const uuid = z.string().uuid();

/** One domain's purchase date, amount, currency, and notes. */
export const purchaseInput = z
  .object({
    domainName: z.string().trim().min(1).max(253),
    kind: z.enum(['registered', 'purchased']).optional(),
    resolves: z.string().min(1).max(80).optional(),
    purchaseDate: z.string().nullable(),
    amount: z.string().nullable(),
    currency: z.string().nullable(),
    notes: z.string().max(4000),
  })
  .strict();

// ── domain import ───────────────────────────────────────────────────────────
// Normalized rows only: the lenient reading happened in the renderer, so
// every value here is already in stored form.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = z.string().regex(/^\d{1,15}(\.\d{1,3})?$/);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

export const importRow = z
  .object({
    line: z.number().int().min(0),
    domain: z.string().trim().min(1).max(253),
    status: z
      .enum(['owned', 'sold', 'dropped', 'archived', 'removed'])
      .optional(),
    folder: z.string().trim().min(1).max(100).optional(),
    notes: z.string().max(4000).optional(),
    registration: z
      .object({
        registrar: z.string().max(40).optional(),
        registrarLabel: z.string().max(100).optional(),
        createdDate: day.optional(),
        expirationDate: day.optional(),
        autoRenew: z.boolean().optional(),
      })
      .strict()
      .optional(),
    renewal: z
      .object({ amount: decimal, currency: currencyCode })
      .strict()
      .optional(),
    listPrice: z
      .object({
        amount: decimal.optional(),
        minOffer: decimal.optional(),
        floor: decimal.optional(),
        currency: currencyCode,
      })
      .strict()
      .optional(),
    purchase: z
      .object({
        type: z.enum(['registered', 'purchased']).optional(),
        date: day.optional(),
        amount: decimal.optional(),
        currency: currencyCode.optional(),
        years: z.number().int().min(1).max(10).optional(),
      })
      .strict()
      .refine((p) => !p.amount || p.currency, 'An amount needs a currency.')
      .optional(),
    sale: z
      .object({
        date: day.optional(),
        amount: decimal.optional(),
        currency: currencyCode.optional(),
      })
      .strict()
      .refine((s) => !s.amount || s.currency, 'An amount needs a currency.')
      .optional(),
  })
  .strict();

export const importRows = z.array(importRow).max(10000);

export const importApply = z
  .object({ importId: z.string().min(1).max(80) })
  .strict();

/** A manual name's registration fields, as edited. */
export const manualDomainFields = z
  .object({
    registrar: z.string().max(40).nullable(),
    registrarLabel: z.string().max(100).nullable(),
    createdDate: z.string().max(10).nullable(),
    expirationDate: z.string().max(10).nullable(),
    autoRenew: z.boolean().nullable(),
  })
  .strict();

/** A manual yearly renewal price, in any currency. */
export const renewalPriceInput = z
  .object({ amount: z.string().max(40), currency: z.string().max(10) })
  .strict();

/** One name's asking price; every amount blank clears it. */
export const listPriceInput = z
  .object({
    domainName: z.string().trim().min(1).max(253),
    amount: z.string().max(40).nullable(),
    minOffer: z.string().max(40).nullable(),
    floor: z.string().max(40).nullable(),
    currency: z.string().max(10).nullable(),
  })
  .strict();

export const listPriceInputs = z.array(listPriceInput).min(1).max(10000);

/** A name's note, saved on its own. */
export const noteText = z.string().max(4000);

export const saleInput = z
  .object({
    domainName: z.string().trim().min(1).max(253),
    saleDate: z.string().nullable(),
    amount: z.string().nullable(),
    currency: z.string().nullable(),
    notes: z.string().max(4000),
    resolves: z.string().min(1).max(80).optional(),
    mark: z.boolean().optional(),
  })
  .strict();

export const eventId = z.string().min(1).max(80);

export const disposition = z.enum(['dropped', 'archived']);

/** Names to act on, each with the sync alert the action answers. */
export const ownershipItems = z
  .array(z.object({ domainName, resolves: eventId.optional() }).strict())
  .min(1)
  .max(5000);

/** A `YYYY-MM-DD` day from a dialog; blank or null means today. */
export const optionalDay = z.string().max(40).nullable().optional();
