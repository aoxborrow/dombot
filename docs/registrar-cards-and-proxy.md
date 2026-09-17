# Registrar account cards and central proxy settings

A planning doc for two related changes to **Settings → Registrars**:

1. **One card per account.** Today there is one card per registrar, and a
   registrar with several accounts grows an account selector, a rollup header,
   two sync scopes and two enable switches inside that card
   ([multi-account.md](multi-account.md) describes the current behavior). This
   plan replaces that with one card per saved account and a single "Add
   registrar account" picker at the top of the page.
2. **Proxy settings move out of the Namecheap credentials.** The fixed IP proxy
   is configured once on its own settings page and switched on per account
   with a "Use fixed IP proxy" toggle. The transport hook moves down into
   `@aoxborrow/registrar-client` so any registrar can use it, not only
   Namecheap.

The card restructure lands first. The proxy toggle then drops into a simple
per-account form instead of being threaded through the current card and moved
later.

## Goals

- **An account is the unit of the page.** Each card shows one account's
  identity, status, credentials and controls. No selector, no rollup, no "all
  accounts" variants of Sync and Enable.
- **Adding is one obvious action.** A picker at the top lists every supported
  registrar; choosing one opens a new card in edit mode. It works the same for
  the first account of a registrar and the fifth.
- **Nicknames are optional until they're needed.** A lone account is just
  "Dynadot". A second Dynadot account must be distinguishable.
- **One proxy, configured once.** A central page holds the proxy URL and
  outgoing IPv4. Accounts opt in with a toggle. The stored shape allows several
  profiles, but the UI exposes exactly one.
- **Identical on desktop and web.** The Proxy page, the per-account toggle and
  the stored profile behave the same on both hosts, and the profile travels in
  data exports. Someone running the desktop app and a self-hosted instance can
  use the same proxy account, the same static IP and the same registrar
  allowlist entry on both.
- **Proxying is a transport concern, not a Namecheap subclass.** DomBot hands
  registrar-client a `fetch`, and every provider routes through it.
- **No data loss and no re-entry.** Existing accounts, credentials, caches,
  folders, prices and Namecheap proxy settings carry over without user action.

## Non-goals

- **Multiple proxies in the UI.** The data shape keeps the door open; the UI
  does not.
- **SOCKS or IPv6 proxies, or per-request proxy selection.**
- **Registrar-level bulk controls.** "Sync all Dynadot accounts" and "disable
  all Dynadot accounts" go away. The global Sync covers the former; the latter
  is two clicks.
- **Changing account identity.** IDs, storage keys, MCP `accountId` routing and
  bundle contents for accounts stay as they are.
- **Reordering or grouping cards by hand.** Sort order is fixed.

## Part 1 — One card per account

### Page layout

```
Registrars
Store API credentials for each registrar account. …

[ + Add registrar account ▾ ]          ← picker: logo + name for every registrar

┌ (●) Dynadot                 Synced 4m ago · 212 domains   [Sync] ⌄ ┐
┌ (○) Namecheap · Agency      Disabled                             ⌄ ┐
┌ (●) Namecheap · Personal    Synced 4m ago · 38 domains    [Sync] ⌄ ┐
┌ (●) Porkbun                 Sync failed                   [Sync] ⌄ ┐
```

- **Picker.** A dropdown button beside the page heading. Items are every registrar in
  the catalog, alphabetical, each with its logo. Registrars that already have
  an account are still listed; they are not marked or disabled.
- **Cards.** One per saved account, sorted by registrar display name, then by
  nickname ignoring case. The collapsed header carries
  the enable switch, logo, title, sync status, domain count, a Sync button when
  configured and enabled, and the expand chevron. This is today's
  single-account header with the rollup logic removed.
