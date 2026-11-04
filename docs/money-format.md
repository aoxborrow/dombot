# Money on screen — cents and whole amounts

Audit of 2026-11-03. Some renewal prices show with no decimals or one
("$45", "$11.4"). This plan covers every place DomBot shows money and says
which ones need cents. Decided in conversation the same day: a sale's price
stays whole, and totals on cards and charts stay whole with the exact amount
on hover.

## The rule

- **Amounts use their currency's decimals, always written out:** $45.00,
  $11.40, €9.00, ¥1,500 JPY, 1.250 KWD. That's what `formatMoney` in
  `src/shared/money.ts` already does with `whole` off.
- **Market listing prices are whole:** BIN, minimum offer and floor, and
  anything built only from them (the Pricing and Markets filters, Total BIN).
  Afternic rejects cents on a listing (`dollarsToMicro`), and DomBot's own
  asking price editor does too (docs/domain-import-export.md, "Whole amounts").
- **A sale's price is whole on the Sales tab,** like the listing price it
  usually was. Its fees, net, profit and cost show cents.
- **Totals are whole** on stat cards, charts and the tab pill (or compact,
  "$4.2k"), with the exact amount on hover.
- **Everything goes through `formatMoney`,** so every amount follows the
  Number format setting and gets a currency code when its symbol is shared
  (a CAD price reads "$12.99 CAD", not "$12.99").

## What the markets return

- **Afternic listing prices are whole.** The API counts in microunits, and
  the client refuses a listing price with cents (`microToDollars`).
- **Afternic sales carry cents.** `salePrice`, `commission`, `saleTotal` and
  `installmentAmount` are microunits too, and DomBot keeps them exact
  (`microToDecimal`). Buy Now sale prices are whole, since they're listing
  prices. The commission is a percentage, so it has cents whenever the price
  doesn't divide evenly: 30% of $299 is $89.70, leaving $209.30. Lease sales
  can have cents in the price itself, and their installments always can.
- **Atom's commission is DomBot's estimate** from its published rates
  (`estimatedCommission`), a percentage of the price, so it carries cents
  too (25% of $5,999 is $1,499.75).
- **Sedo** has no sales API. Its listing prices are decimals ("500.00"), but
  DomBot lists whole amounts there like everywhere else.

So on the Sales tab, the fees, net and profit columns hold cents, and so can
the price of a lease.

## Why "$11.4" happens

`priceMoney` in `src/renderer/lib/renewals.ts` formats with
`minimumFractionDigits: 0, maximumFractionDigits: 2`, which drops trailing
zeros: 45 → "$45", 11.4 → "$11.4". It's also hard-coded to `en-US`, so it
ignores the Number format setting, and it uses Intl's narrow symbol, so CAD,
AUD and NZD prices all read as a bare "$". `wholeMoney` and `compactMoney`,
next to it, have the same two problems.

Renewal prices are numbers (`RenewalPricing.renewal`), not canonical
strings, and they get added and multiplied (bulk renew is `renewal * years`),
so they can come out as floats: 0.7 + 0.1 is 0.7999999999999999.
`formatAmountInput` cuts extra digits off rather than rounding
(`src/shared/money.ts:150`), so passing it `String(n)` shows "$0.79". Round
to the currency's minor units first (`roundTo` in
`src/shared/exchange-rates.ts`).

## Every place money shows

### Needs cents

| Where                                                                  | Code                                                       | Today                        | Change                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- | ----------------------------- |
| Domains table, Renewal column                                          | `RenewalCell`, `src/renderer/pages/Domains.tsx:319`        | `priceMoney`: "$11.4", "$45" | currency decimals             |
| Renew dialog, estimate and per-year                                    | `src/renderer/components/domains/RenewDialog.tsx:136`      | `priceMoney`                 | currency decimals             |
| Bulk renew, total per currency                                         | `src/renderer/components/domains/BulkActionDialog.tsx:617` | `priceMoney` on a float sum  | round, then currency decimals |
| Sales table: Fees, Net, Profit, Cost (hover), converted amount (hover) | `money`, `src/renderer/pages/Sales.tsx:127`                | whole: $89.70 shows as "$90" | currency decimals             |
| Sales table: Price                                                     | same                                                       | whole                        | stays whole                   |

### Totals, whole today

