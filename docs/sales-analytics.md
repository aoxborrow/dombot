# Sales analytics

The Sales tab reads the full domain-event history, so repeated sales after a
buyback remain separate records. Date filters are inclusive and use sale dates.
All-time includes undated sales; a bounded date range excludes them and reports
how many were excluded. Currency filters never convert or combine currencies.

## Financial review

Use **Review financials** on a sale to record its marketplace, payment status,
confirmed gross receipts, commissions/fees paid, and total renewal costs for that
holding. These are cumulative totals, not a schedule of individual payments.
Record purchase prices and gross sale amounts through the existing purchase and
sale editors. A sale needs a currency before its financial details can be reviewed.

Blank means unknown. Enter zero only when the cost is confirmed to be zero.
Imports do not automatically confirm receipts or turn an installment contract
into a paid sale. The UI shows coverage counts beside partial totals. All amounts
in one financial review use the sale currency; acquisition costs in another
currency prevent a realized-profit calculation. Editing the sale currency makes
previous financial details inactive until they are reviewed in the new currency.

- **Gross sale value:** sum of recorded gross amounts, including contract totals.
- **Confirmed receipts:** gross cash receipts explicitly entered by the user.
- **Net receipts:** confirmed receipts less recorded fees. Both must be known.
- **Realized profit:** net receipts less acquisition cost and reviewed total
  renewal costs. Requires Fully paid, receipts equal to the recorded gross sale
  amount, and all costs known in the same currency. Partial installment receipts
  are excluded from realized profit. Estimated future renewal prices are never
  used as historical expenses.
- **Average sale price:** gross sale value divided by sales with known amounts.
- **Realized ROI:** summed profit divided by summed acquisition and renewal costs
  for the same complete sales. A zero cost basis has no defined ROI.
- **Holding period:** elapsed calendar days from the acquisition for that holding
  to the sale. Missing dates remain unknown. A later buyback starts a new holding.
- **Opening-portfolio sell-through:** unique domains from the known opening
  portfolio sold during the selected period divided by that opening portfolio.
  Both dates are required. Dated acquisitions/registrations and observed additions
  establish the opening cohort; earlier sales, drops, archives and observed removals
  remove names. Acquisitions during the period are excluded. This uses all
  currencies and is not annualized. Missing historical ownership limits coverage.

Monthly trends group by sale date, not cash receipt date. Breakdowns cover
marketplace, the last recorded registrar account at sale, TLD and **current**
folder. Unknown metadata is explicitly grouped. CSV export contains the filtered
sale records and leaves unknown monetary values blank; it uses the shared CSV
formula guard.

## Persistence and compatibility

`sale-details` stores one validated financial record keyed by sale event ID. It
survives cache clearing, is deleted with the event/domain, and is included in full
backups. No registrar API calls or marketplace mutations are made.

Backup format v9 protects the new non-cache namespace from being silently dropped
by older builds. v1–v8 backups remain readable. Old snapshots have no confirmed
financials until reviewed. The domain CSV format is unchanged; use the dedicated
sales CSV for analytical output and a full backup to preserve financial details.
