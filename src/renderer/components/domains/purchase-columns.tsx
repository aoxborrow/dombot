import type { ReactNode } from 'react';
import { toAscii } from '../../../shared/domain-name';
import type { AskingPrice, Domain, DomainPurchase } from '../../../shared/ipc';
import { formatMoney, type NumberFormatId } from '../../../shared/money';
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
 * Money columns for the Domains table: Archive gets the sold date and
 * amount, Owned gets the pricing (asking price, minimum offer, floor). What you paid is edited from the row
 * menu (Purchase details).
 */
export function purchaseColumns({
  purchases,
  preferredCurrency,
  numberFormat,
  onEditSale,
  showSale = false,
  isSold,
  askingPrices,
  onEditAsking,
}: {
  purchases: Record<string, DomainPurchase>;
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  onEditSale?: (domain: Domain) => void;
  /** Archive view: sold date and sold amount. */
  showSale?: boolean;
  isSold?: (domain: Domain) => boolean;
  /** Owned view: the Pricing, Min offer, and Floor columns. */
  askingPrices?: Record<string, AskingPrice>;
  onEditAsking?: (domain: Domain) => void;
}): PurchaseColumn[] {
  const money = (amount: string, currency: string) =>
    formatMoney(amount, currency, preferredCurrency, numberFormat);
  // Owned view: Pricing (the asking price), Min offer, and Floor, each
  // opening the same editor.
  const askingOf = (d: Domain) => askingPrices?.[toAscii(d.domainName)];
  const askingColumn = (
    key: string,
    label: string,
    field: 'amount' | 'minOffer' | 'floor',
    editLabel: string,
  ): PurchaseColumn => ({
    key,
    label,
    align: 'right',
    hideOnMobile: true,
    render: (d) => {
      const p = askingOf(d);
      const value = p?.[field];
      return (
        <PurchaseCell
          domain={d}
          onEdit={onEditAsking!}
          align="right"
          empty={!value}
          editLabel={editLabel}
        >
          {value ? money(value, p!.currency) : '—'}
        </PurchaseCell>
      );
    },
    sortValue: (d) => {
      const value = askingOf(d)?.[field];
      return value == null ? null : Number(value);
    },
  });
  const asking: PurchaseColumn[] =
    askingPrices && onEditAsking && !showSale
      ? [
          askingColumn('askingPrice', 'Pricing', 'amount', 'Asking price'),
          askingColumn('minOffer', 'Min offer', 'minOffer', 'Minimum offer'),
          askingColumn('floor', 'Floor', 'floor', 'Floor price'),
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

  return [...sale, ...asking];
}
