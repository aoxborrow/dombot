import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listPortfolio } from '@aoxborrow/registrar-client';
import {
  getConfiguredRegistrars,
  getPortfolioSources,
  getRegistrarClient,
  registrarNames,
} from '../services/registrars';
import { getRenewalPrice } from '../services/pricing';

// Serialize a service result as a pretty-printed JSON text block — the simplest
// MCP tool payload. (Dates become ISO strings via JSON.stringify.)
function json(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

// ── shared parameter schemas ─────────────────────────────────────────────────
//
// Scope is encoded in the required-parameter signature and the tool name prefix:
//   portfolio_* → ()                    global / cross-registrar aggregate
//   registrar_* → (registrar)           one provider
//   domain_*    → (registrar, domain)   one domain you own
// `registrar` is always required and never resolved from state, so a caller can
// act on a freshly-registered name that isn't in the cached portfolio yet.

const registrar = z
  .enum(registrarNames)
  .describe('Registrar id, e.g. "dynadot" or "godaddy".');

const domain = z.string().describe('The domain name, e.g. example.com');

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
    .describe('Record type, uppercased: A, AAAA, CNAME, MX, TXT, NS, SRV, CAA…'),
  name: z
    .string()
    .describe('Host relative to the zone apex; "@" denotes the apex.'),
  value: z.string().describe('Record data (IP, target host, text, …).'),
  ttl: z.number().int().optional().describe('Time-to-live in seconds.'),
  priority: z.number().int().optional().describe('Priority, for MX and SRV.'),
  weight: z.number().int().optional().describe('Weight, SRV only.'),
  port: z.number().int().optional().describe('Port, SRV only.'),
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
  privacy: z.boolean().optional().describe('Enable WHOIS privacy, where supported.'),
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
    'portfolio_list',
    {
      title: 'List portfolio',
      description:
        'Across all configured registrars: list every domain you own (aggregated). Returns per-registrar errors alongside the combined domains.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(await listPortfolio(getPortfolioSources())),
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
      json(await getRegistrarClient(registrar).registerDomain(domain, input)),
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

  // ── Domain-level (registrar + domain required) ─────────────────────────────

  server.registerTool(
    'domain_get',
    {
      title: 'Get domain',
      description:
        'For a single domain: fetch its full record — status, creation/expiration dates, auto-renew, transfer lock, WHOIS privacy, and nameservers.',
      inputSchema: { registrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) =>
      json(await getRegistrarClient(registrar).getDomain(domain)),
  );

  server.registerTool(
    'domain_contacts_get',
    {
      title: 'Get domain contacts',
      description:
        'For a single domain: read its registrant, admin, tech, and billing contacts.',
      inputSchema: { registrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) =>
      json(await getRegistrarClient(registrar).getContacts(domain)),
  );

  server.registerTool(
    'domain_renew',
    {
      title: 'Renew a domain',
      description:
        'For a single domain: renew it (extend its registration). This costs money.',
      inputSchema: {
        registrar,
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
    async ({ registrar, domain, years }) =>
      json(await getRegistrarClient(registrar).renewDomain(domain, years)),
  );

  server.registerTool(
    'domain_nameservers_get',
    {
      title: 'Get nameservers',
      description: 'For a single domain: read its nameservers.',
      inputSchema: { registrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) =>
      json(await getRegistrarClient(registrar).getNameservers(domain)),
  );

  server.registerTool(
    'domain_nameservers_set',
    {
      title: 'Set nameservers',
      description:
        'For a single domain: replace its nameservers with the full set given.',
      inputSchema: {
        registrar,
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
    async ({ registrar, domain, nameservers }) =>
      json(
        await getRegistrarClient(registrar).updateNameservers(
          domain,
          nameservers,
        ),
      ),
  );

  server.registerTool(
    'domain_dns_get',
    {
      title: 'Get DNS records',
      description: 'For a single domain: read its DNS records.',
      inputSchema: { registrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) =>
      json(await getRegistrarClient(registrar).getDnsRecords(domain)),
  );

  server.registerTool(
    'domain_dns_set',
    {
      title: 'Set DNS records',
      description:
        'For a single domain: replace its DNS records with the full set given. This is a full replace — any record you omit is removed, and an empty array clears the zone.',
      inputSchema: {
        registrar,
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
    async ({ registrar, domain, records }) =>
      json(await getRegistrarClient(registrar).setDnsRecords(domain, records)),
  );

  server.registerTool(
    'domain_contacts_set',
    {
      title: 'Set domain contacts',
      description:
        'For a single domain: update its contacts. Provide only the roles you want to change (registrant, admin, tech, billing).',
      inputSchema: { registrar, domain, contacts: contactSet },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ registrar, domain, contacts }) =>
      json(await getRegistrarClient(registrar).updateContacts(domain, contacts)),
  );

  server.registerTool(
    'domain_set_privacy',
    {
      title: 'Set WHOIS privacy',
      description: 'For a single domain: enable or disable WHOIS privacy.',
      inputSchema: {
        registrar,
        domain,
        enabled: z
          .boolean()
          .describe('true to enable WHOIS privacy, false to disable'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ registrar, domain, enabled }) =>
      json(await getRegistrarClient(registrar).setPrivacy(domain, enabled)),
  );

  server.registerTool(
    'domain_set_autorenew',
    {
      title: 'Set auto-renew',
      description: 'For a single domain: enable or disable auto-renew.',
      inputSchema: {
        registrar,
        domain,
        enabled: z
          .boolean()
          .describe('true to enable auto-renew, false to disable'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ registrar, domain, enabled }) =>
      json(await getRegistrarClient(registrar).setAutoRenew(domain, enabled)),
  );

  server.registerTool(
    'domain_set_lock',
    {
      title: 'Set domain lock',
      description:
        'For a single domain: lock or unlock it (registrar transfer lock).',
      inputSchema: {
        registrar,
        domain,
        locked: z.boolean().describe('true to lock, false to unlock'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ registrar, domain, locked }) => {
      const client = getRegistrarClient(registrar);
      return json(
        await (locked
          ? client.lockDomain(domain)
          : client.unlockDomain(domain)),
      );
    },
  );

  server.registerTool(
    'domain_renewal_price',
    {
      title: 'Estimate renewal price',
      description:
        'For a single domain: DomBot’s estimated annual renewal price, with provenance — a manual override, else a per-name registrar quote where supported, else the base per-TLD database. Distinct from registrar_pricing, which is the registrar’s own live quote.',
      inputSchema: { registrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) =>
      json(await getRenewalPrice(registrar, domain)),
  );
}
