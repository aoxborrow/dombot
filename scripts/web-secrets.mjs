#!/usr/bin/env node
// Generates the two secrets a self-hosted DomBot needs and applies them to
// the Worker with `wrangler secret put`:
//
//   DOMBOT_SECRET    root key — encrypts everything in D1 (never rotate
//                    casually: lose it and the data is unreadable)
//   DOMBOT_PASSWORD  the login password (password auth mode)
//
// Both are printed ONCE. Put them in your password manager.
//
//   node scripts/web-secrets.mjs                # generate + apply both
//   node scripts/web-secrets.mjs --password     # only DOMBOT_PASSWORD (rotate)
//   node scripts/web-secrets.mjs --print        # generate, print, don't apply
//   DOMBOT_PASSWORD=... node scripts/web-secrets.mjs --password
//                                               # apply a value you chose
//
// Rotating the password logs every session out; nothing else changes.
// Rotating DOMBOT_SECRET is NOT supported by this script (it would orphan the
// encrypted data) — see docs/self-hosting.md.

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const onlyPassword = args.has('--password');
const printOnly = args.has('--print');

const generate = () => randomBytes(32).toString('base64');

const secrets = onlyPassword
  ? { DOMBOT_PASSWORD: process.env.DOMBOT_PASSWORD || generate() }
  : {
      DOMBOT_SECRET: process.env.DOMBOT_SECRET || generate(),
      DOMBOT_PASSWORD: process.env.DOMBOT_PASSWORD || generate(),
    };

function put(name, value) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    input: value + '\n',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0) {
    console.error(`\nFailed to set ${name} (wrangler exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

if (!printOnly) {
  for (const [name, value] of Object.entries(secrets)) put(name, value);
}

console.log('\nSave these now — they are not shown again:\n');
for (const [name, value] of Object.entries(secrets)) {
  console.log(`  ${name}=${value}`);
}
console.log(
  onlyPassword
    ? '\nPassword rotated. Every existing session is signed out.'
    : '\nLosing DOMBOT_SECRET makes the instance’s data unreadable. Keep it safe.',
);
