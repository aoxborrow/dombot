# Exchange rates

Plan (2026-10-29) to show totals and reports in your preferred currency,
converting amounts recorded in other currencies with the European Central
Bank's reference rates. It limits the currencies you can enter to the 30 the
ECB publishes, and ships a monthly rate archive back to 2000 with the app.

The financial dashboard ([#112](https://github.com/aoxborrow/dombot/issues/112))
lists exchange rates as a dependency with no issue yet; this is that piece.

## Why

- **Totals stop at the first currency.** Renewals sums one currency
  (`mainCurrency` in `src/renderer/lib/renewals.ts`) and lists the others
  beside it; sales by year (`src/shared/market-reports.ts`) counts one
  currency and drops the rest. A Sedo sale in EUR never reaches a USD total.
- **Profit needs one currency.** A name bought in EUR, renewed in USD and sold
  in GBP has no profit until the three are in the same unit.
- **Any of 161 currencies can be entered** (`src/shared/currencies.ts`), and
  no free rate source covers them all with history. Most have no domain
  trade at all.

## Currencies

### The 30

EUR plus the 29 the ECB quotes against it:

AUD, BRL, CAD, CHF, CNY, CZK, DKK, EUR, GBP, HKD, HUF, IDR, ILS, INR, ISK,
JPY, KRW, MXN, MYR, NOK, NZD, PHP, PLN, RON, SEK, SGD, THB, TRY, USD, ZAR.

Every market and registrar DomBot supports fits inside them (see
[What comes in from accounts](#what-comes-in-from-accounts)).

### Kept vs entered

Two lists in `src/shared/currencies.ts`:

- **`CURRENCIES`** (unchanged): every code that's valid on a stored record.
  Reading still accepts all of them. Events with a code outside it are
  dropped on read today (`domain-events.ts`), so shrinking this list would
  silently delete data; it stays as is, like the withdrawn currencies do.
- **`RATE_CURRENCIES`** (new): the 30. Everything you enter is checked
  against it.

Limited to the 30:

- The currency dropdown (done in this PR): a plain list of code and name,
  no search or symbols, with USD, EUR, GBP, CNY, JPY first. Beside an amount
  it sits inside the field (`MoneyInput`'s `onCurrencyChange`), so amount and
  currency take one row in Purchase details, Mark as Sold, Pricing, the
  market listing editor and the import's typed names. A market narrows it
  (Sedo: EUR, USD, GBP; Afternic and Atom show none). Settings and the
  import's default use it on its own (`CurrencyPicker`). A record already in
  another currency shows it at the end of the list.
- The API and MCP inputs (`src/core/api/schemas.ts`): purchases, sales,
  asking prices, and the manual renewal price, which is free text today
  (`renewalPriceInput`).
- CSV import (`readCurrency` in `src/shared/import-values.ts`): a row in
  another currency is an issue in the import report, "TWD isn't one of the
  currencies DomBot converts", and isn't imported. A bare `$` still reads as
  your preferred currency when it's a dollar.
- Preferred currency (`src/core/services/settings.ts`).

Not limited, because they aren't entered here:

- What sync brings in from registrars and markets.
- Backups (`parseBundle`): a restored file keeps its amounts as they were.

**Editing a record you already have:** a currency left as it was saves, even
outside the 30, so fixing a date or a note doesn't make you change the
currency. Choosing a new one must be one of the 30.

### Amounts already in other currencies

Few installs will have any, but DomBot tells you when it finds them:

- **A bell item (Info)**: "5 amounts are in currencies DomBot can't
  convert", counted across purchases, sales, renewal prices and asking
  prices. It opens a list of each one (name, what it is, the amount) with a
  link to edit it. Dismissing it hides it until the count goes up.
- **A preferred currency outside the 30** reads as USD, as an invalid one does
  today, and the same bell item names it: "Your preferred currency was TWD,
  which DomBot can't convert to. It's now USD."
- Those amounts are kept and shown in their own currency. Totals leave them
  out and say so (see [Converting](#converting)).

### Preferred currency

The setting's job grows from "the default for new amounts" to the currency
reports are shown in. Its description in Settings → General → Money becomes:

> Totals and reports are shown in this currency, and new amounts start in it.
> Saved amounts keep their own currency.

## What comes in from accounts

From registrar-client 0.10.0 (`src/registrars/*.ts`):

| Registrar                                        | Currency                                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Name.com, NameSilo, Porkbun, NameBright          | Always USD (fixed in the adapter; NameBright sends no code) |
| Cloudflare, GoDaddy, Namecheap, Gandi, 101domain | The code the API returns, USD when it's missing             |
| Dynadot                                          | The code in its price response or renew price check text    |
| Spaceship                                        | Only premium prices carry a code; no TLD pricing            |

The ones that read the code from the API are the ones that could send
something other than USD: Gandi, likely EUR for a European account, and
Dynadot and GoDaddy, which may follow the account's currency. That's
unverified; every account tested so far has returned USD. A registrar added
later could bill in anything, which the next point covers.

Markets: Afternic and Atom are USD only, Sedo EUR, USD or GBP
(`SEDO_CURRENCIES`).

**A code outside the 30 from sync** is kept and shown in its own currency,
and left out of converted totals, like any other. One fix on the way:
`getRegistrationQuote` (`src/core/services/registrars.ts`) turns a code it
doesn't know into USD, which would label a foreign price as dollars. It should
return no price instead.

## Rates

### Source

The ECB's euro reference rates: free, no key, published every business day
around 16:00 CET, history since 1999. They're the rates most free services
(Frankfurter and others) pass along, so DomBot reads them from the ECB.

- **Monthly averages:** the ECB Data Portal,
  `https://data-api.ecb.europa.eu/service/data/EXR/M.<codes>.EUR.SP00.A?startPeriod=2000-01&format=csvdata`,
  with `<codes>` joined by `+`. `M` is monthly, `A` the average. All 30 since
  2000 is one request.
- **Days:** `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml`,
  every currency for the last 90 days (about 70 KB, 64 business days on
  2026-10-29).

Checked on 2026-10-29: the monthly series run unbroken from 2000-01 to
2026-09 for every currency but ISK, which has no rate from 2009-01 to
2018-01 (the ECB suspended it after Iceland's banking crisis). The October
average isn't out until October ends, which is why days are needed.

### The archive that ships

`data/exchange-rates.json`, built by `npm run rates:build`
(`scripts/build-exchange-rates.mjs`, like `pricing:build`):

```json
{
  "base": "EUR",
  "currencies": ["AUD", "BRL", "CAD", "…"],
  "months": { "2000-01": [1.54214, 1.7987, 1.46865, "…"] }
}
```

One array per month in `currencies` order, six significant digits, `null`
where a currency has no rate. All 321 months come to about 77 KB (35 KB
gzipped). The script fails if the ECB's currency set no longer matches
`RATE_CURRENCIES`, so a currency joining or leaving the euro is a deliberate
change. Rerun it before a release; a stale archive only means a little more
fetching at runtime.

The demo uses the archive alone and never fetches.

### Fetched at runtime

New namespace **`exchange-rates`**, flagged `cache` (Clear cache wipes it;
the archive and the next fetch restore it, and as a cache it needs no
`BUNDLE_VERSION` bump). Keyed by period:

- `2026-09`: a month's average fetched after the archive was built.
- `2026-10-28`: one business day.

Each value is `{ rates: { USD: 1.15132, … } }`, EUR-based.

Fetched when DomBot syncs, on desktop and in the Worker, at most once a day,
never blocking a view:

1. **Months:** when the newest month held (archive or fetched) is older than
   last month, fetch from the month after it.
2. **Days:** fetch the 90-day file. It covers this month and last month until
   that month's average is out, however long that takes.
3. **Prune:** drop day rows for any month that now has an average.

Offline, DomBot converts with what it holds.

### Which rate

For an amount dated `D`, converting from `A` to `B`:

1. **Same currency:** no rate.
2. **D's month has an average:** use it.
3. **Days held in D's month:** D's own rate, else the nearest earlier
   business day held, else the nearest later one. Marked provisional.
4. **D is past everything held** (offline for a while): the newest rate held.
   Marked provisional.
5. **Nothing:** before 2000, or ISK from 2009 to 2017. Not converted.

`A` and `B` come from the same row: `amount × rate[B] / rate[A]`, with
`rate[EUR] = 1`. A provisional amount settles by itself once its month's
average arrives.

**Forward-looking amounts** (next year's renewals, asking prices) use the
newest rate held.

## Converting

A pure module, `src/shared/exchange-rates.ts`: it loads the archive, takes the
fetched rows, and answers `convert(amount, from, to, date)` with the converted
amount, the period it used, and whether it's provisional. The renderer gets
the fetched rows from the API; core (MCP) reads them from storage. Both get the
same answers.

- **Rounding:** each amount is converted, then rounded to the target
  currency's minor units; sums add integer minor units, as
  [#112](https://github.com/aoxborrow/dombot/issues/112) plans for money
  generally.
- **Nothing converted is stored.** Events keep their amount and currency, so
  changing your preferred currency changes every report at once, and a
  better rate source later needs no migration.
- **On screen:** totals are in your currency. A row shows its own amount;
  when that isn't your currency, its tooltip adds the conversion: "€1,200 ≈
  $1,301 at the March 2024 average (ECB)", or "at the 28 Oct rate, until the
  October average is out" when provisional.
- **Left out:** a total that skipped amounts says so beside it: "Leaves out 2
  amounts in KES". This replaces today's "plus €45" lists, which become rare.

## Where it shows

- **Renewals** page and the Renewals tab metric (`src/renderer/lib/renewals.ts`,
  `tab-metrics.ts`): every known renewal converted at the newest rate; the
  other-currencies lists only hold what can't be converted.
- **Sales tab** ([sales-tab.md](sales-tab.md)): totals, sales by month,
  breakdowns and the stat cards in your currency. This replaces that plan's
  "Currencies are never converted or summed together"; the currency filter
  stays, for seeing only EUR sales in EUR. Sales by year
  (`market-reports.ts`) converts instead of filtering to one currency.
- **Domains summary cards** (Net, last 12 months).
- **Activity:** rows keep their own amounts, with the conversion in the
  tooltip.
- **MCP:** summaries and totals add a converted figure beside the original
  (amount, currency, period, provisional). Filters such as `priceCurrency`
  stay as they are for now.
- **CSV export:** unchanged. It's for round trips, so amounts stay as
  recorded.

## Order of work

1. **Currency limits.** `RATE_CURRENCIES` and the dropdown are done. Left:
   the API, MCP and CSV checks, the editing rule, the preferred currency
   fallback, the bell item, and the `getRegistrationQuote` fix. Useful alone:
   it stops new unconvertible amounts. The Settings wording waits for step 3,
   when reports actually convert.
2. **Rates.** The build script and `data/exchange-rates.json`,
   `src/shared/exchange-rates.ts` with tests (each rule in
   [Which rate](#which-rate), the ISK gap, rounding), the `exchange-rates`
   namespace and the fetch on both hosts.
3. **Conversion where totals are today:** Renewals, the tab metric, sales by
   year, MCP.
4. **Sales tab and Domains cards** as they're built
   ([sales-tab.md](sales-tab.md)), then the financial dashboard
   ([#112](https://github.com/aoxborrow/dombot/issues/112)).

## Decided

- **The ECB, read directly.** It's the source the free services repackage,
  and it has monthly averages built in. Frankfurter (the same rates with a
  nicer API) has no monthly averages; exchangerate.host now needs a key;
  open.er-api.com has no history.
- **Monthly averages for past months, days only for the current one.** A
  month's average is within a percent or two of any day in it, about what a
  card's exchange fee costs, and the whole history fits in the app.
- **30 currencies, for entry and for reports.** Every account DomBot
  connects to stays inside them.

## Later

- **What you actually paid or received,** per purchase or sale, when it
  differs from the ECB rate (a card's exchange fee, a payout in another
  currency). It would win over the rate.
- **More currencies,** if someone needs one: `fawazahmed0/currency-api`
  covers 200+ (crypto included) but only from 2024, or a keyed provider.
- **Converted columns in the CSV export,** for taxes.
