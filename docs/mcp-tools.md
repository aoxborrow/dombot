# MCP tools — scope-based structure

Plan for restructuring the MCP tool surface in [`src/main/mcp/tools.ts`](../src/main/mcp/tools.ts)
so that every tool's **scope is obvious** (portfolio / registrar / domain), the
naming is consistent, and the full non-forwarding capability of
`@aoxborrow/registrar-client` is exposed. Writes are **not** gated behind extra
per-call approval — the connection-level OAuth approval is the gate.

## Goals

1. **Scope is legible.** A caller can tell at a glance whether a tool acts on the
   whole portfolio, one registrar, or one domain.
2. **Consistent names** under scope prefixes, so the tool list self-groups.
3. **Resolve the registrar** for domain-level tools, so an agent that found a
   domain via `portfolio_list` doesn't have to track where it lives.
4. **Cover the surface** — every `RegistrarClient` method gets a tool (money ops
   included), plus dombot's own renewal-price estimate. Forwarding is deferred
   (needs a client-facade change — see below).

## Scope model

Scope is defined by the **required parameter signature**, and encoded in the name
prefix:

| Scope | Required params | Name prefix | Meaning |
|---|---|---|---|
| **Portfolio / account** | *(none)* | `portfolio_`, `registrar_list` | Global or cross-registrar aggregate |
| **Registrar** | `registrar` | `registrar_` | A provider, or a domain not yet owned there (register / transfer-in) |
| **Domain** | `domain` (+ optional `registrar`) | `domain_` | One domain you own |

Naming pattern: **`<scope>_<resource>_<action>`**, dropping `<resource>` when the
scope already is the resource. `snake_case` throughout.

## Registrar resolution (domain-level tools)

Domain-level tools take `domain` as required and `registrar` as **optional**:

- If `registrar` is given, use it.
- If omitted, look `domain` up in the cached portfolio (`Domain.registrar`) and
  use that. The aggregated portfolio is already cached on disk
  (`services/registrars.ts` → `getCachedPortfolio`).
- If the domain isn't in the cache → error asking the caller to pass `registrar`
  (and suggesting they run `portfolio_list` first).
- If the domain resolves to more than one registrar (rare) → error listing the
  candidates and asking for an explicit `registrar`.

Implemented once as a helper, e.g. `resolveRegistrar(domain, registrar?)`, reused
by every domain-level handler. Registrar-level tools (`register`, `transfer`)
keep `registrar` **required** — the domain isn't owned at the target yet, so
there's nothing to resolve.

## Tool catalog

Backing calls go through the shared `services/` layer (same core the UI IPC uses),
which wraps `RegistrarClient`. `R.method` = `RegistrarClient` method.

### Portfolio / account

| Tool | Backing | Params | Annotations | Status |
|---|---|---|---|---|
| `registrar_list` | `getConfiguredRegistrars` + metadata | — | readOnly | **rename** of `list_registrars` |
| `portfolio_list` | `listPortfolio` | `refresh?` | readOnly | **rename** of `list_portfolio` |

### Registrar-level (`registrar` required)

| Tool | Backing | Params | Annotations | Status |
|---|---|---|---|---|
| `registrar_test` | `R.testConnection` | `registrar` | readOnly | **new** |
| `registrar_domains` | `R.listDomains` | `registrar` | readOnly | **rename** of `list_domains` |
| `registrar_check_availability` | `R.checkAvailability` | `registrar`, `domains[]` | readOnly | **rename** of `check_availability` |
| `registrar_pricing` | `R.getPricing` | `registrar`, `tld` | readOnly | **new** |
| `registrar_register_domain` | `R.registerDomain` | `registrar`, `domain`, `input`¹ | write · not idempotent (creates, costs money) | **new** |
| `registrar_transfer_domain` | `R.transferIn` | `registrar`, `domain`, `input`² | write · not idempotent (costs money) | **new** |

¹ `RegisterDomainInput`: `contacts` (ContactSet, registrant required), `years?`,
`nameservers?`, `privacy?`, `autoRenew?`, `consent?`.
² `TransferDomainInput`: `authCode` (required), `years?`, `contacts?`, `consent?`,
`privacy?`, `autoRenew?`.

### Domain-level (`domain` required, `registrar` resolved)

