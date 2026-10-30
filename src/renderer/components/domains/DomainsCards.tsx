import { useMemo } from 'react';
import {
  Archive,
  CalendarClock,
  CircleDollarSign,
  Clock,
  Eye,
  EyeOff,
  Globe,
  IterationCw,
  MessageSquare,
  Store,
  Tag,
  Trash2,
  TriangleAlert,
  BadgeDollarSign,
  TimerOff,
} from 'lucide-react';
import { toAscii } from '../../../shared/domain-name';
import type { ArchiveLabel } from '../../../shared/ownership';
import type { Domain, ListPrice, RenewalPricing } from '../../../shared/ipc';
import { marketState } from '../../../shared/market-filter';
import {
  searchesOf,
  type MarketListing,
  type MarketTraffic,
} from '../../../shared/markets';
import { summarize, wholeMoney } from '../../lib/renewals';
import { StatCard } from '../StatCard';

// The cards above the Domains table (docs/markets.md, "Domains cards"): one
// set per view, adding up the names the table shows, so a filter (a TLD, a
// folder, one market) shows that slice. A card that matches a filter sets it.

export type DomainsView = 'owned' | 'listings' | 'archive';

const pct = (n: number, of: number) =>
  of ? `${Math.round((n / of) * 100)}%` : '—';
const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
// A blank hint keeps the cards the same height.
const BLANK = ' ';

export interface DomainsCardActions {
  /** Expiring within 30 days. */
  onExpiring: () => void;
  onAutoRenewOff: () => void;
  /** The Markets filter set to these states (in the markets in play). */
  onMarketStates: (
    states: ('active' | 'pending' | 'inactive' | 'rejected' | 'none')[],
  ) => void;
  onArchiveStatus: (label: ArchiveLabel) => void;
}

