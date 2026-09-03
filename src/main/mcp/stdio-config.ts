import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// The handshake between the running app and the stdio shim (`DomBot
// --mcp-stdio`, see ./stdio.ts). The app writes this file when its MCP server
// comes up; a shim process reads it to learn where the server is and how to
// authenticate. Both run as the same user with the same userData dir, so a
// 0600 file is the trust boundary — the same one mcp-tokens.json relies on.

export interface StdioConfig {
  /** The MCP endpoint, e.g. http://127.0.0.1:4123/mcp */
  url: string;
  /** Bearer token the server accepts from the shim (see oauth.ts). */
  token: string;
}

/** Where the handshake file lives — surfaced in shim errors for debugging. */
export function stdioConfigPath(): string {
  return path.join(app.getPath('userData'), 'mcp-stdio.json');
}

function configFile(): string {
  return stdioConfigPath();
}

let cached: StdioConfig | null = null;

/** The current config, or null if the app has never started its MCP server. */
export function readStdioConfig(): StdioConfig | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(configFile(), 'utf8'),
    ) as Partial<StdioConfig>;
    if (typeof raw.url !== 'string' || typeof raw.token !== 'string')
      return null;
    return { url: raw.url, token: raw.token };
  } catch {
    return null;
  }
}

/**
 * Records the server URL for shims. The token is minted once per install and
 * then kept stable, so a shim that started before an app restart keeps working.
 */
export function writeStdioConfig(url: string): StdioConfig {
  const token = readStdioConfig()?.token ?? randomBytes(32).toString('hex');
  cached = { url, token };
  try {
    fs.writeFileSync(configFile(), JSON.stringify(cached, null, 2), {
      mode: 0o600,
    });
  } catch (err) {
    console.error('[mcp] failed to write stdio config', err);
  }
  return cached;
}

/** The shim token the server should accept, if one has been issued. */
export function getStdioToken(): string | null {
  return (cached ?? readStdioConfig())?.token ?? null;
}
