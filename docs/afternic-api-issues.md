# Afternic Portfolio API: issues found

Problems found while building DomBot's Afternic integration against the
Aftermarket Portfolio API (<https://api.afternic.com/docs/portfolio-api/>),
written to report to Afternic. Everything here was checked against a live
seller account between 2026-10-27 and 2026-10-28, and retested on
2026-10-29; the integration plan with the full context is
[afternic-api.md](afternic-api.md).

Each issue says what was called, what the docs say, and what happened.
Request ids are the `X-Request-Id` we sent, for Afternic's logs. Transaction
ids, domain names and amounts from the account are left out of this public
file and can be shared privately.

Status: **open** until Afternic answers; update each entry as it's resolved.

Everything was retested on 2026-10-29, live and against the
[changelog](https://api.afternic.com/docs/portfolio-api/changelog/) (entries
2026-10-25 to 2026-10-28), and each entry says what was found. #1 is the one
bug. #17 is resolved, and #4 is fixed in one of the two places it was wrong.
#10 and #11 were first filed as bugs: #10 turned out to be a rule Afternic
states in its dashboard but not in the API docs, and #11's bug is fixed,
leaving behavior worth documenting. #12 wasn't rerun, since a reconcile could
delist real names. #9 is new.

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

**Retested 2026-10-29:** unchanged. The list has 41 records, `GET /sales/{id}`
finds 39, and the same two purchases answer 404
(`a388f777-a6c2-43ee-ae8f-f0fe42069bc2`,
`cfe818b5-c66e-4451-8a70-7f9fa4f09002`). Still no field naming the side.

## Docs that don't match the API

### 2. Stats `startDate` is the end of the window, not the start

The Common Workflows guide says `startDate=2026-09-01T00:00:00Z&days=30`
"cover[s] 30 days starting September 1". The API counts `days` **backwards**
from `startDate`: with `days=365` and no `startDate`, the window ends today
(the first day returned is 364 days ago). The reference's description
("A default time of current timestamp is used") fits that reading; the
guide's example doesn't. Affects `GET /stats` and `GET /stats/{domain}`.

**Retested 2026-10-29:** unchanged. `startDate=2026-09-01T00:00:00Z&days=30`
returned 2026-08-03 through 2026-09-01, and the guide still says the window
starts on September 1.

### 3. Sales `limit` is capped at 100, documented as 1000

The reference for `GET /sales` gives `limit` a range of 1–1000. Any value
over 100 is rejected: 400 `BAD_REQUEST`, field `limit`, "limit must be at
most 100". Request id: `ba197620-5e28-4ac9-bfdf-b2f5f967b6e2`.

**Retested 2026-10-29:** unchanged. `limit=101` gets the same 400
(`7eab0825-7f12-4cf4-9a0a-e852ea213811`), and the reference still says 1–1000.

### 4. Stats `days` maximum: 365 or 366

The Common Workflows guide says `days` can be 1 through 366; the reference
says at most 365. 365 is what the API takes.

**Partly fixed.** The changelog (2026-10-25) corrects the documented maximum
to 365, but the Common Workflows guide still said "1 through 366" on
2026-10-29. The API refuses 366 with a 400, `days must be at most 365`
(`5ad1ce60-991b-4e22-ab9d-0ec263a93256`).

### 5. `PATCH ?resource=true` returns no resource

The reference says `resource=true` makes `PATCH /domains/{domain}` return
the updated domain. It returns 204 with no body either way, so a client has
to read the domain back.

**Retested 2026-10-29:** unchanged: 204 with an empty body
(`1e64d56a-9229-4502-9523-dd2324196ff5`).

### 6. `tld` isn't returned on domains

The example response in the guides includes `"tld": "com"`; no domain
response (list, get, get many) has included it. The reference examples for
`GET /domains` and `PATCH /domains/{domain}` pair `"name": "example.com"`
with `"tld": "co.uk"`.

**Retested 2026-10-29:** unchanged. No `tld` from list, get or get many.

### 7. Per-domain leads aren't on domains

`GET /domains` takes `order=LEADS_DESC` and `INTAKE_VIEWS_DESC`, and the
reference's example response includes `intakeLeads`, but no field with leads
or views comes back on a domain with any `includes`. The only per-domain
leads are from `GET /stats/{domain}`, one call per name, which for a large
portfolio is hours of the 150-a-minute rate limit.

Request: return the counts the sort already uses (leads and views over a
fixed window) as an `includes` option.

**Retested 2026-10-29:** unchanged. No leads or views field on any listing,
with every `includes`.

### 8. `registrar` is free text, not an enum

The reference's examples show `"registrar": "GODADDY"`. Real values include
`"GoDaddy.com, LLC"`, `"GODADDY"`, `"Dynadot Inc"` and `"Dynadot, LLC"` (the
same registrar two ways), `"UNKNOWN"`, `"Unknown .DE registrar"`, and the
field is sometimes missing. A stable identifier (IANA registrar id, or a
fixed enum) beside the display name would let integrations match it.

**Retested 2026-10-29:** unchanged. Values now also include
`"NameCheap, Inc."`, `"Spaceship, Inc."`, `"Sav.com, LLC"` and
`"101domain GRS Limited"`, and 3 listings have none.

### 9. The sales list leaves out `authCode` and `saleTotal`

Found 2026-10-29: none of the 41 records from `GET /sales` has `authCode` or
`saleTotal`, while `GET /sales/{transactionId}` still returns both (an auth
code on each of 38 completed sales, and `saleTotal` on Buy Now sales). The
list sent `authCode` on 2026-10-28 (see Suggestions). The changelog doesn't
mention it, and the reference example for `GET /sales` still shows both.
Leaving the auth code out of the list helps, but if it's deliberate it should
be documented. Without `saleTotal` in the list, a client needs one call per
sale to get the totals.

## Missing or unclear

### 10. Max lease period is lowered to fit the price, without a word

Setting `maxLeasePeriod` on a listing priced at $2,500: 24 saves, but 31, 36
and 60 return 204 and save 30 (`8d50f40c-58f7-4a49-9718-03c3f3fb286f`,
`4a73f896-2c07-4410-abd3-3db4ae30cdf3`,
`0e66f94b-b96a-4e71-9660-f7ccd77c8b7a`, on 2026-10-29). On 2026-10-28 they
were ignored and left the old value, through both `PATCH /domains/{domain}`
and a bulk job (`NO_CHANGE`). A listing created with `POST /domains` and no
`maxLeasePeriod` gets the account default of 60 at $25,000, but 30 at $2,500.

That's Afternic's rule rather than a bug. The Lease to Own settings in the
Afternic dashboard say a domain priced too low for the default maximum lease
period is set "as close as possible", and that Lease to Own needs a Buy Now
price between $495 and $5,000,000. The numbers fit a minimum monthly payment
of about $83 ($2,500 over 30 months is $83.33). The API docs mention neither
rule, and the API doesn't say when it lowered a value, so an integration
can't tell a user why 36 became 30.

Request: document the rule and the price range in the API docs, and either
answer with a 422 naming the maximum for the price, as the price-order checks
do (`floorPrice cannot be less than minbidPrice`), or return the saved value
(see issue 5).

### 11. A domain listed twice in one job file

A `BULK_JOB` file with three rows (a valid price change for one domain, an
invalid domain name, and the first domain again with an invalid price)
finished `COMPLETED` with `totalRequests: 3`.

- On 2026-10-28 the results file had **one** row (`totalFailures: 1`), the
  first domain's failure. The invalid domain's row, which fails on its own
  when uploaded alone, was missing from the results. That was a bug.
- On 2026-10-29, with a $5 minimum offer as the invalid price, every row got
  a result (`totalFailures: 3`), so that's fixed. Both rows for the repeated
  domain report the second row's error (`minbidPrice cannot be less than the
minimum of 20`), and the first row's valid change isn't applied: Afternic
  merges a domain's rows into one update.

A file is the caller's to get right, but the jobs CSV guide could say that a
repeated domain's rows are merged, or the upload could refuse a file that
repeats one.

### 12. `RECONCILE_JOB` is undocumented

`POST /jobs?type=RECONCILE_JOB` is in the reference with no description of
what it does. The bulk upload template's "Replace" option ("remove all
listings in your portfolio and replace them with the domains in your CSV
file") suggests it delists every name a file leaves out, which makes it the
most destructive call in the API. Please document it, including whether
blank cells in a reconcile file reset settings to defaults.

**Not retested:** on this account a reconcile could delist real names. The
docs still list the type without saying what it does.

### 13. Leases have no `saleTotal` or payout date

Leased sales carry installment fields but no `saleTotal` and no
`disbursedAt`, so there's no way to tell when a lease's payouts were made or
what was paid out in total.

**Retested 2026-10-29:** unchanged. Neither lease has `saleTotal` or
`disbursedAt`, from the list or from `GET /sales/{id}`.

### 14. Job results file has a byte-order mark mid-file

`GET /jobs/{jobId}/results` returns the header line, then a UTF-8 byte-order
mark at the start of the first **data** row (`﻿UPDATE_OR_ADD,…`), not at
the start of the file. Most CSV readers only strip a mark at the start, so
the first row's `operation` value comes through with an invisible prefix.

**Retested 2026-10-29:** unchanged. The mark is at byte 37, just after the
header's newline.

### 15. A job file's Domain cell changes the display name

Uploading `DOMAIN.com` in the Domain column of a bulk job (to update a
listing whose display name was lowercase) changed its display name to the
mixed case. That's consistent with the template ("Modify the case of the
characters in the domain name for display"), but it means a job meant only
to change a price can rename the lander. Worth a line in the jobs CSV guide.

**Retested 2026-10-29:** unchanged. `DOMANIO.com` in a price-only row renamed
the display again.

### 16. Bulk per-name failures have no error body

`POST /domains/$each/delete` answers a name that isn't listed with
`{"<name>": {"code": 404}}` and no `error`, while other per-name failures
include one. A short error code and message would let integrations show why.

**Retested 2026-10-29:** unchanged:
`{"dombot-not-listed-0000.com": {"code": 404}}` inside a 200
(`f9284bdc-9d6f-4890-bcd7-247f5ed211e3`).

## Resolved

### 17. `offerCount` never appears

`includes=offerCount` returns nothing on any domain of the test account.
Probably omitted for names with no offers (this account has none), but the
docs don't say, and whether it counts open offers or all offers ever.

**Resolved by removal.** The changelog (2026-10-28) says `includes=offerCount`
is now a no-op on `GET /domains`, `GET /domains/{domain}` and
`POST /bulkDomains/getByNames`: the field is gone from responses, and the
value is due to be removed from `includes`. DomBot no longer asks for it.
The `GET /domains` reference example still shows `"offerCount": 10`.

Checked live on 2026-10-29: no listing has `offerCount`. An `includes` value
the API doesn't know gets a 400 (`'notARealInclude' is not a valid value for
includes`), so once `offerCount` leaves the list, a client that still sends it
will fail.

## Suggestions

- **Auth codes in sale records.** `GET /sales` returns `authCode` in plain
  text on completed sales indefinitely. Once a transfer has completed, the
  code no longer needs to be readable; masking it then would limit exposure
  if an API key leaks. Partly done: since 2026-10-29 the list leaves it out
  (issue 9), but `GET /sales/{id}` still returns it on every completed sale.
- **A buyer/seller field** on sales (see issue 1) would also make purchase
  history available to integrations, which is useful for cost basis.
