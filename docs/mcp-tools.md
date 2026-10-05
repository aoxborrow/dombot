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

**Resolving the registrar.** On `domain_*` tools, an omitted `registrar` is
looked up in the cached portfolio, since you own the domain. A name the cache
doesn't have fails with a message to pass `registrar` or run `portfolio_sync`;
a name the cache lists under two registrars (a stale transfer) fails asking
for `registrar`. Pass it to skip the lookup or for a name not synced yet.

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
  every account. Filters: `accountId`, `registrar`, `tld`, `folder` (a name, an
  id, or `Hidden`), `nameContains`, `nameserverContains`, `autoRenew`,
  `locked`, `privacy`, `status`, `expiresBefore`, `expiresAfter`,
  `expiringWithinDays`. Plus `sort`, `order`, `limit` and `offset`. Returns
  `{ total, fetchedAt, stale, registrars, errors, rows }`. No registrar calls.
- **`portfolio_sync`** — re-sync every active account and return a
  per-account summary (counts, last sync, errors).

## Registrar

- **`registrar_test`** — test an account's credentials.
- **`registrar_domains`** — list every domain in the account, live.
- **`registrar_sync`** — re-sync one account into the cache.
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

All take `domain`, optional `registrar` and optional `accountId`.

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
