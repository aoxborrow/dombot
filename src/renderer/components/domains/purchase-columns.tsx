import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
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

/**
 * A value you can click to edit: a dotted grey underline, a step lighter on
 * hover but still dimmer than the value (the market columns' are muted).
 */
export const EDITABLE_VALUE =
  'underline decoration-dotted underline-offset-[3px] decoration-neutral-300 group-hover:decoration-neutral-400 dark:decoration-neutral-600 dark:group-hover:decoration-neutral-500';

/**
 * An empty value you can click to fill: a dim dash that turns into a pencil
 * on hover (the cell itself lights up). Sits in a fixed box so the swap
 * doesn't shift anything.
 */
export function EditableEmpty() {
  return (
    <span className="inline-flex h-8 w-7 -my-2 -mr-1 items-center justify-center align-middle text-muted-foreground/50 group-hover:text-muted-foreground compact:h-7 compact:w-6">
      <span className="group-hover:hidden">—</span>
      <Pencil
        className="hidden size-3.5 group-hover:block compact:size-3"
        aria-hidden
      />
    </span>
  );
}

/**
 * Fills the cell, including its padding, so one click anywhere opens the
 * editor. The cell turns green on hover (data-cell-action, index.css).
 */
export function PurchaseCell({
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
      data-cell-action
      className={cn(
        'group block w-[calc(100%+1rem)] cursor-pointer px-2 py-3 -mx-2 -my-3 compact:-my-[9px] compact:py-[9px]',
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
    label: 'Purchase date',
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
    label: 'Purchase price',
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
 * Money columns for the Domains table. The column picker decides which of
 * these a view shows. Floor stays in the editor.
 */
export function purchaseColumns({
  purchases,
  preferredCurrency,
  numberFormat,
  onEditPurchase,
  onEditSale,
  isSold,
  listPrices,
  onEditListPrice,
}: {
  purchases: Record<string, DomainPurchase>;
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  onEditPurchase?: (domain: Domain) => void;
  onEditSale?: (domain: Domain) => void;
  isSold?: (domain: Domain) => boolean;
  /** BIN price and Min offer. */
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
          {value ? (
            <span className={EDITABLE_VALUE}>
              {formatMoney(
                value,
                p!.currency,
                preferredCurrency,
                numberFormat,
                true,
              )}
            </span>
          ) : (
            <EditableEmpty />
          )}
        </PurchaseCell>
      );
    },
    sortValue: (d) => {
      const value = listPriceOf(d)?.[field];
      return value == null ? null : Number(value);
    },
  });
  const pricing: PurchaseColumn[] =
    listPrices && onEditListPrice
      ? [
          listPriceColumn('binPrice', 'BIN price', 'amount', 'BIN price'),
          listPriceColumn('minOffer', 'Min offer', 'minOffer', 'Minimum offer'),
        ]
      : [];
  const sale: PurchaseColumn[] = [
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
  ];

  const bought: PurchaseColumn[] = [
    purchaseDateColumn(purchases, onEditPurchase),
    purchaseAmountColumn(
      purchases,
      preferredCurrency,
      numberFormat,
      onEditPurchase,
    ),
  ];

  return [...bought, ...sale, ...pricing];
}