- **Title.** `Registrar` for a registrar's only account, `Registrar ·
  Nickname` once it has siblings.
- **Expanded body.** Nickname field, credential fields, the proxy toggle (Part
  2), then Save, and Remove account at the far end. Rename is no longer a mode;
  the nickname is just a field saved with the rest of the form.
- **Empty state.** With no saved accounts, the list area shows the catalog as a
  grid of registrar buttons (logo + name), so a first-time user still sees what
  is supported. Each button does what the matching picker item does.

### Adding an account

1. Choosing a registrar from the picker (or the empty-state grid) opens a
   **draft card** at the top of the list, scrolled into view and focused. The
   draft exists only in component state.
2. The draft shows the registrar's help text, nickname, credentials, the proxy
   toggle where available, **Add account** and **Cancel**.
3. **Add account** calls the existing `connectRegistrarAccount` path: validate
   the connection first, persist only on success, then sync. A failed test
   leaves the draft open with the error and persists nothing, as today. The
   first sync's result arrives as a toast, and the new card shows "Syncing…"
   meanwhile.
4. **Cancel** discards the draft. Only one draft can be open at a time: the
   picker is disabled, with a tooltip saying why, until the draft is added or
   cancelled. That is simpler than a discard-confirmation and Cancel is always
   one click away.

This removes the "draft must never replace the selected account" hazard in the
old card: a draft is its own card and never shares state with a saved one.

### Nicknames

- Stored in the existing `label` field on the account record, which stays
  required and non-empty. No schema, bundle or migration change. DomBot already
  assigns a label when none is given (`Main`, `Account 2`, …; `Default` for
  adopted legacy accounts), and Domains, Renewals and exports already hide the
  label of a registrar's only account. The cards follow the same rule.
- **Optional** while the account is the only one for its registrar. **Required
  for the new account** once the registrar already has one.
- When the registrar's single existing account still carries a label DomBot
  made up (`isAutoLabel`), the draft form also requires a nickname for that
  account. It is renamed just before the new account is connected, so the new
  nickname cannot collide with the label being replaced.
- **Unique within a registrar, ignoring case**, among accounts the user
  actually has. Enforced in `createAccount` and `renameAccount`, and checked in
  `connectRegistrarAccount` before the connection test so a taken nickname
  costs no network round trip. The unused placeholder account every registrar
  carries does not reserve the label `Default`.
- On a saved card the nickname is an ordinary field saved with the form.
  Clearing it keeps the current nickname.

### What is removed

- The account `<Select>`, Rename mode, "Account status" sub-row, "Sync
  account" button, and the `registrarSummary` rollup.
- `registrarGroups`/`canAddAccount` and the in-card "Add another account"
  button and its inline form. `RegistrarCard` becomes `AccountCard`,
  `NewRegistrarAccountForm` becomes `DraftAccountCard`, and the Namecheap proxy
  block they each carried a copy of becomes one `NamecheapProxyFields`.
- The "— all accounts" variants of the enable switch labels and titles.

### What does not change

- `registrar-accounts`, `credentials`, cache, folders, prices and enabled-state
  storage, including stored labels. Adopted legacy accounts keep the registrar
  name as their ID; every account added since gets a UUID.
- The API surface (`connectRegistrarAccount`, `createRegistrarAccount`,
  `renameRegistrarAccount`, `removeRegistrarAccount`) except for the nickname
  rules above.
- MCP tools, `registrar_list`, and `accountId` routing.
- The Account column's visibility rule on Domains and Renewals.
- Bundle format.

### Removing the last account of a registrar

The old card offered Remove only when a registrar had several accounts. With
one card per account it is always available: the card disappears and the
registrar is offered again by the picker. The service already supported this.
Adding the registrar back creates a new UUID account. A removed legacy ID stays
tombstoned on purpose, so old queued work can never be rerouted to a different
account that happens to reuse it.

## Part 2 — Central proxy settings

### Data shape

New encrypted namespace **`proxies`**, handled like `credentials` (OS
encryption on desktop, AES-GCM on the Worker, included in exports, redacted
from diagnostics):

```ts
interface ProxyProfile {
  id: string;        // 'default' for the one the UI manages
  label: string;     // unused by the UI for now
  url: string;       // http(s)://[user:pass@]host:port — secret
  egressIp: string;  // public IPv4 the registrar will see
}
```

Accounts gain an optional pointer:

```ts
interface RegistrarAccount {
  id: string;
  registrar: RegistrarName;
  label: string;
  proxyId?: string;  // absent = direct
}
```

The UI reads and writes only the `default` profile and sets `proxyId:
'default'` when the toggle is on. Nothing else in the code assumes there is
only one profile.

Validation is the existing `parseNamecheapProxy` logic, renamed and moved to
`src/shared/proxy.ts`: HTTP or HTTPS, hostname or public IPv4, optional
credentials, no path/query/fragment, public IPv4 egress address.

### Settings page

A new **Settings → Proxy** page, present on desktop and web alike:

- **Proxy URL** (password-style input) and **Outgoing IPv4 address**, with the
  current help text, plus the Workers "experimental TLS client" notice on web.
- **Test** makes one request through the proxy to an IP-echo endpoint and
  reports the address it saw, flagging a mismatch with the entered outgoing IP.
  It uses Cloudflare's `https://cloudflare.com/cdn-cgi/trace` (plain text, the
  `ip=` line) and falls back to `https://ipinfo.io/json` if that fails. On the
  Worker the socket goes to the proxy, not to Cloudflare, so the platform's
  block on sockets to Cloudflare's own ranges does not apply; phase 4 confirms
  that in practice. The proxied `fetch` pins origins per provider, so Test gets
  its own two-origin allowlist rather than widening a registrar's.
