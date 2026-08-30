import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDynadotClient } from '../services/registrars';

// Serialize a service result as a pretty-printed JSON text block — the simplest
// MCP tool payload. (Dates become ISO strings via JSON.stringify.)
function json(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Registers the read-only portfolio tools. Each one calls into the shared
 * `services/` layer — the same lower-level core the UI's IPC handlers use — and
 * shapes its own output. Mutating/money-moving tools are intentionally omitted.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    'list_domains',
    {
      title: 'List domains',
      description: 'List all domains in the Dynadot portfolio.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(await getDynadotClient().listDomains()),
  );

  server.registerTool(
    'check_availability',
    {
      title: 'Check domain availability',
      description:
        'Check whether one or more domains are available to register.',
      inputSchema: {
        domains: z
          .array(z.string())
          .min(1)
          .describe(
            'Domain names to check, e.g. ["example.com", "example.net"]',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ domains }) =>
      json(await getDynadotClient().checkAvailability(domains)),
  );

  server.registerTool(
    'get_dns_records',
    {
      title: 'Get DNS records',
      description: 'Fetch the DNS records for a domain in the portfolio.',
      inputSchema: {
        domain: z.string().describe('The domain name, e.g. example.com'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ domain }) => json(await getDynadotClient().getDnsRecords(domain)),
  );
}
