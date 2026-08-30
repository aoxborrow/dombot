import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listPortfolio } from '@aoxborrow/registrar-client';
import {
  getConfiguredRegistrars,
  getPortfolioSources,
  getRegistrarClient,
  registrarNames,
} from '../services/registrars';

// Serialize a service result as a pretty-printed JSON text block — the simplest
// MCP tool payload. (Dates become ISO strings via JSON.stringify.)
function json(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

// Every registrar-scoped tool takes this: which provider to act on.
const registrar = z
  .enum(registrarNames)
  .describe('Registrar id, e.g. "dynadot" or "godaddy".');

const domain = z.string().describe('The domain name, e.g. example.com');

/**
 * Registers the MCP portfolio tools. Each calls into the shared `services/`
 * layer — the same lower-level core the UI's IPC handlers use — and shapes its
 * own output. Money-moving operations (register/renew/transfer) are omitted.
 */
export function registerTools(server: McpServer): void {
  // ── Reads ────────────────────────────────────────────────────────────────

  server.registerTool(
    'list_registrars',
    {
      title: 'List registrars',
      description:
        'List built-in registrar ids and which ones have credentials configured.',
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
    'list_portfolio',
    {
      title: 'List portfolio',
      description:
        'List domains across every configured registrar (aggregated). Returns per-registrar errors alongside the combined domains.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(await listPortfolio(getPortfolioSources())),
  );

  server.registerTool(
    'list_domains',
    {
      title: 'List domains',
      description: 'List all domains at a single registrar.',
      inputSchema: { registrar },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar }) =>
      json(await getRegistrarClient(registrar).listDomains()),
  );

  server.registerTool(
    'check_availability',
    {
      title: 'Check domain availability',
      description:
        'Check whether one or more domains are available to register.',
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
    'get_dns_records',
    {
      title: 'Get DNS records',
      description: 'Fetch the DNS records for a domain.',
      inputSchema: { registrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) =>
      json(await getRegistrarClient(registrar).getDnsRecords(domain)),
  );

  server.registerTool(
    'get_nameservers',
    {
      title: 'Get nameservers',
      description: 'Fetch the nameservers for a domain.',
      inputSchema: { registrar, domain },
      annotations: { readOnlyHint: true },
    },
    async ({ registrar, domain }) =>
      json(await getRegistrarClient(registrar).getNameservers(domain)),
  );

  // ── Writes (non-money) ─────────────────────────────────────────────────────

  server.registerTool(
    'set_nameservers',
    {
      title: 'Set nameservers',
      description: 'Replace the nameservers for a domain.',
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
    'set_auto_renew',
    {
      title: 'Set auto-renew',
      description: 'Enable or disable auto-renew for a domain.',
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
    'set_lock',
    {
      title: 'Set domain lock',
      description: 'Lock or unlock a domain (registrar transfer lock).',
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
}
