#!/usr/bin/env node
// Rotates DOMBOT_SECRET — the root key everything in D1 is encrypted under —
// on a running self-hosted instance, by round-tripping the data through a
// bundle:
//
//   1. sign in and export everything (the current secret can still open it)
//   2. keep that bundle on disk, sealed here with a passphrase you're asked
//      for (same envelope as the app's Settings → Export; see
//      src/shared/bundle-seal.ts)
//   3. `wrangler secret put DOMBOT_SECRET` with a fresh random key
//   4. sign in again (sessions are derived from the secret, so it's a new one)
//      and import the bundle, which rewrites every doc under the new key
//
// If anything fails after step 3 the instance is empty but your data is in
// the bundle file: fix the problem and import it from Settings → Sync.
//
//   DOMBOT_URL=https://dombot.example.workers.dev npm run web:rotate-secret
//
// Prompts for the login password (or reads DOMBOT_PASSWORD from env) and for
// a passphrase to seal the on-disk bundle.

import { randomBytes, webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Seals bundle text like src/shared/bundle-seal.ts does (kept in step). */
async function sealBundle(text, passphrase) {
  const subtle = webcrypto.subtle;
  const head = JSON.parse(text);
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  return JSON.stringify(
    {
      format: head.format,
      version: head.version,
      exportedAt: head.exportedAt,
      encrypted: {
        kdf: 'PBKDF2-SHA256',
        iterations: 600_000,
        salt: b64(salt),
        alg: 'AES-256-GCM',
        iv: b64(iv),
        ct: b64(new Uint8Array(ct)),
      },
    },
    null,
    2,
  );
}

const url = (process.env.DOMBOT_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(url)) {
  console.error(
    'Set DOMBOT_URL to your instance, e.g. DOMBOT_URL=https://dombot.you.workers.dev',
  );
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
async function ask(q, { hidden = false } = {}) {
  if (!hidden || !stdout.isTTY) return (await rl.question(q)).trim();
  // Mask input: readline echoes, so temporarily swallow the output stream.
  stdout.write(q);
  const write = stdout.write.bind(stdout);
  stdout.write = () => true;
  try {
    return (await rl.question('')).trim();
  } finally {
    stdout.write = write;
    stdout.write('\n');
  }
}

const password =
  process.env.DOMBOT_PASSWORD ||
  (await ask('Login password: ', { hidden: true }));

let cookie = '';
async function login() {
  const res = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`login failed (${res.status}): ${body.error ?? ''}`);
  }
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
}
async function api(method, args) {
  const res = await fetch(`${url}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url, cookie },
    body: JSON.stringify({ args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`${method} failed (${res.status}): ${body.error ?? ''}`);
  return body.result;
}

const status = await (await fetch(`${url}/auth/status`)).json();
if (status.mode !== 'password') {
  console.error(
    `This instance uses DOMBOT_AUTH=${status.mode}; this script only knows the password login. ` +
      'Export from Settings → Sync, rotate the secret with `npx wrangler secret put DOMBOT_SECRET`, sign in, and import the file.',
  );
  process.exit(1);
}

// 1–2. Export, sealed, to disk.
await login();
const passphrase = await ask('Passphrase to seal the backup file: ', {
  hidden: true,
});
if (!passphrase) {
  console.error(
    'A passphrase is required — the file holds your registrar keys.',
  );
  process.exit(1);
}
const plain = await api('exportData', []);
const file = `dombot-data-${new Date().toISOString().slice(0, 10)}-pre-rotation.json`;
writeFileSync(file, await sealBundle(plain, passphrase), { mode: 0o600 });
console.log(`Exported to ./${file} (sealed with your passphrase).`);

// 3. New secret.
const next = randomBytes(32).toString('base64');
const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'DOMBOT_SECRET'], {
  input: next + '\n',
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (r.status !== 0) {
  console.error(
    '\nwrangler secret put failed; nothing was changed. Your export is still at ./' +
      file,
  );
  process.exit(r.status ?? 1);
}

// 4. Wait until the new secret is live — proven by the pre-rotation session
// (derived from the old secret) being rejected — then sign in fresh and
// import. Importing through a stale isolate would re-seal the data under the
// OLD key, so the proof matters.
console.log('Waiting for the instance to pick up the new secret…');
const oldCookie = cookie;
let live = false;
for (let attempt = 0; attempt < 60 && !live; attempt++) {
  const res = await fetch(`${url}/api/getRevisions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: url,
      cookie: oldCookie,
    },
    body: JSON.stringify({ args: [] }),
  });
  if (res.status === 401) live = true;
  else await new Promise((r) => setTimeout(r, 2000));
}
if (!live) {
  console.error(
    'The instance still accepts the old session after two minutes. Not importing. ' +
      `Once it restarts, sign in and import ./${file} from Settings → Sync.`,
  );
  process.exit(1);
}
await login();
const imported = await api('importData', [plain]);
console.log(
  `Imported ${imported.entries} item(s) across ${imported.namespaces} section(s).`,
);
console.log(`\nNew DOMBOT_SECRET=${next}`);
console.log(
  'Save it now — it is not shown again. Delete ./' +
    file +
    ' once you have confirmed the instance is healthy (or keep it as a backup).',
);
rl.close();
