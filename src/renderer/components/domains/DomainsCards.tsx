import { useMemo } from 'react';
import {
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
  type MarketStateChoice,
} from '../../../shared/market-filter';
import type { MarketListing } from '../../../shared/markets';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Domains table (docs/markets.md, "Domains table and
// actions"): three per view, adding up the names the table shows, so a
// filter (a TLD, a folder, one market) shows that slice. A card that
// matches a filter sets it.

export type DomainsView = 'owned' | 'listings' | 'archive';

const pct = (n: number, of: number) =>
  of ? `${Math.round((n / of) * 100)}%` : '—';
const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
// A blank hint keeps the cards the same height.
const BLANK = ' ';

export interface DomainsCardActions {
  /** Expiring within 30 days. */
  onExpiring: () => void;
  /** The Markets filter set to these states (in the markets in play). */
  onMarketStates: (states: MarketStateChoice[]) => void;
  onArchiveStatus: (labels: ArchiveLabel[]) => void;
}

export function DomainsCards({
  view,
  rows,
  listings,
  markets,
  filteredToMarkets,
  marketNames,
  listPrices,
  expiresWithin,
  archiveLabelOf,
  actions,
}: {
  view: DomainsView;
  /** The table's rows, as filtered. */
  rows: readonly Domain[];
  listings: Record<string, MarketListing[]>;
  /** The markets in play: the Markets filter's, else every connected one. */
  markets: readonly string[];
  /** Whether the Markets filter picks markets (the note names them). */
  filteredToMarkets: boolean;
  marketNames: (id: string) => string;
  listPrices: Record<string, ListPrice>;
  /** Whether a name expires within `days` (and hasn't yet). */
  expiresWithin: (d: Domain, days: 30 | 60) => boolean;
  archiveLabelOf: (d: Domain) => ArchiveLabel | null;
  actions: DomainsCardActions;
}) {
  const cards = useMemo(() => {
    if (view === 'archive') {
      const n: Record<ArchiveLabel, number> = {
        sold: 0,
        deleted: 0,
        expired: 0,
        removed: 0,
      };
      for (const d of rows) {
        const label = archiveLabelOf(d);
        if (label) n[label] += 1;
      }
      return { view, ...n };
    }
    if (view === 'listings') {
      let listed = 0;
      let unlisted = 0;
      let pending = 0;
      let rejected = 0;
      let inactive = 0;
      for (const d of rows) {
        const states = (listings[toAscii(d.domainName)] ?? [])
          .filter((l) => markets.includes(l.market))
          .map(marketState);
        if (states.includes('active')) listed += 1;
        if (!states.some(Boolean)) unlisted += 1;
        if (states.includes('pending')) pending += 1;
        if (states.includes('rejected')) rejected += 1;
        if (states.includes('inactive')) inactive += 1;
      }
      return { view, listed, unlisted, pending, rejected, inactive };
    }
    let in30 = 0;
    let in60 = 0;
    let renewOff = 0;
    let priced = 0;
    let imported = 0;
    const registrars = new Set<string>();
    for (const d of rows) {
      if (expiresWithin(d, 30)) in30 += 1;
      if (expiresWithin(d, 60)) in60 += 1;
      if (!d.autoRenewUnknown && !d.autoRenew) renewOff += 1;
      if (listPrices[toAscii(d.domainName)]?.amount != null) priced += 1;
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

  const total = rows.length;
  const hint = (...parts: (string | false)[]) =>
    parts.filter(Boolean).join(' · ') || BLANK;
  let body: React.ReactNode;
  if (cards.view === 'archive') {
    body = (
      <>
        <StatCard
          size="sm"
          icon={BadgeDollarSign}
          accentClass="text-violet-500"
          label="Sold"
          value={cards.sold.toLocaleString()}
          hint={BLANK}
          onClick={() => actions.onArchiveStatus(['sold'])}
        />
        <StatCard
          size="sm"
          icon={TimerOff}
          accentClass="text-amber-500"
          label="Expired"
          value={cards.expired.toLocaleString()}
          hint={BLANK}
          onClick={() => actions.onArchiveStatus(['expired'])}
        />
        <StatCard
          size="sm"
          icon={Trash2}
          accentClass="text-rose-500"
          label="Deleted or removed"
          value={(cards.deleted + cards.removed).toLocaleString()}
          hint={hint(
            !!cards.deleted && `${cards.deleted} deleted`,
            !!cards.removed && `${cards.removed} removed`,
          )}
          onClick={() => actions.onArchiveStatus(['deleted', 'removed'])}
        />
      </>
    );
  } else if (cards.view === 'listings') {
    body = (
      <>
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
      </>
    );
  } else {
    body = (
      <>
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
          label="Expiring, 30 days"
          value={cards.in30.toLocaleString()}
          hint={hint(
            `${cards.in60.toLocaleString()} in 60`,
            `${cards.renewOff.toLocaleString()} auto-renew off`,
          )}
          onClick={actions.onExpiring}
        />
        <StatCard
          size="sm"
          icon={Tag}
          accentClass="text-violet-500"
          label="BIN priced"
          value={pct(cards.priced, total)}
          hint={`${cards.priced.toLocaleString()} of ${plural(total, 'name')}`}
        />
      </>
    );
  }

  return (
    <StatCardRow
      note={
        <>
          Totals of the names in the table below, as filtered
          {cards.view === 'listings' && filteredToMarkets
            ? `, on ${markets.map(marketNames).join(' and ')}`
            : ''}
          .
        </>
      }
    >
      {body}
    </StatCardRow>
  );
}
