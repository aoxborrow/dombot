// Secrets and optional vars the Worker reads. `wrangler types` only emits the
// plain vars present in wrangler.jsonc, so the rest is declared here. All
// optional: boot fails with a clear message when a required one is missing.
interface Env {
  /** Root key: 32 random bytes, base64. Set via `npm run web:secrets`. */
  DOMBOT_SECRET?: string;
  /** Login password (password auth mode). Set via `npm run web:secrets`. */
  DOMBOT_PASSWORD?: string;
  /** cloudflare-access mode: https://<team>.cloudflareaccess.com */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** cloudflare-access mode: the Access application's audience tag. */
  CF_ACCESS_AUD?: string;
}
