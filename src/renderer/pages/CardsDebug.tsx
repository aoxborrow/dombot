import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BadgeDollarSign,
  Banknote,
  CalendarClock,
  Eye,
  Gem,
  PiggyBank,
  Globe,
  Store,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { StatCard, StatCardRow } from '../components/StatCard';

/**
 * Dev builds only (#/debug/cards): rows of three, four and five cards, and
 * what each row's cards measure, for tuning the cards' sizes while resizing
 * the window. Made-up values for a 10,000-name portfolio worth $10M: a
 * short number, a medium one, one with long secondary data after it, and a
 * long one. A row of three leaves out the short one; the fifth (from
 * 1200px) is Expiring soon's two numbers. Then a row of the other shapes
 * the pages' cards take: the longest label, two numbers, several words, and
 * words that change with the window (Sales' Gross). Last, a portfolio of
 * 100,000 names worth $100M, whose numbers have to get smaller, and the
 * currencies' shapes: dot and apostrophe separators, a code for a symbol, a
 * loss, a code after the number.
 */
const CARDS = [
  <StatCard
    key="short"
    size="sm"
    icon={BadgeDollarSign}
    accentClass="text-emerald-400"
    label="Sold"
    value="3"
  />,
  <StatCard
    key="medium"
    size="sm"
    icon={Globe}
    accentClass="text-brand-400"
    label="Domains"
    value="10,251"
  />,
  <StatCard
    key="long-cut"
    size="sm"
    icon={Store}
    accentClass="text-sky-400"
    label="For Sale"
    value={[{ value: '9,140', unit: '/10,251', words: '89% listed' }]}
  />,
  <StatCard
    key="long-whole"
    size="sm"
    icon={Gem}
    accentClass="text-violet-400"
    label="BIN value"
    value="$10,486,750"
  />,
  <StatCard
    key="fifth"
    size="sm"
    icon={CalendarClock}
    accentClass="text-rose-400"
    label="Expiring soon"
    value={[
      { value: '215', unit: '/30d' },
      { value: '480', unit: '/60d' },
    ]}
  />,
];

const EDGE_CARDS = [
  <StatCard
    key="label"
    size="sm"
    icon={Trash2}
    accentClass="text-zinc-400"
    label="Deleted or removed"
    value="1,204"
  />,
  <StatCard
    key="two"
    size="sm"
    icon={CalendarClock}
    accentClass="text-rose-400"
    label="Expiring soon"
    value={[
      { value: '215', unit: '/30d' },
      { value: '480', unit: '/60d' },
    ]}
  />,
  <StatCard
    key="words"
    size="sm"
    icon={TriangleAlert}
    accentClass="text-amber-400"
    label="Issues"
    value={[{ value: '12', words: ['3 rejected', '9 inactive'] }]}
  />,
  <StatCard
    key="gross"
    size="sm"
    icon={Banknote}
    accentClass="text-emerald-400"
    label="Gross"
    value={[
      {
        value: '$1,234,567',
        unit: (
          <>
            <span className="wide:hidden">$48.2K fees</span>
            <span className="max-wide:hidden">$12.3K avg</span>
          </>
        ),
      },
    ]}
  />,
  <StatCard
    key="views"
    size="sm"
    icon={Eye}
    accentClass="text-sky-400"
    label="Views, 30 days"
    value={[{ value: '48,210', unit: '12 leads' }]}
  />,
];

const BIG_CARDS = [
  <StatCard
    key="domains"
    size="sm"
    icon={Globe}
    accentClass="text-brand-400"
    label="Domains"
    value={[{ value: '100,251', unit: '12 registrars' }]}
  />,
  <StatCard
    key="for-sale"
    size="sm"
    icon={Store}
    accentClass="text-sky-400"
    label="For Sale"
    value={[{ value: '91,140', unit: '/100,251', words: '91% listed' }]}
  />,
  <StatCard
    key="value"
    size="sm"
    icon={Gem}
    accentClass="text-violet-400"
    label="BIN value"
    value={[{ value: '$104,867,500', unit: '$1,046 avg' }]}
  />,
  <StatCard
    key="profit"
    size="sm"
    icon={PiggyBank}
    accentClass="text-emerald-400"
    label="Profit"
    value={[{ value: '$13,943,180', unit: '3,866% ROI' }]}
  />,
  <StatCard
    key="gross"
    size="sm"
    icon={Banknote}
    accentClass="text-emerald-400"
    label="Gross"
    value="$1,048,675,000"
  />,
];

const MONEY_CARDS = [
  <StatCard
    key="eur"
    size="sm"
    icon={Gem}
    accentClass="text-violet-400"
    label="BIN value"
    value={[{ value: '€1.234.567', unit: '€9,8k avg' }]}
  />,
  <StatCard
    key="chf"
    size="sm"
    icon={Banknote}
    accentClass="text-emerald-400"
    label="Gross"
    value="CHF 1'234'567"
  />,
  <StatCard
    key="loss"
    size="sm"
    icon={PiggyBank}
    accentClass="text-emerald-400"
    label="Profit"
    value={[
      { value: '−$39,431', unit: '−12% ROI', className: 'text-destructive' },
    ]}
  />,
  <StatCard
    key="jpy"
    size="sm"
    icon={BadgeDollarSign}
    accentClass="text-emerald-400"
    label="Net"
    value="¥1,234,567 JPY"
  />,
  <StatCard
    key="sek"
    size="sm"
    icon={Store}
    accentClass="text-sky-400"
    label="Fees"
    value="kr 123 456"
  />,
];

export default function CardsDebug() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-[32px]">Cards</h1>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          Window {width}px · {width < 640 ? 'phone (compact)' : 'regular'} text
        </p>
      </div>
      <Row title="3 cards" cards={CARDS.slice(1, 4)} />
      <Row title="4 cards" cards={CARDS.slice(0, 4)} />
      <Row title="5 cards" cards={CARDS} />
      <Row title="Other shapes" cards={EDGE_CARDS} />
      <Row title="100,000 names" cards={BIG_CARDS} />
      <Row title="Currencies" cards={MONEY_CARDS} />
    </div>
  );
}

/** A row of cards, saying how wide they are and where the icon went. */
function Row({ title, cards }: { title: string; cards: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState('');
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const measure = () => {
      const cards = [
        ...row.querySelectorAll<HTMLElement>('.\\@container'),
      ].filter((c) => c.offsetParent);
      const card = cards[0];
      const icon = card?.querySelector('svg');
      if (!card || !icon) return;
      const style = getComputedStyle(card);
      const inside =
        card.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const c = card.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      const across = cards.filter(
        (x) => Math.abs(x.getBoundingClientRect().top - c.top) < 2,
      ).length;
      setInfo(
        `${across} across · ${Math.round(c.width)}px cards (${Math.round(inside)} inside) · ${Math.round(i.width)}px icon ${Math.abs(i.top + i.bottom - c.top - c.bottom) < 4 ? 'on the right' : 'in the corner'}`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref}>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <StatCardRow note={<span className="tabular-nums">{info}</span>}>
        {cards}
      </StatCardRow>
    </div>
  );
}
