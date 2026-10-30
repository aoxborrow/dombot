import { useMemo } from 'react';
import {
  ArrowUpDown,
  BadgeDollarSign,
  CalendarClock,
  EyeOff,
  Globe,
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
import type { MarketListing } from '../../../shared/markets';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Domains table (docs/markets.md, "Domains table and
// actions"): four per view (three without a market account), most useful
// first, adding up the names the table shows, so a filter (a TLD, a
// folder, one market) shows that slice. A card that matches a filter
// sets it.

export type DomainsView = 'owned' | 'listings' | 'archive';

const pct = (n: number, of: number) =>
  of ? `${Math.round((n / of) * 100)}%` : '—';
const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
// A blank hint keeps the cards the same height.
const BLANK = ' ';

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
      for (const d of rows) {
        const states = statesOf(d);
        if (states.includes('active')) listed += 1;
        if (!states.some(Boolean)) unlisted += 1;
        if (states.includes('pending')) pending += 1;
        if (states.includes('rejected')) rejected += 1;
        if (states.includes('inactive')) inactive += 1;
        const mine = listPrices[toAscii(d.domainName)];
        const prices = listingsOf(d).map((l) => priceComparison(l, mine));
        if (prices.includes('above')) above += 1;
        if (prices.includes('below')) below += 1;
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
      };
    }
    // Expiring and not renewing: a name auto-renew will take care of isn't
    // a worry.
    let in30 = 0;
    let in60 = 0;
    let renewOff = 0;
    let priced = 0;
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
      if (listPrices[toAscii(d.domainName)]?.amount != null) priced += 1;
      if (statesOf(d).includes('active')) listed += 1;
      if (d.source === 'imported') imported += 1;
      else if (d.registrar) registrars.add(d.registrar);
    }
    return {
      view,
      in30,
      in60,
      renewOff,
      priced,
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
    expiresWithin,
    archiveLabelOf,
  ]);

  const marketsOn = markets.length > 0;
  const total = rows.length;
  const hint = (...parts: (string | false)[]) =>
    parts.filter(Boolean).join(' · ') || BLANK;

  // Archive's cards are just a label and a number, so both are bigger.
  if (cards.view === 'archive') {
    return (
      <StatCardRow>
        <StatCard
          size="sm"
          icon={BadgeDollarSign}
          accentClass="text-violet-500"
          label="Sold"
          value={cards.sold.toLocaleString()}
          onClick={() => actions.onArchiveStatus(['sold'])}
        />
        <StatCard
          size="sm"
          icon={TimerOff}
          accentClass="text-amber-500"
          label="Expired"
          value={cards.expired.toLocaleString()}
          onClick={() => actions.onArchiveStatus(['expired'])}
        />
        <StatCard
          size="sm"
          icon={Trash2}
          accentClass="text-rose-500"
          label="Deleted or removed"
          value={(cards.deleted + cards.removed).toLocaleString()}
          onClick={() => actions.onArchiveStatus(['deleted', 'removed'])}
        />
        {marketsOn && (
          <StatCard
            size="sm"
            icon={Store}
            accentClass="text-sky-500"
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
          accentClass="text-brand-500"
          label="Listed"
          value={cards.listed.toLocaleString()}
          hint={`${pct(cards.listed, total)} of ${plural(total, 'name')}`}
          onClick={() => actions.onMarketStates(['active'])}
        />
        <StatCard
          size="sm"
          icon={EyeOff}
          accentClass="text-slate-500"
          label="Not listed"
          value={cards.unlisted.toLocaleString()}
          // Pending listings aren't live yet either.
          hint={hint(!!cards.pending && `${cards.pending} pending`)}
          onClick={() => actions.onMarketStates(['none'])}
        />
        <StatCard
          size="sm"
          icon={TriangleAlert}
          accentClass="text-rose-500"
          label="Issues"
          value={(cards.rejected + cards.inactive).toLocaleString()}
          hint={hint(
            !!cards.rejected && `${cards.rejected} rejected`,
            !!cards.inactive && `${cards.inactive} inactive`,
          )}
          onClick={() => actions.onMarketStates(['rejected', 'inactive'])}
        />
        <StatCard
          size="sm"
          icon={ArrowUpDown}
          accentClass="text-amber-500"
          label="Discrepancies"
          value={(cards.above + cards.below).toLocaleString()}
          // A market's price apart from your BIN price.
          hint={hint(
            !!cards.above && `${cards.above} above your price`,
            !!cards.below && `${cards.below} below`,
          )}
          onClick={() => actions.onPriceComparisons(['above', 'below'])}
        />
      </StatCardRow>
    );
  }
  return (
    <StatCardRow>
      <StatCard
        size="sm"
        icon={Globe}
        accentClass="text-brand-500"
        label="Domains"
        value={total.toLocaleString()}
        hint={hint(
          !!cards.registrars && plural(cards.registrars, 'registrar'),
          !!cards.imported && `${cards.imported} imported`,
        )}
      />
      <StatCard
        size="sm"
        icon={CalendarClock}
        accentClass="text-rose-500"
        label="Expiring soon"
        value={[
          {
            value: cards.in30.toLocaleString(),
            unit: '/30d',
            className: cards.in30 ? 'text-destructive' : undefined,
          },
          {
            value: cards.in60.toLocaleString(),
            unit: '/60d',
            className: cards.in60
              ? 'text-orange-500 dark:text-orange-400'
              : undefined,
          },
        ]}
        hint={`Auto-renew off · ${cards.renewOff.toLocaleString()} total`}
        onClick={() => actions.onExpiring(cards.in30 ? 30 : 60)}
      />
      <StatCard
        size="sm"
        icon={Tag}
        accentClass="text-violet-500"
        label="BIN priced"
        value={pct(cards.priced, total)}
        hint={`${cards.priced.toLocaleString()} of ${plural(total, 'name')}`}
      />
      {marketsOn && (
        <StatCard
          size="sm"
          icon={Store}
          accentClass="text-sky-500"
          label="For Sale"
          value={cards.listed.toLocaleString()}
          hint={`${pct(cards.listed, total)} on a market`}
          onClick={actions.onListings}
        />
      )}
    </StatCardRow>
  );
}