export function DomainsCards({
  view,
  rows,
  listings,
  markets,
  filteredToMarkets,
  marketNames,
  listPrices,
  traffic,
  pricing,
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
  traffic: MarketTraffic;
  pricing: Record<string, RenewalPricing>;
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
      const listingsOf = (d: Domain) =>
        (listings[toAscii(d.domainName)] ?? []).filter((l) =>
          markets.includes(l.market),
        );
      let listed = 0;
      let unlisted = 0;
      let pending = 0;
      let rejected = 0;
      let inactive = 0;
      let views = 0;
      let leads = 0;
      let searches = 0;
      let searched = false;
      // One market picked: its own numbers; otherwise every market's.
      const one =
        filteredToMarkets && markets.length === 1
          ? traffic.byMarket[markets[0] as keyof typeof traffic.byMarket]
          : null;
      for (const d of rows) {
        const key = toAscii(d.domainName);
        const states = listingsOf(d).map(marketState);
        if (states.includes('active')) listed += 1;
        if (!states.some(Boolean)) unlisted += 1;
        if (states.includes('pending')) pending += 1;
        if (states.includes('rejected')) rejected += 1;
        if (states.includes('inactive')) inactive += 1;
        const t = (one ?? traffic.domains)[key];
        views += t?.views365 ?? 0;
        leads += t?.leads365 ?? 0;
        const s = listingsOf(d)
          .map((l) => searchesOf(l)?.total.days365)
          .filter((x): x is number => x != null);
        if (s.length) {
          searched = true;
          searches += Math.max(...s);
        }
      }
      return {
        view,
        listed,
        unlisted,
        pending,
        rejected,
        inactive,
        views,
        leads,
        searches: searched ? searches : null,
      };
    }
    const renewals = summarize([...rows], pricing);
    let in30 = 0;
    let in60 = 0;
    let renewOff = 0;
    let priced = 0;
    let imported = 0;
    for (const d of rows) {
      if (expiresWithin(d, 30)) in30 += 1;
      if (expiresWithin(d, 60)) in60 += 1;
      if (!d.autoRenewUnknown && !d.autoRenew) renewOff += 1;
      if (listPrices[toAscii(d.domainName)]?.amount != null) priced += 1;
      if (d.source === 'imported') imported += 1;
    }
    return { view, renewals, in30, in60, renewOff, priced, imported };
  }, [
    view,
    rows,
    listings,
    markets,
    filteredToMarkets,
    traffic,
    pricing,
    listPrices,
    expiresWithin,
    archiveLabelOf,
  ]);

  const total = rows.length;
  let body: React.ReactNode;
  if (cards.view === 'archive') {
    const card = (
      label: ArchiveLabel,
      title: string,
      icon: typeof Archive,
      accent: string,
    ) => (
      <StatCard
        size="sm"
        icon={icon}
        accentClass={accent}
        label={title}
        value={cards[label].toLocaleString()}
        hint={BLANK}
        onClick={() => actions.onArchiveStatus(label)}
      />
    );
    body = (
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {card('sold', 'Sold', BadgeDollarSign, 'text-violet-500')}
        {card('deleted', 'Deleted', Trash2, 'text-rose-500')}
        {card('expired', 'Expired', TimerOff, 'text-amber-500')}
        {card('removed', 'Removed', Archive, 'text-sky-500')}
      </div>
    );
  } else if (cards.view === 'listings') {
    body = (
      <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-6">
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
          hint={BLANK}
          onClick={() => actions.onMarketStates(['none'])}
        />
        <StatCard
          size="sm"
          icon={Clock}
          accentClass="text-sky-500"
          label="Pending"
          value={cards.pending.toLocaleString()}
          hint={BLANK}
          onClick={() => actions.onMarketStates(['pending'])}
        />
        <StatCard
          size="sm"
          icon={TriangleAlert}
          accentClass="text-rose-500"
          label="Issues"
          value={(cards.rejected + cards.inactive).toLocaleString()}
          hint={
            cards.rejected || cards.inactive
              ? `${cards.rejected} rejected · ${cards.inactive} inactive`
              : BLANK
          }
          onClick={() => actions.onMarketStates(['rejected', 'inactive'])}
        />
        <StatCard
          size="sm"
          icon={Eye}
          accentClass="text-amber-500"
          label="Views, 12 months"
          value={cards.views.toLocaleString()}
          hint={
            cards.searches === null
              ? BLANK
              : `${cards.searches.toLocaleString()} search${cards.searches === 1 ? '' : 'es'}`
          }
        />
        <StatCard
          size="sm"
          icon={MessageSquare}
          accentClass="text-violet-500"
          label="Leads, 12 months"
          value={cards.leads.toLocaleString()}
          hint={
            cards.views
              ? `${((cards.leads / cards.views) * 100).toFixed(1)}% of views`
              : BLANK
          }
        />
      </div>
    );
  } else {
    const r = cards.renewals;
    body = (
      <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-5">
        <StatCard
          size="sm"
          icon={Globe}
          accentClass="text-brand-500"
          label="Domains"
          value={total.toLocaleString()}
          hint={cards.imported ? `${cards.imported} imported` : BLANK}
        />
        <StatCard
          size="sm"
          icon={CalendarClock}
          accentClass="text-rose-500"
          label="Expiring, 30 days"
          value={cards.in30.toLocaleString()}
          hint={`${cards.in60.toLocaleString()} within 60 days`}
          onClick={actions.onExpiring}
        />
        <StatCard
          size="sm"
          icon={CircleDollarSign}
          accentClass="text-sky-500"
          label="Renewals, per year"
          value={r.priced ? wholeMoney(r.yearly, r.currency) : '—'}
          hint={r.priced < r.total ? `${r.priced} of ${r.total} priced` : BLANK}
        />
        <StatCard
          size="sm"
          icon={IterationCw}
          accentClass="text-amber-500"
          label="Auto-renew off"
          value={cards.renewOff.toLocaleString()}
          hint={BLANK}
          onClick={actions.onAutoRenewOff}
        />
        <StatCard
          size="sm"
          icon={Tag}
          accentClass="text-violet-500"
          label="BIN priced"
          value={pct(cards.priced, total)}
          hint={`${cards.priced.toLocaleString()} of ${plural(total, 'name')}`}
        />
      </div>
    );
  }

  return (
    <div className="hidden flex-col gap-1.5 sm:flex">
      {body}
      <p className="text-xs text-muted-foreground">
        Totals of the names in the table below, as filtered
        {cards.view === 'listings' && filteredToMarkets
          ? `, on ${markets.map(marketNames).join(' and ')}`
          : ''}
        .
      </p>
    </div>
  );
}
