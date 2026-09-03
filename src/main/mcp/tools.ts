import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OperationResult,
  RegistrarName,
} from '@aoxborrow/registrar-client';
import {
  findRegistrarsForDomain,
  getConfiguredRegistrars,
  getDomainDetail,
  getMergedPortfolio,
  getPortfolio,
  getRegistrarClient,
  getRegistrarMetadata,
  registerDomainCached,
  registrarNames,
  renewDomainCached,
  setAutoRenewCached,
  setLockCached,
  getRenewalPriceLive,
  setNameserversCached,
  setPrivacyCached,
  syncRegistrar,
} from '../services/registrars';
import { getFolders } from '../services/folders';
import { broadcastPortfolioChanged } from '../events';
import type { Portfolio } from '../../shared/ipc';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isStaleAt,
  queryPortfolio,
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

// Resolves the registrar for a domain-scoped call. Returns `registrar` verbatim
// when given; otherwise looks the domain up in the cached portfolio. Throws a
// guiding error when the cache can't resolve it — unknown (so the caller can
// sync or pass it explicitly) or ambiguous (a stale cache listing it twice).
function resolveRegistrar(
  domainName: string,
  registrar?: RegistrarName,
): RegistrarName {
  if (registrar) return registrar;
  const matches = findRegistrarsForDomain(domainName);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
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
  registrar: registrar.optional().describe('Only this registrar.'),
  tld: z
    .string()
    .optional()
    .describe('Only this TLD, e.g. "com" or ".com" (no leading dot needed).'),
  folder: z
    .string()
    .optional()
    .describe(
      'Only domains in this folder — a folder name or id, or "Hidden" for the built-in hidden group. Unknown folder → no rows.',
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
  return queryPortfolio(
    domains,
    folders,
    assignments,
    { fetchedAt, registrars, errors },
    args,
  );
}

/** Compact per-registrar sync status for the sync tools: what synced, how many
 *  domains it holds, when, and any per-registrar error, plus the aggregate
 *  freshness. Derives the per-registrar counts from the cache metadata. */
function syncSummary(portfolio: Portfolio) {
  const meta = getRegistrarMetadata();
  const registrars = getConfiguredRegistrars().map((name) => {
    const sync = meta.find((r) => r.name === name)?.sync;
    return {
      registrar: name,
      domainCount: sync?.domainCount ?? 0,
      lastSyncedAt: sync?.lastSyncedAt ?? null,
      lastError: sync?.lastError ?? null,
    };
  });
  return {
    total: portfolio.domains.length,
    fetchedAt: portfolio.fetchedAt,
    stale: isStaleAt(portfolio.fetchedAt),
    registrars,
    errors: portfolio.errors,
  };
}

/**
 * Registers the MCP portfolio tools. Each calls into the shared `services/`
 * layer — the same lower-level core the UI's IPC handlers use — and shapes its
 * own output. Tools group by scope prefix (portfolio / registrar / domain).
 */
export function registerTools(server: McpServer): void {
  // ── Portfolio / account (no scope params) ──────────────────────────────────

  server.registerTool(
    'registrar_list',
    {
      title: 'List registrars',
      description:
        'List every built-in registrar id and which ones have credentials configured.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      json({
        all: registrarNames,
        configured: getConfiguredRegistrars(),
      }),
  );

  server.registerTool(
    'portfolio_query',
    {
      title: 'Query portfolio',
      description:
        'List, search, and filter your whole portfolio across every configured registrar — the primary way to read the portfolio. Filter by registrar, TLD, folder, name, nameserver, auto-renew/lock/privacy, status, and expiry (before/after a date or within N days); sort and page the results. With no filters it returns everything (paged), so use it as a plain list too. Reads the local cache only — no registrar calls; run portfolio_sync first (or whenever this reports stale:true or an empty result) to refresh it. Returns { total, fetchedAt, stale, registrars, errors, rows }: `total` is the full match count before paging (page with `limit`/`offset`); `errors` lists any registrar whose sync failed, so a non-empty `errors` means the result may be incomplete. Rows carry only the fields you need — call domain_get for a single domain’s full record.',
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

  // ── Registrar-level (registrar required) ───────────────────────────────────

  server.registerTool(
    'registrar_test',
    {
      title: 'Test registrar connection',
      description:
        'At one registrar: verify the configured credentials work (a connection test).',
      inputSchema: { registrar },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar }) =>
      json(await getRegistrarClient(registrar).testConnection()),
  );

  server.registerTool(
    'registrar_domains',
    {
      title: 'List a registrar’s domains',
      description: 'At one registrar: list every domain in the account.',
      inputSchema: { registrar },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar }) =>
      json(await getRegistrarClient(registrar).listDomains()),
  );

  server.registerTool(
    'registrar_sync',
    {
      title: 'Sync a registrar',
      description:
        'Re-sync one registrar’s domains into the local cache — a targeted refresh (e.g. after registering a domain, or when just one registrar is stale) that avoids a full portfolio_sync. Returns the same per-registrar summary as portfolio_sync.',
      inputSchema: { registrar },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar }) => {
      const portfolio = await syncRegistrar(registrar);
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
    async ({ registrar, domains }) =>
      json(await getRegistrarClient(registrar).checkAvailability(domains)),
  );

  server.registerTool(
    'registrar_pricing',
    {
      title: 'Get TLD pricing',
      description:
        'At one registrar: look up live registration/renewal/transfer pricing for a TLD (or a specific domain). This is the registrar’s own quote — for DomBot’s estimated renewal price use domain_renewal_price.',
      inputSchema: {
        registrar,
        tld: z
          .string()
          .describe('A TLD ("com") or a full domain ("example.com").'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, tld }) =>
      json(await getRegistrarClient(registrar).getPricing(tld)),
  );

  server.registerTool(
    'registrar_register_domain',
    {
      title: 'Register a domain',
      description:
        'At one registrar: register a new domain. This creates a registration and costs money.',
      inputSchema: { registrar, domain, input: registerInput },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ registrar, domain, input }) =>
      cachedWrite(() => registerDomainCached(registrar, domain, input)),
  );

  server.registerTool(
    'registrar_transfer_domain',
    {
      title: 'Transfer a domain in',
      description:
        'At one registrar: transfer a domain in using its EPP/auth code. This costs money.',
      inputSchema: { registrar, domain, input: transferInput },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ registrar, domain, input }) =>
      json(await getRegistrarClient(registrar).transferIn(domain, input)),
  );

  // ── Domain-level (domain required; registrar auto-resolved from cache) ──────

  server.registerTool(
    'domain_get',
    {
      title: 'Get domain',
      description:
        'For a single domain: its full record — status, creation/expiration dates, auto-renew, transfer lock, WHOIS privacy, and nameservers. Served from the local detail cache when fresh; otherwise fetched live and written through. Pass `refresh` to force a live fetch.',
      inputSchema: {
        registrar: optionalRegistrar,
        domain,
        refresh: refreshParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain, refresh }) => {
      const r = resolveRegistrar(domain, registrar);
      const detail = await getDomainDetail(r, domain, refresh ?? false);
      // getDomainDetail returns null only when neither the registrar nor the
      // registry could resolve anything — fall back to a live getDomain so the
      // error (or record) still comes from the provider.
      return json(detail ?? (await getRegistrarClient(r).getDomain(domain)));
    },
  );

  server.registerTool(
    'domain_contacts_get',
    {
      title: 'Get domain contacts',
      description:
        'For a single domain: read its registrant, admin, tech, and billing contacts.',
      inputSchema: { registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar);
      return json(await getRegistrarClient(r).getContacts(domain));
    },
  );

  server.registerTool(
    'domain_renew',
    {
      title: 'Renew a domain',
      description:
        'For a single domain: renew it (extend its registration). This costs money.',
      inputSchema: {
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
    async ({ registrar, domain, years }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() => renewDomainCached(r, domain, years));
    },
  );

  server.registerTool(
    'domain_nameservers_get',
    {
      title: 'Get nameservers',
      description:
        'For a single domain: its nameservers. Served from the local detail cache when fresh; otherwise fetched live (registrar, then the public registry) and written through. Pass `refresh` to force a live fetch.',
      inputSchema: {
        registrar: optionalRegistrar,
        domain,
        refresh: refreshParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain, refresh }) => {
      const r = resolveRegistrar(domain, registrar);
      const detail = await getDomainDetail(r, domain, refresh ?? false);
      return json(
        detail?.nameservers ??
          (await getRegistrarClient(r).getNameservers(domain)),
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
    async ({ registrar, domain, nameservers }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() => setNameserversCached(r, domain, nameservers));
    },
  );

  server.registerTool(
    'domain_dns_get',
    {
      title: 'Get DNS records',
      description: 'For a single domain: read its DNS records.',
      inputSchema: { registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar);
      return json(await getRegistrarClient(r).getDnsRecords(domain));
    },
  );

  server.registerTool(
    'domain_dns_set',
    {
      title: 'Set DNS records',
      description:
        'For a single domain: replace its DNS records with the full set given. This is a full replace — any record you omit is removed, and an empty array clears the zone.',
      inputSchema: {
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
    async ({ registrar, domain, records }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() =>
        getRegistrarClient(r).setDnsRecords(domain, records),
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
        registrar: optionalRegistrar,
        domain,
        contacts: contactSet,
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    // Contacts aren't part of the portfolio/detail cache; emit the event for
    // consistency (see domain_dns_set).
    async ({ registrar, domain, contacts }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() =>
        getRegistrarClient(r).updateContacts(domain, contacts),
      );
    },
  );

  server.registerTool(
    'domain_set_privacy',
    {
      title: 'Set WHOIS privacy',
      description: 'For a single domain: enable or disable WHOIS privacy.',
      inputSchema: {
        registrar: optionalRegistrar,
        domain,
        enabled: z
          .boolean()
          .describe('true to enable WHOIS privacy, false to disable'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ registrar, domain, enabled }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() => setPrivacyCached(r, domain, enabled));
    },
  );

  server.registerTool(
    'domain_set_autorenew',
    {
      title: 'Set auto-renew',
      description: 'For a single domain: enable or disable auto-renew.',
      inputSchema: {
        registrar: optionalRegistrar,
        domain,
        enabled: z
          .boolean()
          .describe('true to enable auto-renew, false to disable'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ registrar, domain, enabled }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() => setAutoRenewCached(r, domain, enabled));
    },
  );

  server.registerTool(
    'domain_set_lock',
    {
      title: 'Set domain lock',
      description:
        'For a single domain: lock or unlock it (registrar transfer lock).',
      inputSchema: {
        registrar: optionalRegistrar,
        domain,
        locked: z.boolean().describe('true to lock, false to unlock'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ registrar, domain, locked }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() => setLockCached(r, domain, locked));
    },
  );

  server.registerTool(
    'domain_email_forwarding_get',
    {
      title: 'Get email forwarding',
      description:
        'For a single domain: read its alias-style email forwarding rules (mail sent to an alias at the domain redirects to a destination address). Not supported by every registrar.',
      inputSchema: { registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar);
      return json(await getRegistrarClient(r).getEmailForwarding(domain));
    },
  );

  server.registerTool(
    'domain_email_forwarding_set',
    {
      title: 'Set email forwarding',
      description:
        'For a single domain: replace its email forwarding rules with the full set given. This is a full replace — any alias you omit is removed, and an empty array clears all email forwarding. Not supported by every registrar.',
      inputSchema: {
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
    // Email forwarding isn't part of the portfolio/detail cache; emit the event
    // for consistency (see domain_dns_set).
    async ({ registrar, domain, forwards }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() =>
        getRegistrarClient(r).setEmailForwarding(domain, forwards),
      );
    },
  );

  server.registerTool(
    'domain_url_forwarding_get',
    {
      title: 'Get URL forwarding',
      description:
        'For a single domain: read its URL forwarding rules (HTTP redirects from a host at the domain to a destination URL). A rule may report a read-only "masked" type; the set tool cannot create one. Not supported by every registrar.',
      inputSchema: { registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar);
      return json(await getRegistrarClient(r).getDomainForwarding(domain));
    },
  );

  server.registerTool(
    'domain_url_forwarding_set',
    {
      title: 'Set URL forwarding',
      description:
        'For a single domain: replace its URL forwarding rules with the full set given. This is a full replace — any rule you omit is removed, and an empty array clears all URL forwarding. Only "temporary"/"permanent" redirects can be set. Not supported by every registrar.',
      inputSchema: {
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
    // URL forwarding isn't part of the portfolio/detail cache; emit the event
    // for consistency (see domain_dns_set).
    async ({ registrar, domain, forwards }) => {
      const r = resolveRegistrar(domain, registrar);
      return cachedWrite(() =>
        getRegistrarClient(r).setDomainForwarding(domain, forwards),
      );
    },
  );

  server.registerTool(
    'domain_auth_code_get',
    {
      title: 'Get auth code',
      description:
        'For a single domain: read its authorization code (also called the EPP code or transfer secret) — the token the gaining registrar needs to transfer the domain away. Treat it as a secret. Not supported by every registrar.',
      inputSchema: { registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar);
      // The RegistrarClient wrapper doesn't re-expose this extended method;
      // reach through to the underlying provider.
      return json({
        domain,
        authCode: await getRegistrarClient(r).provider.getAuthCode(domain),
      });
    },
  );

  server.registerTool(
    'domain_dnssec_get',
    {
      title: 'Get DNSSEC status',
      description:
        'For a single domain: read whether DNSSEC is enabled and, if so, its DS records (keyTag, algorithm, digestType, digest). Not supported by every registrar.',
      inputSchema: { registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar);
      // The RegistrarClient wrapper doesn't re-expose this extended method;
      // reach through to the underlying provider.
      return json(await getRegistrarClient(r).provider.getDnssec(domain));
    },
  );

  server.registerTool(
    'domain_renewal_price',
    {
      title: 'Estimate renewal price',
      description:
        'For a single domain: DomBot’s estimated annual renewal price, with provenance — a manual override, else a per-name registrar quote where supported, else the base per-TLD database. Distinct from registrar_pricing, which is the registrar’s own live quote.',
      inputSchema: { registrar: optionalRegistrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) => {
      const r = resolveRegistrar(domain, registrar);
      return json(await getRenewalPriceLive(r, domain));
    },
  );
}
