import type { ReactNode } from 'react';
import { toAscii } from '../../../shared/domain-name';
import type { AskingPrice, Domain, DomainPurchase } from '../../../shared/ipc';
import { formatMoney, type NumberFormatId } from '../../../shared/money';
import { NotesButton } from './NotesButton';
import { cn } from '@/lib/utils';

type Labels = Record<string, string>;

export interface PurchaseColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  hideOnMobile?: boolean;
  render: (d: Domain, labels: Labels) => ReactNode;
  sortValue: (d: Domain, labels: Labels) => string | number | null;
}

function recordOf(
  purchases: Record<string, DomainPurchase>,
  domain: Domain,
): DomainPurchase | undefined {
  return purchases[toAscii(domain.domainName)];
}

/** Fills the cell, including its padding, so one click anywhere opens the editor. */
function PurchaseCell({
  domain,
  onEdit,
  align = 'left',
  title,
  empty = false,
  editLabel = 'Purchase details',
  children,
}: {
  domain: Domain;
  onEdit: (domain: Domain) => void;
  align?: 'left' | 'right';
  title?: string;
  empty?: boolean;
  editLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={empty ? `${editLabel} for ${domain.domainName}` : undefined}
      className={cn(
        'block w-[calc(100%+1rem)] cursor-pointer px-2 py-3 -mx-2 -my-3 hover:text-brand compact:-my-[9px] compact:py-[9px]',
        align === 'right' ? 'text-right' : 'text-left',
        empty && 'text-muted-foreground',
      )}
      onClick={() => onEdit(domain)}
    >
      {title ? (
        <span className="block max-w-48 truncate">{children}</span>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Purchase date, amount, and notes. Archive also gets sold date and amount
 * first; Owned gets the asking price after what you paid.
 */
export function purchaseColumns({
  purchases,
  preferredCurrency,
  numberFormat,
  onEdit,
  onEditSale,
  showSale = false,
  isSold,
  askingPrices,
  onEditAsking,
}: {
  purchases: Record<string, DomainPurchase>;
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  onEdit: (domain: Domain) => void;
  onEditSale?: (domain: Domain) => void;
  /** History view: sold date and sold amount, before the purchase columns. */
  showSale?: boolean;
  isSold?: (domain: Domain) => boolean;
  /** Owned view: the Asking column, after Paid. */
  askingPrices?: Record<string, AskingPrice>;
  onEditAsking?: (domain: Domain) => void;
}): PurchaseColumn[] {
  const money = (amount: string, currency: string) =>
    formatMoney(amount, currency, preferredCurrency, numberFormat);
  const asking: PurchaseColumn[] =
    askingPrices && onEditAsking && !showSale
      ? [
          {
            key: 'askingPrice',
            label: 'Asking',
            align: 'right',
            hideOnMobile: true,
            render: (d) => {
              const p = askingPrices[toAscii(d.domainName)];
              const text = !p
                ? null
                : p.amount
                  ? money(p.amount, p.currency)
                  : p.minOffer
                    ? `Offers from ${money(p.minOffer, p.currency)}`
                    : `Floor ${money(p.floor ?? '0', p.currency)}`;
              const details = p
                ? [
                    p.minOffer &&
                      `Minimum offer ${money(p.minOffer, p.currency)}`,
                    p.floor && `Floor ${money(p.floor, p.currency)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '';
              return (
                <PurchaseCell
                  domain={d}
                  onEdit={onEditAsking}
                  align="right"
                  empty={!text}
                  editLabel="Asking price"
                >
                  {/* The details go on the text, so the button keeps the
                      price as its name. */}
                  <span title={details || undefined}>{text || '—'}</span>
                </PurchaseCell>
              );
            },
            sortValue: (d) => {
              const p = askingPrices[toAscii(d.domainName)];
              const value = p?.amount ?? p?.minOffer ?? p?.floor;
              return value == null ? null : Number(value);
            },
          },
        ]
      : [];
  const sale: PurchaseColumn[] = showSale
    ? [
        {
          key: 'saleDate',
          label: 'Sold',
          hideOnMobile: true,
          render: (d) => {
            const date = recordOf(purchases, d)?.saleDate;
            const text = date || '—';
            if (!onEditSale || !isSold?.(d)) {
              return (
                <span className={!date ? 'text-muted-foreground' : undefined}>
                  {text}
                </span>
              );
            }
            return (
              <PurchaseCell
                domain={d}
                onEdit={onEditSale}
                empty={!date}
                editLabel="Sale details"
              >
                {text}
              </PurchaseCell>
            );
          },
          sortValue: (d) => recordOf(purchases, d)?.saleDate ?? null,
        },
        {
          key: 'saleAmount',
          label: 'Sold for',
          align: 'right',
          render: (d) => {
            const record = recordOf(purchases, d);
            const text =
              record?.saleAmount && record.saleCurrency
                ? formatMoney(
                    record.saleAmount,
                    record.saleCurrency,
                    preferredCurrency,
                    numberFormat,
                  )
                : null;
            const shown = text || '—';
            if (!onEditSale || !isSold?.(d)) {
              return (
                <span className={!text ? 'text-muted-foreground' : undefined}>
                  {shown}
                </span>
              );
            }
            return (
              <PurchaseCell
                domain={d}
                onEdit={onEditSale}
                align="right"
                empty={!text}
                editLabel="Sale details"
              >
                {shown}
              </PurchaseCell>
            );
          },
          sortValue: (d) => {
            const amount = recordOf(purchases, d)?.saleAmount;
            return amount == null ? null : Number(amount);
          },
        },
      ]
    : [];

  return [
    ...sale,
    {
      key: 'purchaseDate',
      label: 'Purchased',
      hideOnMobile: true,
      render: (d) => {
        const date = recordOf(purchases, d)?.purchaseDate;
        return (
          <PurchaseCell domain={d} onEdit={onEdit} empty={!date}>
            {date || '—'}
          </PurchaseCell>
        );
      },
      sortValue: (d) => recordOf(purchases, d)?.purchaseDate ?? null,
    },
    {
      key: 'purchaseAmount',
      label: 'Paid',
      align: 'right',
      render: (d) => {
        const record = recordOf(purchases, d);
        const text =
          record?.amount && record.currency
            ? formatMoney(
                record.amount,
                record.currency,
                preferredCurrency,
                numberFormat,
              )
            : null;
        return (
          <PurchaseCell domain={d} onEdit={onEdit} align="right" empty={!text}>
            {text || '—'}
          </PurchaseCell>
        );
      },
      sortValue: (d) => {
        const amount = recordOf(purchases, d)?.amount;
        return amount == null ? null : Number(amount);
      },
    },
    ...asking,
    {
      key: 'purchaseNotes',
      label: 'Notes',
      hideOnMobile: true,
      // A sticky note: hover to read, click to edit (see NotesButton).
      render: (d) => (
        <span className="-my-2 flex">
          <NotesButton
            domainName={d.domainName}
            notes={recordOf(purchases, d)?.notes ?? ''}
          />
        </span>
      ),
      sortValue: (d) => recordOf(purchases, d)?.notes?.toLowerCase() || null,
    },
  ];
}
