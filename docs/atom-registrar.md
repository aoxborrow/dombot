# Atom as a registrar

Plan for adding Atom.com Domains LLC (IANA 4547, "AtomRegistrar") as a
registrar: an `atom` adapter in registrar-client, then an Atom card in
Settings → Registrars, so names held at Atom sync like any other account.
Requested in #180.

This is a registrar account, like Dynadot or Name.com. It's separate from
the Atom market account in [atom-api.md](atom-api.md): a different API, a
different token and a different card. The two share a company name and a
pair of nameservers, and nothing in DomBot links them.

## Status

Plan only (2026-11-03). Nothing is built, and there's no registrar token
yet, so the shapes below come from Atom's spec. One thing was checked live:
the seller token doesn't work on the registrar API ("Credentials").

## Credentials: their own token

- **Registrar API:** `Authorization: Bearer <registrar token>`. Atom issues
  the token on Dashboard → API Access
  (<https://www.atom.com/dashboard/seller/api-access>) after it grants
  Registrar API access. That access is a separate request from seller access.
- **Checked live (2026-11-03):** `GET /domains` with the seller `api_token`
  as the Bearer token returns 401 Unauthorized, "Invalid registrar API token
  or access has been revoked. Please request registrar API access from your
  dashboard.", the same answer as no token or a made-up one. The seller
  token isn't a registrar token. (The reverse doesn't matter: seller calls
  also need the numeric `user_id`.)