| Tool | Backing | Params | Annotations | Status |
|---|---|---|---|---|
| `domain_get` | `R.getDomain` | `domain`, `registrar?` | readOnly | **new** |
| `domain_renew` | `R.renewDomain` | `domain`, `registrar?`, `years?` | write · not idempotent (costs money) | **new** |
| `domain_set_autorenew` | `R.setAutoRenew` | `domain`, `registrar?`, `enabled` | write · idempotent | **rename** of `set_auto_renew` |
| `domain_set_lock` | `R.lockDomain` / `unlockDomain` | `domain`, `registrar?`, `locked` | write · idempotent | **rename** of `set_lock` |
| `domain_set_privacy` | `R.setPrivacy` | `domain`, `registrar?`, `enabled` | write · idempotent | **new** |
| `domain_nameservers_get` | `R.getNameservers` | `domain`, `registrar?` | readOnly | **rename** of `get_nameservers` |
| `domain_nameservers_set` | `R.updateNameservers` | `domain`, `registrar?`, `nameservers[]` | write · destructive · idempotent | **rename** of `set_nameservers` |
| `domain_dns_get` | `R.getDnsRecords` | `domain`, `registrar?` | readOnly | **rename** of `get_dns_records` |
| `domain_dns_set` | `R.setDnsRecords` | `domain`, `registrar?`, `records[]`³ | write · destructive · idempotent | **new** |
| `domain_contacts_get` | `R.getContacts` | `domain`, `registrar?` | readOnly | **new** |
| `domain_contacts_set` | `R.updateContacts` | `domain`, `registrar?`, `contacts`⁴ | write · idempotent | **new** |

³ `DnsRecord[]`: `{ type, name, value, ttl?, priority?, weight?, port? }`. `_set`
replaces the full record set — mirror the client's replace semantics in the
description.
⁴ `ContactSet`: `{ registrant?, admin?, tech?, billing? }`, each a `Contact`.

### Deferred

| Tool | Backing | Why deferred |
|---|---|---|
| `domain_renewal_price` | `services/pricing.ts` → `getRenewalPrice` | dombot-specific estimate (base TLD pricing + manual overrides), **not** a registrar call. Distinct from `registrar_pricing` (live registrar pricing). **Punted to the last phase.** |
| `domain_forwarding_get` / `_set` | `getEmailForwarding` / `getDomainForwarding` (+ set) | These exist only on the **provider** base class (`registrar.ts`), not on the `RegistrarClient` facade dombot consumes — and are `notImplemented` per registrar. Needs a facade addition in the sibling repo first; support is per-registrar. **Out of scope for this PR.** |

## Conventions

- **snake_case**, scope-prefixed. Grouped in the list by prefix for discovery.
- **Read / write always split** — never a `mode` flag — so annotations stay honest:
  reads → `readOnlyHint`; full-replacement writes (`_set`, nameservers, dns) →
  `destructiveHint + idempotentHint`; `register` / `renew` / `transfer` → neither
  (they create / cost money).
- **Binary state folded into one tool** (`set_lock(locked)`, `set_autorenew(enabled)`,
  `set_privacy(enabled)`) rather than separate enable/disable.
- **Consistent params:** `registrar` and `domain` mean the same thing everywhere;
  their presence in the schema signals the scope.
- **Descriptions state scope** ("Across all configured registrars…", "At one
  registrar…", "For a single domain…") and note replace-semantics where relevant.
- **Output** stays the pretty-printed-JSON `json()` helper already in `tools.ts`.

## Non-goals / notes

- No per-call approval or extra auth on writes (per decision) — money-moving tools
  are ordinary write tools with accurate annotations and clear descriptions.
- Renaming the existing 9 tools is a breaking change to tool names, acceptable
  this early; agents rediscover tools each session.
- The landing page's MCP bullet list will be reconciled separately once these land
  (it currently over-promises: pricing, DNS-set, contacts, forwarding,
  register/renew/transfer).

## Implementation phases

1. **Resolver + rename.** Add `resolveRegistrar`; rename the 9 existing tools to
   the scheme; make domain-level `registrar` optional. No behavior change beyond
   resolution.
2. **New reads.** `registrar_test`, `registrar_pricing`, `domain_get`,
   `domain_contacts_get`.
3. **New non-money writes.** `domain_dns_set`, `domain_contacts_set`,
   `domain_set_privacy`.
4. **Money writes.** `registrar_register_domain`, `registrar_transfer_domain`,
   `domain_renew`.
5. **Renewal price (punted).** `domain_renewal_price` via `services/pricing.ts`.
6. **Forwarding (separate PR).** After the `RegistrarClient` facade gains
   forwarding methods in the sibling repo.

Each phase: `npm run typecheck` clean, commit, push to the draft PR.
