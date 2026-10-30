# Sales tab

Built 2026-10-29 in five stacked PRs (Domains columns and cards, sale
records, the Sales view, the overview, demo and docs); docs/markets.md,
"Sales tab", describes what shipped. Open questions 1–3 were settled as:
the tab shows with an empty state; sell-through keeps names listed as its
denominator; the Domains cards hide on phones.

Plan (2026-10-29) to replace the Markets tab with a **Sales** tab, move
per-name interest into the Domains table, and give Domains a few summary
cards. Builds on the market work in PR #207 (docs/markets.md) and takes the
useful parts of the contributed Sales dashboard in PR #183.

## Why

The Markets page (`src/renderer/pages/Markets.tsx`) is mostly traffic: four
stat cards, views by month, a top-names table, and sales by year, with a
market filter. Of that:

- **Per-name interest** (the "Names with the most interest" table) belongs in
  Domains, where the names already are, as sortable columns.
- **Sales** are what people come back for, and they aren't only market
  sales: Sold events you record yourself, imported sales, and private deals
  are sales too. The page only knows market sync's.
- **Listings** are already managed in Domains: a column per market, the
  listing editor, the Markets filter. The Markets page adds nothing there.
- **What needs action** (a sale waiting on an auth code, a rejected listing,
  a price below yours) has no home; sales needing an auth code sit in the
  bell, which is a cramped place to act.

## What changes

### 1. Domains: interest columns and summary cards

- **Views, Leads, Searches over 12 months**, sortable, replacing the 30-day
  columns (`views30`, `leads30`, `searches30` in
  `src/renderer/components/domains/market-columns.tsx`). Hidden by default,
  shown from the Columns picker; they exist only once a market account is
  connected, like today. Totals come from `getMarketTraffic().domains`
  (`views365`, `leads365`) and the listings' search counts
  (`searchesOf(l).total.days365`). Searches carry the Domain Pro tooltip the
  Markets page has now. Sorting by Leads, then Views, replaces "Names with
  the most interest".
- **Summary cards** above the table, small, one row, Owned view only, only
  when a market account is connected (or any sale exists):
  - **Listed:** names listed on any market, "on N markets".
  - **Sold, last 12 months:** count, with sell-through as the hint.
  - **Net, last 12 months:** what you were paid, "N sales · $gross gross".
  - **Views, last 30 days:** with leads as the hint.
    Each card can link somewhere useful: Listed sets the Markets filter, Sold
    and Net open the Sales tab. They reuse `StatCard`
    (`src/renderer/components/StatCard.tsx`), smaller.

### 2. A Sales tab in place of Markets

Route `/sales` in the nav where Markets is now; `/markets` redirects to it.
Two views, switched like Domains' Active / Archive:

**Overview**

- **Needs attention**, like Activity's review list, one row per item, its
  action inline, and empty when there's nothing:
  - Sales waiting on you: needs the auth code (Send auth code, with the
    paste-it-yourself fallback), payee details, transfer. Today's bell
    `SaleRow` moves here.
  - Rejected or stuck listings (Relist, or open the listing editor).
  - Market prices below your DomBot price (open the editor, or push your
    price).
  - Grouped rows for the many-name cases, linking into Domains with the
    Markets filter set: "N priced names not listed on any market", "N below
    your price on Afternic".
- **Stat cards** (moved from Markets, reworded for all sales): Sold this
  year, Gross, Net, Average sale, Sell-through. Traffic shrinks to at most
  one card.
