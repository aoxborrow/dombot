import { useMemo } from 'react';
import {
  Archive,
  ArrowUpDown,
  Briefcase,
  CalendarClock,
  ChartLine,
  CircleDashed,
  CircleOff,
  Globe,
  Receipt,
  Store,
  Tag,
  TimerOff,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toAscii } from '../../../shared/domain-name';
import type { ArchiveLabel } from '../../../shared/ownership';
import type { Domain, ListPrice } from '../../../shared/ipc';
import {
  marketState,
  priceComparison,
  type MarketStateChoice,
  type PriceComparison,
} from '../../../shared/market-filter';
import type {
  DomainTrafficTotals,
  MarketListing,
} from '../../../shared/markets';
import { compactMoney, wholeMoney } from '../../lib/renewals';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Domains table (docs/markets.md, "Domains table and
// actions"): up to five per view (fewer without a market account), most
// useful first, adding up the names the table shows, so a filter (a TLD, a
// folder, one market) shows that slice. A card that matches a filter
// sets it.

export type DomainsView = 'owned' | 'listings' | 'archive';

const pct = (n: number, of: number) =>
  of ? `${Math.round((n / of) * 100)}%` : '—';
const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export interface DomainsCardActions {
  /** Expiring within `days`, auto-renew off. */
  onExpiring: (days: 30 | 60) => void;
  /** The Markets filter set to these states (in the markets in play). */
  onMarketStates: (states: MarketStateChoice[]) => void;
  /** The Markets filter set to listings priced apart from your BIN. */
  onPriceComparisons: (comparisons: PriceComparison[]) => void;
  /** Owned's Listed card: the Listings view. */
  onListings: () => void;
  onArchiveStatus: (labels: ArchiveLabel[]) => void;
}

export function DomainsCards({
  view,
  rows,
  listings,
  markets,
  listPrices,
  traffic,
  expiresWithin,
  archiveLabelOf,
  actions,
}: {
  view: DomainsView;
  /** The table's rows, as filtered. */
  rows: readonly Domain[];
  listings: Record<string, MarketListing[]>;
  /** The markets in play: the Markets filter's, else every connected one;
   * none without a market account. */
  markets: readonly string[];
  listPrices: Record<string, ListPrice>;
  /** Each name's market views and leads (30 and 365 days), where fetched. */
  traffic: Record<string, DomainTrafficTotals>;
  /** Whether a name expires within 30 or 60 days (and hasn't yet). */
  expiresWithin: (d: Domain, days: 30 | 60) => boolean;
  archiveLabelOf: (d: Domain) => ArchiveLabel | null;
  actions: DomainsCardActions;
}) {
  const cards = useMemo(() => {
    const listingsOf = (d: Domain) =>
      (listings[toAscii(d.domainName)] ?? []).filter((l) =>
        markets.includes(l.market),
      );
    const statesOf = (d: Domain) => listingsOf(d).map(marketState);
    if (view === 'archive') {
      const n: Record<ArchiveLabel, number> = {
        sold: 0,
        deleted: 0,
        expired: 0,
        removed: 0,
      };
      // Names you no longer have that a market still shows: to take down.
      let stillListed = 0;
      for (const d of rows) {
        const label = archiveLabelOf(d);
        if (label) n[label] += 1;
        const states = statesOf(d);
        if (states.includes('active') || states.includes('pending'))
          stillListed += 1;
      }
      return { view, ...n, stillListed };
    }
    if (view === 'listings') {
      let listed = 0;
      let unlisted = 0;
      let pending = 0;
      let rejected = 0;
      let inactive = 0;
      let above = 0;
      let below = 0;
      let issues = 0;
      let apart = 0;
      // Listed names with a BIN price; views and leads over 30 days.
      let listedPriced = 0;
      let views = 0;
      let leads = 0;
      let withTraffic = 0;
      for (const d of rows) {
        const states = statesOf(d);
        const key = toAscii(d.domainName);
        if (states.includes('active')) {
          listed += 1;
          if (listPrices[key]?.amount != null) listedPriced += 1;
        }
        const tr = traffic[key];
        if (tr) {
          withTraffic += 1;
          views += tr.views30;
          leads += tr.leads30;
        }
        if (!states.some(Boolean)) unlisted += 1;
        if (states.includes('pending')) pending += 1;
        if (states.includes('rejected')) rejected += 1;
        if (states.includes('inactive')) inactive += 1;
        // A name counts once in a headline, however many markets flag it.
        if (states.includes('rejected') || states.includes('inactive'))
          issues += 1;
        const mine = listPrices[toAscii(d.domainName)];
        const prices = listingsOf(d).map((l) => priceComparison(l, mine));
        if (prices.includes('above')) above += 1;
        if (prices.includes('below')) below += 1;
        if (prices.includes('above') || prices.includes('below')) apart += 1;
      }
      return {
        view,
        listed,
        unlisted,
        pending,
        rejected,
        inactive,
        above,
        below,
        issues,
        apart,
        listedPriced,
        views,
        leads,
        withTraffic,
      };
    }
    // Expiring and not renewing: a name auto-renew will take care of isn't
    // a worry.
    let in30 = 0;
    let in60 = 0;
    let renewOff = 0;
    let imported = 0;
    let listed = 0;
    const registrars = new Set<string>();
    for (const d of rows) {
      // As the Auto-renew filter's Off: unknown isn't off.
      if (!d.autoRenewUnknown && !d.autoRenew) {
        renewOff += 1;
        if (expiresWithin(d, 30)) in30 += 1;
        if (expiresWithin(d, 60)) in60 += 1;
      }
      if (statesOf(d).includes('active')) listed += 1;
      if (d.source === 'imported') imported += 1;
      else if (d.registrar) registrars.add(d.registrar);
    }
    return {
      view,
      in30,
      in60,
      renewOff,
      imported,
      listed,
      registrars: registrars.size,
    };
  }, [
    view,
    rows,
    listings,
    markets,
    listPrices,
    traffic,
    expiresWithin,
    archiveLabelOf,
  ]);

  const marketsOn = markets.length > 0;
  const total = rows.length;
  // What the BIN prices add up to, in the currency most of them use
  // (amounts are never converted).
  const bin = useMemo(() => {
    const byCurrency = new Map<string, { sum: number; count: number }>();
    for (const d of rows) {
      const lp = listPrices[toAscii(d.domainName)];
      if (lp?.amount == null) continue;
      const e = byCurrency.get(lp.currency) ?? { sum: 0, count: 0 };
      e.sum += Number(lp.amount);
      e.count += 1;
      byCurrency.set(lp.currency, e);
    }
    const [currency, main] = [...byCurrency].sort(
      (a, b) => b[1].count - a[1].count,
    )[0] ?? [null, null];
    return { currency, sum: main?.sum ?? 0, count: main?.count ?? 0 };
  }, [rows, listPrices]);
  // The words beside a card's number, or none.
  const words = (...parts: (string | false)[]) =>
    parts.filter(Boolean).join(' · ') || undefined;

  // Every card is a label over a big number, with a few words beside it
  // where they help: two rows, so the label and number are bigger.
  if (cards.view === 'archive') {
    return (
      <StatCardRow>
        <StatCard
          size="sm"
          icon={Archive}
          accentClass="text-slate-400"
          label="Archived"
          value={total.toLocaleString()}
        />
        <StatCard
          size="sm"
          icon={Receipt}
          accentClass="text-violet-400"
          label="Sold"
          value={cards.sold.toLocaleString()}
          onClick={() => actions.onArchiveStatus(['sold'])}
        />
        <StatCard
          size="sm"
          icon={TimerOff}
          accentClass="text-amber-400"
          label="Expired"
          value={cards.expired.toLocaleString()}
          onClick={() => actions.onArchiveStatus(['expired'])}
        />
        <StatCard
          size="sm"
          icon={Trash2}
          accentClass="text-rose-400"
          label="Deleted or removed"
          value={(cards.deleted + cards.removed).toLocaleString()}
          onClick={() => actions.onArchiveStatus(['deleted', 'removed'])}
        />
        {marketsOn && (
          <StatCard
            size="sm"
            icon={Tag}
            accentClass="text-sky-400"
            label="Still listed"
            value={cards.stillListed.toLocaleString()}
            onClick={() => actions.onMarketStates(['active', 'pending'])}
          />
        )}
      </StatCardRow>
    );
  }
  if (cards.view === 'listings') {
    return (
      <StatCardRow>
        <StatCard
          size="sm"
          icon={Store}
          accentClass="text-brand-400"
          label="Listed"
          value={[
            {
              value: cards.listed.toLocaleString(),
              // Out of how many, as Expiring's "/30d".
              unit: `/${total.toLocaleString()}`,
              // Of those listed, how many have your BIN price.
              words: `${pct(cards.listedPriced, cards.listed)} BIN priced`,
            },
          ]}
          onClick={() => actions.onMarketStates(['active'])}
        />
        <StatCard
          size="sm"
          icon={CircleOff}
          accentClass="text-slate-400"
          label="Not listed"
          // Pending listings aren't live yet either.
          value={[
            {
              value: cards.unlisted.toLocaleString(),
              unit: words(!!cards.pending && `${cards.pending} pending`),
            },
          ]}
          onClick={() => actions.onMarketStates(['none'])}
        />
        <StatCard
          size="sm"
          icon={TriangleAlert}
          accentClass="text-rose-400"
          label="Issues"
          value={[
            {
              value: cards.issues.toLocaleString(),
              unit: words(
                !!cards.rejected && `${cards.rejected} rejected`,
                !!cards.inactive && `${cards.inactive} inactive`,
              ),
            },
          ]}
          onClick={() => actions.onMarketStates(['rejected', 'inactive'])}
        />
        <StatCard
          size="sm"
          icon={ArrowUpDown}
          accentClass="text-amber-400"
          label="Discrepancies"
          // A market's price apart from your BIN price.
          value={[
            {
              value: cards.apart.toLocaleString(),
              unit: words(
                !!cards.above && `${cards.above} above`,
                !!cards.below && `${cards.below} below`,
              ),
            },
          ]}
          onClick={() => actions.onPriceComparisons(['above', 'below'])}
        />
        <StatCard
          size="sm"
          icon={ChartLine}
          accentClass="text-sky-400"
          label="Views, 30 days"
          // Visits to the names' sale pages; leads only from Afternic.
          value={[
            {
              value: cards.withTraffic ? cards.views.toLocaleString() : '—',
              unit: cards.leads ? plural(cards.leads, 'lead') : undefined,
            },
          ]}
        />
      </StatCardRow>
    );
  }
  return (
    <StatCardRow>
      <StatCard
        size="sm"
        icon={Globe}
        accentClass="text-brand-400"
        label="Domains"
        value={[
          {
            value: total.toLocaleString(),
            unit: words(
              !!cards.registrars && plural(cards.registrars, 'registrar'),
            ),
          },
        ]}
      />
      <StatCard
        size="sm"
        icon={CalendarClock}
        accentClass="text-rose-400"
        label="Expiring soon"
        value={[
          { value: cards.in30.toLocaleString(), unit: '/30d' },
          { value: cards.in60.toLocaleString(), unit: '/60d' },
        ]}
        onClick={() => actions.onExpiring(cards.in30 ? 30 : 60)}
      />
      {/* A placeholder, for a card to come. */}
      <StatCard
        size="sm"
        icon={CircleDashed}
        accentClass="text-slate-400"
        label="Placeholder"
        value="—"
      />
      {marketsOn && (
        <StatCard
          size="sm"
          icon={Tag}
          accentClass="text-sky-400"
          label="For sale"
          // Not "/251": the page shows the total enough already.
          value={[
            {
              value: cards.listed.toLocaleString(),
              words: `${pct(cards.listed, total)} listed`,
            },
          ]}
          onClick={actions.onListings}
        />
      )}
      <StatCard
        size="sm"
        icon={Briefcase}
        accentClass="text-emerald-400"
        label="Total BIN"
        // The BIN prices added up; in the currency most of them use.
        value={[
          {
            value: bin.currency ? wholeMoney(bin.sum, bin.currency) : '—',
            unit:
              bin.currency && bin.count
                ? `${compactMoney(bin.sum / bin.count, bin.currency)} avg`
                : undefined,
          },
        ]}
      />
    </StatCardRow>
  );
}
