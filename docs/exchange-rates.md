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

Limited to the 30 (built):

- The currency dropdown: a plain list of code and name,
  no search or symbols, with USD, EUR, GBP, CNY, JPY first. Beside an amount
  it sits inside the field (`MoneyInput`'s `onCurrencyChange`), so amount and
  currency take one row in Purchase details, Mark as Sold, Pricing, the
  market listing editor and the import's typed names. A market narrows it
  (Sedo: EUR, USD, GBP; Afternic and Atom show none). Settings and the
  import's default use it on its own (`CurrencyPicker`). A record already in
  another currency shows it at the end of the list.
- Purchases, sales, asking prices and manual renewal prices, from the app,
  the API and MCP: the services check with `toEntryCurrency`
  (`src/shared/currencies.ts`), "DomBot can't convert TWD. Choose one of the
  30 currencies it converts, such as USD, EUR or GBP." MCP's currency
  parameters say so too.
- CSV import (`readRow` in `src/shared/domain-import.ts`): a row with an
  amount in another currency is an issue in the import report, with the same
  reason, and isn't imported. The import API's row schema refuses one too.
- Preferred currency (`src/core/services/settings.ts`): one saved outside the
  30 reads as USD.
- Dialog defaults: Mark as Sold starts in the purchase's currency only when
  it's one of the 30, and Just Registered doesn't fill a fee quoted outside
  them.

Not limited, because they aren't entered here:

- What sync brings in from registrars and markets.
- Backups (`parseBundle`): a restored file keeps its amounts as they were.

**Editing a record you already have:** a currency left as it was saves, even
outside the 30, so fixing a date or a note doesn't make you change the
currency. Choosing a new one must be one of the 30. "Left as it was" means
the record being edited: the purchase, sale, asking price or renewal price
the save replaces.

### Amounts already in other currencies

Few installs will have any, but DomBot tells you when it finds them:

- **A bell row**: "3 amounts in currencies DomBot can't convert", counted
  across purchases, sales, asking prices and manual renewal prices, one per
  name and kind (`src/shared/unconvertible.ts`). It opens to a list of each
  (name, what it is, the currency). A purchase or sale links to the name's
  Activity, whose menu edits it; an asking or renewal price to its Domains
  row. It counts once toward the badge, gray when it's all there is.
  Dismissing it remembers the count on that device and hides it until there
  are more.
- **A preferred currency outside the 30** reads as USD, with no note: it's a
  setting, not a record, and the Settings field shows USD.
- Those amounts are kept and shown in their own currency. Totals leave them
  out and say so (see [Converting](#converting)).

### Preferred currency

The setting's job grows from "the default for new amounts" to the currency
reports are shown in. Its description in Settings → General → Money is now
(built):

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
and left out of converted totals, like any other. `getRegistrationQuote`
(`src/core/services/registrars.ts`) used to turn a code it didn't know into
USD, labeling a foreign price as dollars; it now returns no price.

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

The 29 quoted against the euro (EUR is always 1), one array per month in
`currencies` order, six significant digits, `null` where a currency has no
rate. Built on 2026-10-29: 321 months, 2000-01 to 2026-09, 77 KB (35 KB
gzipped), one month per line so a rebuild's diff shows only the new ones.
The script fails if the currencies in the ECB's daily file no longer match
`RATE_CURRENCIES`, so a currency joining or leaving is a deliberate change.
Rerun it before a release; a stale archive only means a few more months
fetched at runtime.

The demo uses the archive alone and never fetches.

### Fetched at runtime (built)

`src/core/services/exchange-rates.ts`, on desktop and in the Worker. A host
turns it on (`enableRateFetch`), so the demo and tests never reach the
network.

Namespace **`exchange-rates`**, flagged `cache` (Clear cache wipes it; the
archive and the next fetch restore it, and as a cache it needs no
`BUNDLE_VERSION` bump). Keyed by period:

- `2026-09`: a month's average fetched after the archive was built.
- `2026-10-28`: one business day.

Each value is `{ rates: { USD: 1.15132, … } }`, EUR-based, EUR left out.

**Only when something needs converting** (`ratesNeeded`): an amount held in
one of the 30 other than your preferred currency (a purchase, sale, renewal
price, asking price, market sale or listing). Most portfolios are all USD
with USD preferred, and those never fetch: the archive is all they'd use,
and nothing of theirs uses it.

It checks at desktop launch and with every sync: the Sync button (beside the
sync, never holding it up), the desktop's background sync, and the Worker's
hourly cron. A check fetches only what's missing, so most fetch nothing:

1. **Months:** when the newest month held (archive or fetched) is older than
   last month, every month after it from the Data Portal. A month still
   running is never kept. About once a month.
2. **Days:** when the newest rate held (a day, or the last day a month's
   average covers) is a week old, the 90-day file, keeping the days of
   months with no average. About once a week. A week-old rate is as close
   as the month's average is to any day in it.
3. **Prune:** days of a month that now has an average, and a fetched month
   the archive now ships (after an update).

A fetch that brings nothing newer (an average not out yet, an error) waits a
day before the next try. Offline, DomBot converts with what it holds.
`getExchangeRates` hands the rows to the renderer, which reloads them at
launch and after each sync.

`src/core/services/exchange-rates.live.test.ts` (`npm run test:live`, no
credentials) checks both ECB formats still parse.

### Which rate

For an amount dated `D`, converting from `A` to `B`:

1. **Same currency:** no rate.
2. **D's month has an average:** use it.
3. **Days held in D's month:** D's own rate, else the nearest earlier
   business day held, else the nearest later one. Marked provisional.
4. **Nothing held for D's month** (past everything held after a while
   offline, or a month that never got fetched): the newest rate held before
   D. Marked provisional.
5. **Nothing:** before 2000, or ISK from 2009-01 to 2018-01. Not converted.

`A` and `B` come from the same row: `amount × rate[B] / rate[A]`, with
`rate[EUR] = 1`. A provisional amount settles by itself once its month's
average arrives.

**Forward-looking amounts** (next year's renewals, asking prices) use the
newest rate held.

## Converting

A pure module, `src/shared/exchange-rates.ts` (built): `new
ExchangeRates(rows)` loads the archive, takes the fetched rows, and answers
`convert(amount, from, to, date)` with the converted amount, the period it
used, and whether it's provisional, or null when it can't. The renderer gets
the fetched rows from the API (`getExchangeRates`); core (MCP) reads them from
storage (`exchangeRates()`). Both get the same answers.

- **Rounding:** each amount is converted, then rounded to the target
  currency's minor units; sums add integer minor units, as
  [#112](https://github.com/aoxborrow/dombot/issues/112) plans for money
  generally.
- **Nothing converted is stored.** Events keep their amount and currency, so
  changing your preferred currency changes every report at once, and a
  better rate source later needs no migration.
- **On screen:** totals are in your currency. A row shows its own amount;
  when that isn't your currency, its tooltip adds the conversion
  (`conversionText`): "€1,200 ≈ $1,301 at the March 2024 average (ECB)", or
  "… at the 28 Oct 2026 rate, until the October average is out (ECB)" when
  provisional.
- **Left out:** a total that skipped amounts says so beside it: "Leaves out 2
  renewals in KES", "leaves out 1 sale in TWD". This replaced the "plus €45"
  lists.

## Where it shows

- **Renewals** page and the Renewals tab metric (`src/renderer/lib/renewals.ts`,
  `tab-metrics.ts`), built: totals in your currency, every known renewal
  converted at the newest rate. The page's subtitle says how many were
  converted and from what ("12 converted from EUR", the rate on hover);
  `leftOut` only holds what can't be converted. Before, totals were in the
  currency most names renewed in.
- **Sales by year** (`market-reports.ts`, on the Markets page until the Sales
  tab replaces it), built: each completed sale converted at its month's
  average instead of counting USD only. A year is `provisional` while a
  recent sale uses a recent rate, and a sale DomBot can't convert is left out
  and counted. A year's sales keep their own currency, with the conversion
  on hover.
- **Sales tab** ([sales-tab.md](sales-tab.md)): totals, sales by month,
  breakdowns and the stat cards in your currency. This replaces that plan's
  "Currencies are never converted or summed together"; the currency filter
  stays, for seeing only EUR sales in EUR.
- **Domains summary cards** (Net, last 12 months).
- **Activity:** rows keep their own amounts, with the conversion in the
  tooltip.
- **MCP**, built: `market_report_get` is in your currency (`currency`, with
  `provisional` and `leftOut` per year), and `market_sales` adds `converted`
  beside its per-currency `totals`. Filters such as `priceCurrency` stay as
  they are for now.
- **CSV export:** unchanged. It's for round trips, so amounts stay as
  recorded.

## Order of work

1. **Currency limits.** Built: `RATE_CURRENCIES`, the dropdown, the app, API,
   MCP and CSV checks, the editing rule, the preferred currency fallback, the
   bell row, and the `getRegistrationQuote` fix.
2. **Rates.** Built: the build script and `data/exchange-rates.json`,
   `src/shared/exchange-rates.ts` with tests (each rule in
   [Which rate](#which-rate), the ISK gap, rounding), the `exchange-rates`
   namespace, the fetch on both hosts (only when something needs
   converting), and `getExchangeRates`.
3. **Conversion where totals are today.** Built: Renewals, the tab metric,
   sales by year on the Markets page, `market_report_get` and
   `market_sales`, and the Settings wording.
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