- **Sales by month** for the last 12 months (from #183's monthly trend),
  replacing views by month.

**Sales**

- **One row per sale**, newest first: name, sold on, where (the market, or
  Private / Imported for sales you recorded), price, commission or fees,
  net, status (completed, in progress with its step, cancelled), paid out
  on. In-progress sales pin to the top with their actions.
- **Filters:** date range (sale date), market / source, currency. Currencies
  are never converted or summed together; totals show per currency.
- **Totals and year grouping:** the yearly totals Markets shows today
  (sold, gross, commission, net, average), as a summary above the table or a
  grouping in it.
- **Breakdowns** by market, TLD and registrar (from #183), as small tables
  or a toggle.
- **CSV export** of the filtered records.
- **A row's menu:** open the name's history, edit the sale (the existing
  sale dialog), open it on the market.

Because rows are sales rather than names, a name that has left your
accounts still has its rows; a name bought back and sold again has two.

### 3. The bell

The bell keeps its "sale needs the auth code" item but only alerts: it links
to the Sales overview, which has the action. Activity keeps the ownership
history (Sold events) as now.

### 4. What goes from Markets

- Views by month: dropped (a traffic card on Overview at most).
- Names with the most interest: replaced by the Domains columns.
- Sales by year: moves to the Sales view.
- The four stat cards: Listed and Views go to Domains' cards; Sold and Net
  go to Sales (Domains shows them small too).
- The market filter on the page: replaced by the Sales view's market /
  source filter.

## The sale record

The Sales view needs one list of sales from every source. Build it in a pure
function (`src/shared/sales.ts`, say) over what's stored, so the page, the
CSV and MCP agree:

- **Sold events** in the domain-event log (`type: 'sold'`), whatever their
  source: you, import, or market sync. Each has the date, amount, currency,
  and for market sales `marketSale`, the `market-sales` key.
- **Market sales** (`market-sales`), for commission, net, payout date,
  status and the seller's next step, joined through `marketSale`. Market
  sales still in progress have no Sold event yet (sale-events.ts writes one
  only when completed), so they come straight from `market-sales`.
- **Purchases** (`domain-purchases`, and `purchased` / `registered` events)
  for the cost basis and holding period of each sale: the acquisition before
  that sale, so a buyback starts a new holding.

`isShownSale` (`src/core/services/markets/sync.ts`) still leaves Afternic's
purchases out.

Fees and net for private sales: add optional `fees` (and so net) to the
existing sale record, set from the sale dialog, rather than a second store.
Blank means unknown.

## From PR #183

PR #183 (by julianengel) adds a Sales dashboard. It predates the market
work: its backup format v9 collides with the market namespaces' v9, and it
doesn't know about market sales. Port the pieces rather than rebase it, and
credit the author on the commits that do (`Co-Authored-By`).

**Take:**

- Sale records built from the full event history, keeping repeated sales
  after a buyback separate.
- Date filters on the sale date; all-time includes undated sales, a bounded
  range leaves them out and says how many.
- Currency handling: never convert, never combine; totals per currency.
- The monthly sale-value trend; breakdowns by market, TLD, registrar.
- CSV export of the filtered records, with the shared CSV formula guard.
- Holding period and realized ROI where purchase data exists.
- The rules: blank is unknown, zero only when confirmed, estimated renewal
  prices are never used as historical costs, coverage counts beside partial
  totals.
- Its tests for the calculations (`src/renderer/lib/sales-analytics.test.ts`),
  adapted.

**Leave or rework:**

- The `sale-details` namespace and the financial-review dialog (marketplace,
  payment status, cumulative receipts, fees, reviewed renewal costs). Market
  sales already carry commission, net and payout; for private sales, fees go
  on the sale record. Revisit receipts and installment tracking if
  payment-plan sales need them.
- Opening-portfolio sell-through. Keep one sell-through definition: the
  existing `sellThrough` (`src/shared/market-reports.ts`), extended to all
  sales.
- The backup format bump that came with `sale-details`.
- Its `CHANGELOG.md` (the repo keeps none).

Close #183 once the Sales tab lands, pointing at what was taken.

## MCP

`market_report_get` and `market_traffic` stay. A `sales_report_get` (or a
`sales` tool) over the same sale records can follow, so agents see private
sales too.

## Demo

The demo (`src/core/demo/markets.ts`, `src/renderer/api/demo.ts`) needs:

- a sale at each step: needs the auth code (on a name at a registrar that
  can produce one: GoDaddy or Porkbun), payee details, transfer, completed,
  cancelled;
- a few private and imported sales beside the market ones, some with fees;
- purchases on most sold names, so holding period and ROI show.

## Phases

Each can be its own PR, in this order:

1. **Domains:** the 12-month Views / Leads / Searches columns and the summary
   cards.
2. **Sale records:** the shared builder and its tests, fees on the sale
   record, the sale dialog field.
3. **Sales tab:** the route and nav, the Sales view (table, filters, totals,
   breakdowns, CSV), the redirect from `/markets`.
4. **Overview:** Needs attention, the cards, sales by month; the bell links
   to it; the Markets page goes.
5. **Demo and docs:** the demo's sales at every step; docs/markets.md,
   README; close #183.

## Open questions

1. Does the Sales tab show in a portfolio with no market account and no
   sales? Probably yes, with an empty state pointing at recording a sale or
   connecting a market.
2. Sell-through's denominator once sales include private ones: names listed
   (today) or names priced in DomBot?
3. Should Domains' summary cards be optional (a preference), or hide on
   narrow screens?
