import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { parse } from 'dotenv';

// Development-only credential fallback. We deliberately read the project's own
// `.env` file directly rather than `process.env`: registrar credential keys
// (CLOUDFLARE_ACCOUNT_ID, GODADDY_API_KEY, …) collide with variables other
// tools/projects export globally, and an ambient value would silently shadow
// the intended one. Parsing the file keeps the fallback scoped to DomBot's .env.
// Packaged builds have no .env — end users configure credentials in Settings.

let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  if (app.isPackaged) return (cache = {});
  try {
    cache = parse(fs.readFileSync(path.join(process.cwd(), '.env')));
  } catch {
    cache = {};
  }
  return cache;
}

/** Reads a variable from the project's `.env` (dev only); undefined otherwise. */
export function getDevEnvVar(key: string): string | undefined {
  return load()[key];
}