- **Save** validates and stores the profile, then invalidates every registrar
  client whose account uses it.
- **Remove proxy** is blocked while any account has the toggle on, and lists
  those accounts.
- A short "Used by" line lists the accounts currently routed through it.

### Per-account toggle

In the account card body, below the credentials: a **Use fixed IP proxy**
switch.

- Disabled with a link to the Proxy page when no profile is saved.
- For Namecheap, turning it on hides **Client IP** and the request uses the
  profile's outgoing IP, exactly as now. The saved direct Client IP is kept so
  turning the toggle off restores it.
- For other registrars it only changes the route. Help text: "Send this
  account's API requests through your fixed IP proxy. Add the proxy's outgoing
  address to the registrar's API allowlist first."
- Saved with the rest of the form; changing it re-tests the connection over the
  new route before persisting, as connecting does today.

### Transport: registrar-client change

registrar-client calls the global `fetch` in exactly one place (`HttpClient`'s
`send`). Add an optional `fetch` to `RegistrarClientOptions`:

```ts
interface RegistrarClientOptions {
  timeout: number;
  retries: number;
  backoff: number;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;   // new — defaults to global fetch
}
```

`createRegistrar(name, credentials, { fetch })` is then all DomBot needs for
any provider. Ship as a minor release (0.7.0) and bump DomBot.

On the DomBot side the two host transports already have the right shape
(`(proxy, url, init) => Promise<Response>`, backed by `https-proxy-agent` on
desktop and `tunnelfetch` on the Worker). They get wrapped into a
`fetch`-compatible function bound to a profile, and `getRegistrarClient`
passes it when `account.proxyId` resolves. The client-cache fingerprint
already includes the proxy; it switches from the credential fields to the
resolved profile.

What stays from today's `ProxyHttpClient`, reimplemented around the hook:

- **Origin pinning.** The proxied `fetch` refuses any URL whose origin is not
  the provider's own API origin. Today that is hardcoded to Namecheap; it
  becomes a per-provider allowlist derived from the provider's base URL.
- **Response cap, no redirects, bounded timeouts, no shared sockets across
  Worker invocations.** Unchanged, and they live in the host transports
  already.
- **Namecheap specifics.** `clientIp` comes from the profile's `egressIp`.
  That is the only Namecheap-specific piece left. The `HttpClient` subclass
  that replaced `send` goes away, and so does its read-command allowlist: the
  retry standard below covers Namecheap's GET-for-writes API without a list.

Error redaction (`protectRegistrar`) adds the profile URL and its credentials
to the secret list for accounts that use it. `sanitizeBundleDiagnostics`
collects secrets from the `proxies` namespace as well as `credentials`.

### Migration

One idempotent startup step, desktop and Worker:

1. For each account whose stored credentials contain `proxyUrl`/`proxyIp`:
   if no `default` profile exists, create it from those values; set
   `proxyId: 'default'` on the account; delete the two fields from the
   credentials.
