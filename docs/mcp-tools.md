# MCP tools

DomBot's MCP server exposes the portfolio and every registrar operation it
supports as tools. They're registered by `registerTools` in
[`src/core/mcp/tools.ts`](../src/core/mcp/tools.ts) and call the same services
as the app, so a write from an agent patches the cache and updates an open
Domains table the same way a row control does. How to connect a client is in
the [README](../README.md#connecting-an-ai-agent) and in the app under
Settings → MCP.

Writes aren't gated behind a per-call approval: approving the client's
connection in DomBot is the gate. Money ops (register, transfer, renew) say so
in their descriptions.

## Scope and parameters

The name prefix says what a tool acts on:

- **`portfolio_*`** and **`registrar_list`**: the whole portfolio, no scope
  params.
- **`registrar_*`**: one registrar account. `registrar` is required (a
  registrar id such as `dynadot`).
- **`domain_*`**: one domain you own. `domain` is required; `registrar` is
  optional.
- **`folder_*`**: DomBot's own folders. A folder is named by its name or id
  (case-insensitive); `Hidden` is the built-in folder. No registrar calls.

**Resolving the registrar.** On `domain_*` tools, an omitted `registrar` is
looked up in the cached portfolio, since you own the domain. A name the cache
doesn't have fails with a message to pass `registrar` or run `portfolio_sync`;
a name the cache lists under two registrars (a stale transfer) fails asking
for `registrar`. An imported name fails saying no connected account reports
it. Pass it to skip the lookup or for a name not synced yet.

**Choosing an account.** Every `registrar_*` and `domain_*` tool takes an
optional `accountId` (from `registrar_list`); labels aren't accepted. With
`accountId` alone, the registrar comes from that account. Without it, a domain
tool uses the one enabled, configured account whose cache holds the name, and
a registrar tool uses the registrar's only configured account. When that's
ambiguous, or the chosen account is disabled, has no credentials, or doesn't
hold the domain in the cache, the call fails before reaching the registrar.
See [multi-account.md](multi-account.md#mcp).

**Cache.** Reads marked "cached" serve the local cache when it's fresh and
take `refresh` to fetch live and write the result through.

## Portfolio

- **`registrar_list`** — every registrar id, plus each account's `accountId`,
  `registrar`, `label`, `configured`, `enabled`, `proxy` (whether it routes
  through the fixed IP proxy) and `sync` state. Also the `configured` and
  `active` registrar ids. No secrets. Start here.
- **`portfolio_query`** — list, search and filter the cached portfolio across
  every account, plus the names you imported. Filters: `ownership` (`owned`,
  the default, `archive` or `all`, as the Domains page's Owned / Archive
  switch), `accountId`, `registrar`, `source` (`registrar` or `imported`),
  `tld`, `folder` (a name, an id, or `Hidden`), `nameContains`,
  `nameserverContains`, `autoRenew`, `locked`, `privacy`, `status`,
  `expiresBefore`, `expiresAfter`, `expiringWithinDays`. Plus `sort` (also
  by `renewalPrice`, compared as numbers whatever the currency), `order`,
  `limit` and `offset`. No registrar calls. Returns
  `{ total, fetchedAt, stale, registrars, errors, rows }`.
  - Each row carries `ownership`, `archiveLabel` (`sold`, `dropped`,
    `archived`, or `removed` for a removal you haven't labeled), `hidden`, and
    `inAccount`.
  - Hidden names count as owned: they're still yours and still renew.
  - Each row also carries what DomBot keeps for the name: `paid` (date,
    amount, currency, and `kind`: registered or purchased), `sold`, `notes`,
    `askingPrice` (`amount`, `minOffer`, `floor`, `currency`) and
    `renewalPrice` (DomBot's yearly estimate with its `source`, as
    `domain_renewal_price`). Each is `null` when there's nothing on record.
  - An imported name has `source: 'imported'`, no `accountId`, `inAccount:
false`, and `registrarLabel` when you typed a registrar DomBot doesn't
    know. Its `autoRenew` is what you told DomBot, or `null`.
  - An Archive name can still be in an account (a sale in escrow). One no
    account reports has `inAccount: false`, its last known registrar, and
    `null` for the settings an account reports. The `domain_*` tools can't act
    on it.
- **`portfolio_sync`** — re-sync every active account and return a
  per-account summary (counts, last sync, errors).

## Folders

The same folders as Settings → Folders and the Domains table's folder column,
in the same store, so a change shows up in an open window right away. Folder
names are kept unique (case-insensitive), and none may be called `Hidden`.

- **`folder_list`** — every folder's `id`, `name`, `description`, `color`,
  `builtIn` and `domainCount`, ending with the built-in Hidden folder
  (`__hidden__`).
- **`folder_create`** — `name`, `description?`, `color?` (one of the app's
  palette keys; default `blue`). Returns the new folder.
- **`folder_rename`** — `folder`, `name`. Returns `{ id, name, previousName }`.
  Hidden can't be renamed.
- **`folder_delete`** — `folder`. Its domains go back to no folder; nothing is
  deleted at a registrar. Returns `{ id, name, deleted, unassigned }`. Hidden
  can't be deleted.
- **`domain_set_folder`** — `domain`, `folder` (a name, an id, `Hidden`, or
  `null` for no folder). A domain is in at most one folder, so this replaces
  any current one. The domain must be in your portfolio, owned or Archive.
  Returns `{ domain, folder, previous }`.

## Notes, prices and ownership

DomBot's own data about a name, written through the same services as the
app. No registrar calls. Each takes `domain`, which must be in your portfolio:
synced, imported, or with history.

- **`domain_note_set`** — `notes`, replacing the note; `""` deletes it.
  Returns `{ domain, notes }`.
- **`domain_asking_price_set`** — `amount?` (BIN), `minOffer?`, `floor?`,
  `currency?`. Replaces the asking price: what's left out is cleared, and all
  three left out removes it. `currency` is required unless clearing. Returns
  `{ domain, askingPrice }`.
- **`domain_renewal_price_set`** — `amount` (`null` clears it), `currency?`
  (default `USD`). Your yearly price, which `domain_renewal_price` then
  reports with source `manual`. Returns `{ domain, renewalPrice }`.
- **`domain_ownership_set`** — `ownership`: `dropped` or `archived` moves the
  name to Archive; `owned` undoes your Sold, Dropped or Archived mark (Move
  back to Owned). `date?` defaults to today. A name in Archive only because
  sync saw it leave can't be moved back. Returns `{ domain, ownership,
archiveLabel }`.

Events these record have `source: 'agent'`, shown as **Agent** in Activity, so
you can tell what an agent did from what you did. Otherwise an agent's mark
behaves like yours: your next mark replaces it, and Move back to Owned undoes
it.

## Registrar

- **`registrar_test`** — test an account's credentials.
- **`registrar_domains`** — list every domain in the account, live.
- **`registrar_sync`** — re-sync one account into the cache.
- **`registrar_set_enabled`** — `enabled`: turn an account on or off, as the
  app does. A disabled account keeps its credentials but doesn't sync, and its
  names leave `portfolio_query`; enabling syncs it. Adding, removing and
  credentials stay in the app.
- **`registrar_check_availability`** — `domains[]`: whether each can be
  registered.
- **`registrar_pricing`** — `tld` (or a domain): the registrar's live
  registration, renewal and transfer prices.
- **`registrar_register_domain`** — `domain`, `input` (`contacts` with a
  registrant, `years?`, `nameservers?`, `privacy?`, `autoRenew?`,
  `consent?`). Costs money.
- **`registrar_transfer_domain`** — `domain`, `input` (`authCode`, `years?`,
  `contacts?`, `privacy?`, `autoRenew?`, `consent?`). Costs money.

## Domain

All take `domain`, optional `registrar` and optional `accountId`, except
`domain_set_folder`.

Reads:

- **`domain_get`** — the full record: status, dates, auto-renew, lock,
  privacy, nameservers. Cached; `refresh?`.
- **`domain_nameservers_get`** — nameservers, from the registrar or the
  public registry. Cached; `refresh?`.
- **`domain_contacts_get`** — registrant, admin, tech and billing contacts.
- **`domain_dns_get`** — DNS records at the registrar.
- **`domain_dnssec_get`** — whether DNSSEC is on, and its DS records.
- **`domain_email_forwarding_get`** — email forwarding rules.
- **`domain_url_forwarding_get`** — URL forwarding rules, including read-only
  `masked` ones.
- **`domain_auth_code_get`** — the EPP/auth code. A secret.
- **`domain_renewal_price`** — DomBot's estimated annual renewal price and
  where it came from: your manual price, a per-name quote, the account's TLD
  rate, or the base database. Not the registrar's live quote (that's
  `registrar_pricing`).

Writes:

- **`domain_set_autorenew`** — `enabled`.
- **`domain_set_lock`** — `locked`.
- **`domain_set_privacy`** — `enabled`.
- **`domain_nameservers_set`** — `nameservers[]`.
- **`domain_dns_set`** — `records[]` (`type`, `name`, `value`, `ttl?`,
  `priority?`, `weight?`, `port?`). Replaces the whole set.
- **`domain_contacts_set`** — `contacts` (any of the four roles).
- **`domain_email_forwarding_set`** — `forwards[]` (`alias`, `forwardTo`).
  Replaces the whole set; an empty array clears it.
- **`domain_url_forwarding_set`** — `forwards[]` (`host`, `url`, `type`:
  `temporary` or `permanent`). Replaces the whole set; an empty array clears
  it.
- **`domain_renew`** — `years?` (default 1). Costs money.
- **`domain_set_folder`** — see [Folders](#folders). Local only, so it takes
  no `registrar` or `accountId`.

Auto-renew, lock, privacy, nameservers, forwarding and renew run through the
same dispatcher as the Domains table ([domain-editing.md](domain-editing.md)),
so they're gated by what the registrar supports and return `{ accountId,
registrar, success, status, message }`. `status` is `ok`, `failed`,
`unsupported`, `skipped`, `rate-limited`, `cancelled`, or `unknown` when a
write's outcome couldn't be confirmed; the message says whether it's safe to
try again. `domain_dns_set` and `domain_contacts_set` return the registrar's
`{ success, message }`. `domain_auth_code_get` goes through the dispatcher too
and returns `{ domain, authCode }`, or fails with the reason.

Not every registrar supports every tool; an unsupported call fails with the
reason. The support matrix is in
[domain-editing.md](domain-editing.md#what-each-registrar-supports).
