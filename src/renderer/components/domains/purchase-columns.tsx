import type { ReactNode } from 'react';
import { toAscii } from '../../../shared/domain-name';
import type { ListPrice, Domain, DomainPurchase } from '../../../shared/ipc';
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
 * The purchase date. A click opens Purchase details. Archive shows this
 * all the time; Active shows it only while the Purchased filter is set.
 */
export function purchaseDateColumn(
  purchases: Record<string, DomainPurchase>,
  onEdit?: (domain: Domain) => void,
): PurchaseColumn {
  return {
    key: 'purchaseDate',
    label: 'Purchased',
    hideOnMobile: true,
    render: (d) => {
      const date = recordOf(purchases, d)?.purchaseDate;
      const text = date || '—';
      if (!onEdit) {
        return (
          <span className={!date ? 'text-muted-foreground' : undefined}>
            {text}
          </span>
        );
      }
      return (
        <PurchaseCell
          domain={d}
          onEdit={onEdit}
          empty={!date}
          editLabel="Purchase details"
        >
          {text}
        </PurchaseCell>
      );
    },
    sortValue: (d) => recordOf(purchases, d)?.purchaseDate ?? null,
  };
}

/** What you paid. Sits beside Purchased, the same way Sold for sits beside Sold. */
export function purchaseAmountColumn(
  purchases: Record<string, DomainPurchase>,
  preferredCurrency: string,
  numberFormat: NumberFormatId,
  onEdit?: (domain: Domain) => void,
): PurchaseColumn {
  return {
    key: 'purchaseAmount',
    label: 'Purchased for',
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
      const shown = text || '—';
      if (!onEdit) {
        return (
          <span className={!text ? 'text-muted-foreground' : undefined}>
            {shown}
          </span>
        );
      }
      return (
        <PurchaseCell
          domain={d}
          onEdit={onEdit}
          align="right"
          empty={!text}
          editLabel="Purchase details"
        >
          {shown}
        </PurchaseCell>
      );
    },
    sortValue: (d) => {
      const amount = recordOf(purchases, d)?.amount;
      return amount == null ? null : Number(amount);
    },
  };
}

/**
 * Money columns for the Domains table: Archive gets the purchase and sale,
 * Owned gets the BIN price and minimum offer.
 */
export function purchaseColumns({
  purchases,
  preferredCurrency,
  numberFormat,
  onEditPurchase,
  onEditSale,
  showSale = false,
  isSold,
  listPrices,
  onEditListPrice,
}: {
  purchases: Record<string, DomainPurchase>;
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  onEditPurchase?: (domain: Domain) => void;
  onEditSale?: (domain: Domain) => void;
  /** Archive view: purchase date, purchase amount, sold date, sold amount. */
  showSale?: boolean;
  isSold?: (domain: Domain) => boolean;
  /** Owned view: the BIN price and Min offer columns. */
  listPrices?: Record<string, ListPrice>;
  onEditListPrice?: (domain: Domain) => void;
}): PurchaseColumn[] {
  // Owned view: BIN price and Min offer (Floor is in the editor), each
  // opening the same editor.
  const listPriceOf = (d: Domain) => listPrices?.[toAscii(d.domainName)];
  const listPriceColumn = (
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
      const p = listPriceOf(d);
      const value = p?.[field];
      return (
        <PurchaseCell
          domain={d}
          onEdit={onEditListPrice!}
          align="right"
          empty={!value}
          editLabel={editLabel}
        >
          {value
            ? formatMoney(
                value,
                p!.currency,
                preferredCurrency,
                numberFormat,
                true,
              )
            : '—'}
        </PurchaseCell>
      );
    },
    sortValue: (d) => {
      const value = listPriceOf(d)?.[field];
      return value == null ? null : Number(value);
    },
  });
  const pricing: PurchaseColumn[] =
    listPrices && onEditListPrice && !showSale
      ? [
          listPriceColumn('binPrice', 'BIN price', 'amount', 'BIN price'),
          listPriceColumn('minOffer', 'Min offer', 'minOffer', 'Minimum offer'),
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

  const bought: PurchaseColumn[] = showSale
    ? [
        purchaseDateColumn(purchases, onEditPurchase),
        purchaseAmountColumn(
          purchases,
          preferredCurrency,
          numberFormat,
          onEditPurchase,
        ),
      ]
    : [];

  return [...bought, ...sale, ...pricing];
}