2. If a second account carries a **different** proxy, keep the first as
   `default`, store the other as an additional profile with its own ID and
   point that account at it. It keeps working; the UI simply can't edit that
   profile until multiple profiles are exposed. Log it.

**Bundles.** Exports include the `proxies` namespace. Import validates every
profile with the shared parser and every `proxyId` against the imported
profiles. Older bundles with proxy fields inside Namecheap credentials are
accepted and run through the same migration after import. Because older builds
would silently drop the `proxies` namespace and the `proxyId` pointers, this
bumps the bundle version so they refuse the file instead.

### Docs

- Rewrite [multi-account.md](multi-account.md) for the card-per-account UI.
- Move "Optional fixed IP proxy for Namecheap" in
  [self-hosting.md](self-hosting.md) to a registrar-neutral section, keeping
  the transport limitations and the Namecheap retry caveats.
- `mcp-tools.md`: `registrar_list` accounts gain `proxy: boolean`. No secrets.

## Phases

Each phase is one PR and leaves the app shippable.

1. **Account cards.** *Done.* `AccountCard`, picker, empty state, draft flow,
   nickname rules in `accounts.ts`, last-account removal. The Namecheap proxy
   fields stay in the card exactly as they were. `multi-account.md` rewritten.
2. **registrar-client: `fetch` option and the retry standard.** Library PR
   with the read/write classification, the sent-or-not distinction, the
   `OutcomeUnknownError`, removal of the per-call `retries: 0` opt-outs, tests,
   release 0.7.0. DomBot bumps and adds the automatic re-fetch after an
   unknown outcome. This applies to direct connections too, so it ships value
   before any proxy work.
3. **Proxy storage and transport.** `proxies` namespace, `proxyId`, migration,
   bundle version bump and validation, generic proxied `fetch` with origin
   pinning, proxy-stage error mapping, Namecheap wrapper slimmed down,
   redaction sources. No UI change yet beyond the Namecheap card reading its
   values from the profile.
4. **Proxy page and per-account toggle.** Settings page with Test, toggle on
   every account card, Namecheap Client IP behavior, MCP `proxy` flag, docs.

## Testing

- **Accounts.** Nicknames are unique per registrar ignoring case, rejected
  before any connection test, reusable at another registrar, freed by removal,
  and never blocked by an unused placeholder.
- **Cards.** One card per saved account and none for placeholders; nickname
  shown only with siblings; sort order independent of input order; recognition
  of DomBot-assigned labels. Draft, cancel, empty state and picker checked in
  the running app.
- **Migration.** Single Namecheap proxy; two accounts with the same proxy; two
  accounts with different proxies; already-migrated data is a no-op; legacy
  bundle import.
- **Retries (library).** Every feature method is classified as a read or a
  write, with a test that fails when a new method is added unclassified. A
  failure before the request is sent retries for reads and writes alike; a 429
  retries for both; a timeout, mid-response drop or 5xx retries a read and
  raises `OutcomeUnknownError` for a write without re-sending. Covered for a
  GET-only provider (Namecheap) and a POST-only provider (Porkbun).
- **Retries (DomBot).** An unknown outcome triggers one re-fetch of the domain
  and reports either "applied" or "not applied, safe to retry"; a failed
  re-fetch reports the outcome as unknown. Bulk jobs record the same three
  states per domain. A renew is never sent twice.
- **Transport.** Proxied `fetch` refuses off-origin URLs for each provider;
  Namecheap sends the profile's egress IP; proxy-stage failures (unreachable,
  407, non-2xx CONNECT, TLS to the proxy) surface as proxy errors, are retried
  for any command, and never read as registrar errors; changing the profile
  invalidates cached clients; secrets from the profile never reach portfolio
  errors, bulk-job results or MCP output.
- **Manual.** One real sync through an HTTPS proxy by hostname on the Worker
  and on desktop. That path has never been exercised end to end.

## Retry standard

One rule for every registrar, direct or proxied. It replaces the library's
current behavior, the Namecheap proxy allowlist, and the scattered
`retries: 0` opt-outs.

### Today