- **Access is a limited beta.** Atom's
  [API access article](https://www.atom.com/help/article/atom-seller-api-access)
  asks for about 100 names in the Atom registrar account, or an active seller
  account. Rate limits are shown on the API access page, not in the docs.

So there's no shared key, and the "One provider, registrar and market"
design in atom-api.md (a market account borrowing the registrar key through
`registrarAccountId`) doesn't apply to Atom:

- An Atom registrar account stores its token in `registrar-credentials` like
  every other registrar. The Atom market account keeps its own
  `market-credentials` entry. Neither card mentions the other.
- `MarketAccount.registrarAccountId` (commented "Atom, later") stays unused
  for Atom. Keep it for Dynadot or Namecheap if their market and registrar
  sides share a key, or drop it if they don't either.

What already connects them, with no link:

- **Nameservers:** `src/core/markets/atom/nameservers.ts` names Atom's
  marketplace pair (`ns1/ns2.atom.com`) and AtomRegistrar's pair
  (`ns1/ns2.atomregistrar.com`), so the Nameservers filter recognizes both
  whichever account holds the name.
- **Moving a name onto Atom's nameservers** for an Atom listing goes through
  whichever registrar holds it, with the ordinary nameservers op. For a name
  at Atom, the adapter turns that host pair into `type: "atom"` (below).
- **RDAP:** once `data/registrar-mapping.json` has an `atom` entry with IANA
  ID 4547, a name whose RDAP says "Atom.com Domains LLC" maps to the built-in
  registrar.

## The API at a glance

| What        | Atom registrar API                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base        | `https://www.atom.com/api/registrar/v1` (the guide also writes it without `www`)                                                                             |
| Dev         | `https://dev.atom.com/api/registrar/v1`, purpose and token unknown                                                                                           |
| Auth        | `Authorization: Bearer`, registrar token                                                                                                                     |
| Operations  | 32: domains, availability, TLD pricing, register, renew, transfer in, nameservers, DNS, DNSSEC, URL forwards, lock, privacy, auto-renew, contacts            |
| Envelope    | `{success, data, message}`; errors `{success: false, error, message}` with a real HTTP status (400, 401, 403, 404, 409, 429, 500)                            |
| Paging      | `GET /domains`: `page` from 1, `size` default 20, max 100, plus `search` and `extension`; `pagination: {current_page, total_pages, per_page, total_records}` |
| Dates       | `YYYY-MM-DD HH:MM:SS`, no zone                                                                                                                               |
| Money       | USD, decimal. Quotes split `unit_price`, `renewal_price`, `icann_fee`, `vat_rate`, `vat_amount` and `total`                                                  |
| Rate limits | 429 documented, numbers on the API access page                                                                                                               |
| Spec        | <https://apidocs.atom.com/api-reference/registrar_apis/openapi.json>; index at <https://apidocs.atom.com/llms.txt>                                           |

Unlike the seller API, errors come back with an error status rather than
HTTP 200, and the token is a header, not a query parameter. The client
should still read `success` on every 200.

The spec types many 200 responses only as `object`: register, renew,
transfer, nameservers (read), URL forwards, DNSSEC and domain contacts.
Those shapes come from the first live responses.

## registrar-client adapter

A new `atom` registrar, `createRegistrar('atom', { apiKey })`, with
`docs/registrars/atom.md` and a row in the README's capability matrix.

| Method                                       | Atom call                                                                                              | Notes                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testConnection`                             | `GET /domains?size=1`                                                                                  | The 401 above becomes an `AuthenticationError` that says Registrar API access is a separate request.                                                                                        |
| `listDomains`                                | `GET /domains`, `size=100`                                                                             | Follow `pagination`; reject a missing page or a total that doesn't add up. Rows carry expiry, auto-renew, privacy, `transfer_locked`, nameservers and `status` (values unknown).            |
| `getDomain`                                  | `GET /domains/{d}`                                                                                     | Adds `dnssec_enabled` and the four contact handles.                                                                                                                                         |
| `checkAvailability`                          | `POST /domains/check-bulk`, 50 a call                                                                  | `availability` 1, 0 or -1 (unknown). Available names carry `domain_price` with `is_premium`.                                                                                                |
| `getPricing`                                 | `GET /tld-pricing`; `GET /domains/check/{d}` for one name                                              | Register, renew, transfer and `icann_fee` per TLD. The per-name check is the only premium quote, and only for an available name.                                                            |
| `registerDomain`                             | `POST /domains/register`                                                                               | 1–10 years; `.ai` even only. Charges the balance or a saved card. 409 if already in the account. Nameservers, privacy, auto-renew, contact handles and DNS records can go in the same call. |
| `renewDomain`                                | `POST /domains/{d}/renew`, `{renewal_length}`                                                          | `.ai` even only. Described as returning the new expiry and a `price_breakdown`; untyped.                                                                                                    |
| `setAutoRenew`                               | `PUT /domains/{d}/auto-renew`, `{enabled}`                                                             |                                                                                                                                                                                             |
| `transferIn`                                 | `POST /domains/transfer`, `{domain_name, authcode}`                                                    | Nameservers, auto-renew and DNS apply when the transfer completes (5–7 days). A bulk call takes 10; the library transfers one name per call.                                                |
| `getNameservers`                             | `GET /domains/{d}/nameservers`                                                                         | Untyped. Whether it reports the `type` is unknown.                                                                                                                                          |
| `updateNameservers`                          | `PUT /domains/{d}/nameservers`, `{type, nameservers}`                                                  | `ns1/ns2.atom.com` → `type: "atom"`; `ns1/ns2.atomregistrar.com` → `parking`; anything else → `custom` with the list.                                                                       |
| `lockDomain`                                 | `PUT /domains/{d}/lock`, `{locked: true}`                                                              | Doesn't lift or touch the ICANN 60-day lock.                                                                                                                                                |
| `unlockDomain`                               | none                                                                                                   | `{locked: false}` returns 403. Dashboard only: `NotImplementedError` saying so.                                                                                                             |
| `setPrivacy`                                 | `PUT /domains/{d}/privacy`, `{enabled}`                                                                | Not available for `.io`; refuse before the call.                                                                                                                                            |
| `getContacts`                                | `GET /domains/{d}/contacts`                                                                            | Handles, plus full records when the handles belong to the account. `address` is an array of lines.                                                                                          |
| `updateContacts`                             | `GET /contacts?email=`, `POST /contacts` or `PUT /contacts/{handle}`, then `PUT /domains/{d}/contacts` | Contacts are handles: find or create one, then assign it to roles. Two calls at least, not atomic.                                                                                          |
| `getDnsRecords`                              | `GET /domains/{d}/records`                                                                             | Only on `atom` or `parking` nameservers. Integer ids. The record schema has no `priority`, so MX priority on read needs checking.                                                           |
| `setDnsRecords`                              | `POST` / `PUT /records/{id}` / `DELETE /records/{id}`                                                  | Diff and reconcile. `PUT` changes only `content`, `ttl` and `comment`, so a name or type change is a delete and a create. Types: A, AAAA, CNAME, MX, TXT, NS, SRV, CAA, PTR. Not atomic.    |
| `getDomainForwarding`, `setDomainForwarding` | `GET` / `POST` / `DELETE /domains/{d}/url-forwards`                                                    | `{source, destination, type: temporary \| permanent}`; no masked forwarding and no update, so a change is a delete and a create. What `source` holds (a host or a URL) is unknown.          |
| `getDnssec`, `disableDnssec`                 | `GET /dnssec`, `POST /dnssec/disable`                                                                  | Atom also has enable; the library has no enable method.                                                                                                                                     |
| `getAuthCode`, transfer-out approval         | none                                                                                                   | Dashboard only. Not declared.                                                                                                                                                               |
| Email forwarding                             | none                                                                                                   | Not declared.                                                                                                                                                                               |

Also in Atom's domain rows, and useful for sales: `icann_transfer_lock`,
`icann_transfer_lock_expires_at` and `can_transfer_out`. They say when a
sold name can leave. Carry them in the domain's raw data at first; a shared
field can come later if other registrars report the same.

Leave out: coupons on register, bulk transfer-in, DNSSEC enable, the
guide's `PUT /dns/bulk-update` (not in the spec) and `bulk-delete` (the diff
covers it).

## DomBot

After registrar-client releases `atom`:

- **Help:** a `REGISTRAR_HELP.atom` entry (the build fails without one). A
  Registrar API token from Dashboard › API Access; Registrar API access is
  its own request, and the marketplace token won't work. DNS records can only
  be edited on Atom nameservers. Unlocking and auth codes are dashboard-only.
- **Known gaps** in `src/shared/domain-ops.ts`: unlocking, privacy on `.io`,
  renewing a `.ai` name for an odd number of years.
- **Registrar mapping:** an `atom` entry in `data/registrar-mapping.json`,
  IANA ID 4547, through `scripts/update-registrars.mjs`.
- **Demo:** `defaultNameservers` gets `ns1/ns2.atomregistrar.com`.
- **Logo:** reuse `site/src/assets/logos/atom.svg`.
- **Sales:** a name sold on Afternic or Sedo but held at Atom has no API
  auth code and no transfer-out approval. The sale steps already handle
  that (the paste box for registrars without `getAuthCode`); the user
  unlocks and copies the code in Atom's dashboard.
- **Renewal pricing:** check whether the tldes dump behind
  `npm run pricing:build` lists Atom. If not, renewal prices come from
  `getPricing` (`/tld-pricing`) like any registrar missing there.
- **Naming:** the card is "Atom" under Registrars, and the market card stays
  "Atom" under Markets. They're on different tabs, so no qualifier is needed.

## Testing

- **Access first.** Request Registrar API access from the dashboard. Until
  it's granted, build against fixtures made from the spec.
- **Live tests** in registrar-client, gated by `ATOM_REGISTRAR_API_KEY`:
  reads first; writes on one test name held at Atom, chosen with the user and
  put back afterwards; register, renew and transfer-in last, as with the
  other registrars.
- **`dev.atom.com`:** ask Atom whether it's a sandbox with test funds and
  whether it takes its own token.

## Phases

1. **Access and shapes:** get a registrar token; capture the untyped
   responses (nameservers read, URL forwards, DNSSEC, domain contacts,
   renew); record them in `docs/registrars/atom.md`.
2. **registrar-client, reads:** connection test, list, get, availability,
   pricing, nameservers, DNS, contacts, URL forwards, DNSSEC.
3. **registrar-client, writes:** auto-renew, lock, privacy, nameservers, DNS,
   URL forwards, contacts, DNSSEC off; then register, renew and transfer-in.
   Release.
4. **DomBot:** bump registrar-client; help, known gaps, mapping, demo
   nameservers, logo. Closes #180.

## Open questions

1. Is `dev.atom.com` a sandbox, and which token does it take?
2. The rate limit (on the API access page once access is granted).
3. Domain `status` values, and whether the list includes names in a pending
   transfer-in, expired or deleted.
4. Shapes of the untyped responses (see Phase 1).
5. Does a TLD's `renew` price include the ICANN fee, which quotes list
   separately?
6. Does a registrant change through `PUT /domains/{d}/contacts` start the
   ICANN 60-day lock?
7. URL forwards: is `source` a host or a full URL, and are subdomains
   allowed?
8. Where MX priority lives on a DNS record read.