These are sums on stat cards, charts and the tab pill. They're whole, or
compact ("$4.2k"), to fit the cards (PR #222).

| Where                                                              | Code                                                   | Today                         |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------- |
| Renewals cards: Monthly avg, Yearly, Due 30 days, Due 90 days      | `usd`, `src/renderer/pages/Renewals.tsx:275`           | `wholeMoney`                  |
| Renewals by month: bar labels, hovers, "over 12 months"            | `MonthlyBarChart`, same file                           | `wholeMoney`                  |
| Spend by registrar / TLD donuts: center and legend                 | `DonutCard`, same file                                 | `wholeMoney`                  |
| Renewals tab pill and its hover                                    | `src/renderer/lib/tab-metrics.ts:68`                   | `compactMoney`, `wholeMoney`  |
| Domains card Auto-renew, "$1.2k/yr"                                | `src/renderer/components/domains/DomainsCards.tsx:404` | `compactMoney`                |
| Sales cards: Gross, Net, Profit, Fees, Pending value, Expected net | `src/renderer/components/sales/SalesCards.tsx`         | `money` from Sales.tsx, whole |
| Sales cards: "fees" and "avg" under Gross                          | `SalesCards.tsx:156`                                   | `compactMoney`                |

They stay whole, follow the Number format setting, and show the exact
amount on hover.

### Whole, and right to be

| Where                                             | Code                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Domains table, BIN price and Min offer            | `listPriceColumn`, `src/renderer/components/domains/purchase-columns.tsx:235`    |
| Market listing columns                            | `src/renderer/components/domains/market-columns.tsx:210`                         |
| Pricing and Markets filters                       | `src/renderer/pages/Domains.tsx:1727`, `:1758`                                   |
| Domains card Total BIN and its average            | `DomainsCards.tsx:445` (but via `wholeMoney`, so it needs the Number format fix) |
| Market listing dialog: "Your BIN price in DomBot" | `src/renderer/components/domains/MarketListingDialog.tsx:336`                    |
| Import review, asking price fields                | `ImportDomainsDialog.tsx:694` (per field: `whole` only for listing prices)       |

### Already right

| Where                                                     | Code                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Domains table, Purchase price and Sold for                | `purchase-columns.tsx:151`, `:297`                                 |
| Activity details and the conversion hover                 | `src/renderer/lib/activity.ts:118`, `:138`                         |
| Purchase, Sale, Bulk purchase and Ownership dialog inputs | `formatAmountInput` with the currency's decimals                   |
| Registration fee lookup                                   | `src/core/services/registrars.ts:421`                              |
| Domains CSV, renewal price                                | `src/shared/domain-csv.ts:94`                                      |
| MCP tools                                                 | JSON numbers and canonical strings; market totals use `toFixed(2)` |

### Small, not on screen

- **The Sales CSV passes market amounts through as synced:** "89.7",
  "299". `toRecord` (`src/shared/sales.ts:238`) copies `sale.price` and
  `sale.commission` as they are, and only the net it works out itself gets
  the currency's places. Normalizing price, fees and net there (as `decimal`
  already does) gives "89.70" and "299.00" to the page and the CSV. MCP's
  `market_sales` returns the synced market sales themselves, so it
  keeps "89.7"; that's a decimal string, not something shown.
- **The listing dialog's lease estimate rounds up to whole dollars:**
  `monthlyPayment` is `Math.ceil(price / months)`
  (`src/renderer/lib/lease-to-own.ts:35`), so $2,500 over 30 months shows
  "$84/mo" where Afternic charges $83.33. It's an estimate beside a whole
  listing price, so it can stay. Showing cents would match Afternic.

## Decisions

- **A sale's price stays whole.** Buy Now prices are whole anyway. A lease's
  price can have cents, which the Price column rounds off, so price, fees and
  net may not add up to the cent on a lease.
- **Totals stay whole or compact,** as now, with the exact amount in a hover.
  They're summaries, and the cards size their numbers to fit.
- **The manual price editor on Renewals is deleted.** It was hidden behind
  `MANUAL_PRICING_ENABLED`, a table of names with a bare number box each:
  "45" for €45.00, no currency, not in your Number format. Setting your own
  renewal price belongs in the domain detail pane, later; the store's
  `setManualPrice` and its IPC stay for it, and imports still set prices.

## The fix

1. **One number formatter.** `formatMoneyNumber` in `src/shared/money.ts`
   takes a number, rounds it to the currency's places (or whole), and hands
   `formatMoney` the canonical string (`n.toFixed(places)`). A loss gets a
   minus sign.
2. **Renewal prices.** Replace `priceMoney` with that helper in the Renewal
   column, the Renew dialog and bulk renew. They get the preferred currency
   and Number format from settings like the Purchase price column does.
   Delete `priceMoney`.
3. **Totals.** `wholeMoney` goes (callers use `formatMoneyNumber` with
   `whole`), and `compactMoney` is built on `formatMoney` (it keeps its "k").
   Both take the preferred currency and Number format. `StatCard` takes a
   `title`, the exact amount; so do the month bars, the donut legends and the
   tab pill.
4. **Sales tab.** `money` in `Sales.tsx` keeps `whole` for Price only. The
   cards stay whole, with the exact amount on hover.
5. **Sale records.** Normalize price, fees and net in `toRecord` to the
   currency's places, for the CSV.
6. **Tests.** Nothing tested `priceMoney`, `wholeMoney` or `compactMoney`.
   `src/shared/money.test.ts` covers `formatMoneyNumber` (45 → "$45.00",
   11.4 → "$11.40", a float sum, CAD, JPY, KWD, 1.234,56, whole, a loss),
   and `src/renderer/lib/renewals.test.ts` covers `compactMoney`.
7. **Check it in the demo** (Domains Renewal column, Renew dialog, Renewals
   cards, Sales tab) with the US and a comma-decimal Number format.
