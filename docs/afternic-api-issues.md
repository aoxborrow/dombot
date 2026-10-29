# Afternic Portfolio API: issues found

Problems found while building DomBot's Afternic integration against the
Aftermarket Portfolio API (<https://api.afternic.com/docs/portfolio-api/>),
written to report to Afternic. Everything here was checked against a live
seller account between 2026-10-27 and 2026-10-28; the integration plan with
the full context is [afternic-api.md](afternic-api.md).

Each issue says what was called, what the docs say, and what happened.
Request ids are the `X-Request-Id` we sent, for Afternic's logs. Transaction
ids, domain names and amounts from the account are left out of this public
file and can be shared privately.

Status: **open** until Afternic answers; update each entry as it's resolved.
On 2026-10-29 the [changelog](https://api.afternic.com/docs/portfolio-api/changelog/)
(entries 2026-10-25 to 2026-10-28) covered #7 and #13, marked below. The
current docs still read as described for #5, #6, #8, #9 and #12. The bugs
aren't in the changelog and haven't been retested.

## Bugs

### 1. Purchases appear in the sales list, and look like sales

`GET /v3/aftermarket/customers/my/sales` returns transactions where the
account was the **buyer**, mixed in with its sales, in exactly the same
shape. The sale schema has no field saying which side the account was on.

On the test account, 2 of the 41 records were domains the seller had bought
on Afternic. Each came back as an ordinary completed sale:

```json
{
  "transactionId": "…",
  "name": "<a domain the account bought>",
  "soldAt": "2021-05-04T17:06:42.000Z",
  "status": "COMPLETED",
  "saleType": "BUYNOW",
  "salePrice": 450000000,
  "commission": 90000000
}
```

What sets them apart, indirectly:

- `GET /sales/{transactionId}` answers **404** `RESOURCE_NOT_FOUND`
  ("Transaction '…' not found") for both purchases, and 200 for every one of
  the 39 real sales, including the oldest (2020), leases and a cancelled one.
  So the single-sale endpoint covers only the account's sales, while the list
  also includes its purchases. Request ids of the 404s:
  `c0464014-e0fa-41fc-9514-bc64f9254f65`,
  `4be9f440-d39d-42c7-8819-cb9cf6109b17`.
- They're the only completed `BUYNOW` records with no `disbursedAt`.
- They still carry a `commission`, which a buyer doesn't pay.

Impact: anything built on the list counts purchases as sales, so a seller's
sales totals, net income and sell-through are wrong, and an integration may
record a domain the seller still owns as sold.

Expected: either leave purchases out of `/sales`, or include them with a
field that says which side the account was on (for example
`role: "SELLER" | "BUYER"`), and make `/sales/{id}` and the list agree.

### 2. Bulk job files with a repeated name lose other rows' results

A `BULK_JOB` upload with three rows (one name with a valid change, a row
with an invalid domain name, and the first name again with an invalid
price) finished `COMPLETED` with `totalRequests: 3` but `totalFailures: 1`,
and the results file had **one** row: the first name's failure. The invalid
domain row, which fails on its own when uploaded alone, was missing from
the results, and the first row's valid change wasn't applied.

Expected: one result row per uploaded row, or a validation error naming
the duplicate, rather than rows disappearing from the results.

### 3. Max lease period is ignored without an error

Setting `maxLeasePeriod` on a listing priced at $2,500: 24 was saved, but 31
and 36 left it unchanged, with no error, through both
`PATCH /domains/{domain}` (204) and a bulk job (`NO_CHANGE`). The values
across the account suggest a minimum monthly payment of roughly $81–83 caps
the number of payments.

Expected: a 422 naming the field and the allowed maximum for this price, as
the price-order checks already do (`floorPrice cannot be less than
minbidPrice`), or the rule documented.

### 4. New listings don't take the account's lease default

The account settings say `maxLeasePeriod: 60`, but a listing created with
`POST /domains` (without `maxLeasePeriod`) came back with
`maxLeasePeriod: 30`. `leasingEnabled` did follow the account setting.
Possibly the same price cap as issue 3, applied silently.

## Docs that don't match the API

### 5. Stats `startDate` is the end of the window, not the start

The Common Workflows guide says `startDate=2026-09-01T00:00:00Z&days=30`
"cover[s] 30 days starting September 1". The API counts `days` **backwards**
from `startDate`: with `days=365` and no `startDate`, the window ends today
(the first day returned is 364 days ago). The reference's description
("A default time of current timestamp is used") fits that reading; the
guide's example doesn't. Affects `GET /stats` and `GET /stats/{domain}`.

### 6. Sales `limit` is capped at 100, documented as 1000

The reference for `GET /sales` gives `limit` a range of 1–1000. Any value
over 100 is rejected: 400 `BAD_REQUEST`, field `limit`, "limit must be at
most 100". Request id: `ba197620-5e28-4ac9-bfdf-b2f5f967b6e2`.

### 7. Stats `days` maximum: 365 or 366

The Common Workflows guide says `days` can be 1 through 366; the reference
says at most 365. 365 is what the API takes.

**Partly fixed.** The changelog (2026-10-25) corrects the documented maximum
to 365, but the Common Workflows guide still said "1 through 366" on
2026-10-29.

### 8. `PATCH ?resource=true` returns no resource

The reference says `resource=true` makes `PATCH /domains/{domain}` return
the updated domain. It returns 204 with no body either way, so a client has
to read the domain back.

### 9. `tld` isn't returned on domains

The example response in the guides includes `"tld": "com"`; no domain
response (list, get, get many) has included it. The reference examples for
`GET /domains` and `PATCH /domains/{domain}` pair `"name": "example.com"`
with `"tld": "co.uk"`.

### 10. Per-domain leads aren't on domains

`GET /domains` takes `order=LEADS_DESC` and `INTAKE_VIEWS_DESC`, and the
reference's example response includes `intakeLeads`, but no field with leads
or views comes back on a domain with any `includes`. The only per-domain
leads are from `GET /stats/{domain}`, one call per name, which for a large
portfolio is hours of the 150-a-minute rate limit.

Request: return the counts the sort already uses (leads and views over a
fixed window) as an `includes` option.

### 11. `registrar` is free text, not an enum

The reference's examples show `"registrar": "GODADDY"`. Real values include
`"GoDaddy.com, LLC"`, `"GODADDY"`, `"Dynadot Inc"` and `"Dynadot, LLC"` (the
same registrar two ways), `"UNKNOWN"`, `"Unknown .DE registrar"`, and the
field is sometimes missing. A stable identifier (IANA registrar id, or a
fixed enum) beside the display name would let integrations match it.

## Missing or unclear

### 12. `RECONCILE_JOB` is undocumented

`POST /jobs?type=RECONCILE_JOB` is in the reference with no description of
what it does. The bulk upload template's "Replace" option ("remove all
listings in your portfolio and replace them with the domains in your CSV
file") suggests it delists every name a file leaves out, which makes it the
most destructive call in the API. Please document it, including whether
blank cells in a reconcile file reset settings to defaults.

### 13. `offerCount` never appears

`includes=offerCount` returns nothing on any domain of the test account.
Probably omitted for names with no offers (this account has none), but the
docs don't say, and whether it counts open offers or all offers ever.

**Resolved by removal.** The changelog (2026-10-28) says `includes=offerCount`
is now a no-op on `GET /domains`, `GET /domains/{domain}` and
`POST /bulkDomains/getByNames`: the field is gone from responses, and the
value is due to be removed from `includes`. DomBot no longer asks for it.
The `GET /domains` reference example still shows `"offerCount": 10`.

### 14. Leases have no `saleTotal` or payout date

Leased sales carry installment fields but no `saleTotal` and no
`disbursedAt`, so there's no way to tell when a lease's payouts were made or
what was paid out in total.

### 15. Job results file has a byte-order mark mid-file

`GET /jobs/{jobId}/results` returns the header line, then a UTF-8 byte-order
mark at the start of the first **data** row (`﻿UPDATE_OR_ADD,…`), not at
the start of the file. Most CSV readers only strip a mark at the start, so
the first row's `operation` value comes through with an invisible prefix.

### 16. A job file's Domain cell changes the display name

Uploading `DOMAIN.com` in the Domain column of a bulk job (to update a
listing whose display name was lowercase) changed its display name to the
mixed case. That's consistent with the template ("Modify the case of the
characters in the domain name for display"), but it means a job meant only
to change a price can rename the lander. Worth a line in the jobs CSV guide.

### 17. Bulk per-name failures have no error body

`POST /domains/$each/delete` answers a name that isn't listed with
`{"<name>": {"code": 404}}` and no `error`, while other per-name failures
include one. A short error code and message would let integrations show why.

## Suggestions

- **Auth codes in sale records.** `GET /sales` returns `authCode` in plain
  text on completed sales indefinitely. Once a transfer has completed, the
  code no longer needs to be readable; masking it then would limit exposure
  if an API key leaks.
- **A buyer/seller field** on sales (see issue 1) would also make purchase
  history available to integrations, which is useful for cost basis.