registrar-client's retry loop ignores what is being sent. With the default
`retries: 2` it re-sends any request, reads and writes alike, after a timeout,
a connection error, a 429 or a 5xx. The exceptions are ad hoc: Name.com's DNS
record writes inside the library, DomBot's renew path, and the proxied
Namecheap client, which keeps a hardcoded list of nine read commands because
Namecheap sends every command as a GET.

The HTTP method cannot be the signal. Namecheap uses GET for writes; Porkbun
uses POST for reads.

### What actually hurts when sent twice

- **Renew.** Charges twice and adds two terms. The one that costs money.
- **Writes that create records** at registrars whose API adds DNS or
  forwarding entries one at a time. A repeat leaves duplicates.
- **Register and transfer-in.** The repeat fails with "unavailable" or
  "already pending", so the user sees a failure for something that succeeded.
- Everything else sets a state (auto-renew, lock, nameservers, contacts,
  privacy flag, forwarding, DNSSEC disable) and is harmless to repeat.

### The rule

Decide by where the failure happened and whether the call is a read or a
write. The library classifies by feature method, not by HTTP method: `get*`,
`list*`, `check*` and `testConnection` are reads; everything else is a write.
New methods must be classified explicitly; unclassified means write.

| Failure | Read | Write |
| --- | --- | --- |
| Registrar never saw the request: DNS failure, connection refused, TLS handshake failure, any proxy-stage error | Retry | Retry |
| 429 (explicitly rejected) | Retry, honoring `Retry-After` | Retry, honoring `Retry-After` |
| Outcome unknown: timeout after the request was sent, connection dropped mid-response, 5xx | Retry | **Do not retry.** Raise `OutcomeUnknownError` |
| Any other response (4xx, provider error body) | Fail | Fail |

`OutcomeUnknownError` is a new typed error carrying the feature name and the
underlying cause. It is not retryable.

### What DomBot does with an unknown outcome

It resolves it instead of asking the user to. After an `OutcomeUnknownError`
from a domain write, DomBot re-fetches that domain once and compares the
relevant field with what the write intended:

- **Applied.** Report success and patch the cache, as a normal success would.
- **Not applied.** Report "No change was made. Safe to try again."
- **Re-fetch failed, or the field can't confirm it** (for example an auth-code
  request). Report "The registrar didn't confirm this. Check the domain before
  retrying."

DomBot already re-fetches after a renew, so this generalizes an existing
pattern. Bulk jobs record the same three states per domain, and "not applied"
rows are eligible for the existing retry action. MCP tools return the same
wording.

### Proxy errors versus registrar errors

A CONNECT proxy has a hard boundary: the tunnel is established or it is not.
Everything before that point belongs to the proxy and means the registrar
never saw the request: proxy unreachable, 407, a non-2xx reply to CONNECT, a
TLS failure to the proxy itself. `tunnelfetch` raises a dedicated error type
with codes for these; `https-proxy-agent` fails identifiably at the CONNECT
step. The host transports map them to one `ProxyError` that the library treats
as "never sent", so they retry for any command and surface with their own
messages ("The proxy rejected the username or password"), never as registrar
errors.

Once the tunnel is up the traffic is end-to-end TLS with the registrar, and
failures are the same as on a direct connection. A tunnel that drops
mid-request is an unknown outcome and follows the table.

### Where it lives

- **registrar-client:** the read/write classification, telling "never sent"
  from "sent" in `send`, `OutcomeUnknownError`, a hook for a transport to mark
  an error as never-sent, and removal of the per-call `retries: 0` opt-outs
  that the rule makes redundant.
- **DomBot:** the `ProxyError` mapping in both host transports, the re-fetch
  and three-state reporting in `applyDomainOp`, the bulk runner and MCP, and
  deletion of the Namecheap command allowlist and the renew special case.

## Decisions

- **Page name:** Proxy.
- **Test endpoint:** Cloudflare trace, falling back to ipinfo.io.
- **Workers CPU cost:** not a blocker. `tunnelfetch` does TLS in JavaScript, so
  phase 3 measures a detailed multi-registrar sync through it; the toggle ships
  for every registrar on both hosts regardless.
