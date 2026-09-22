import type { ReactNode } from 'react';
import type { Domain, DomainPurchase } from '../../../shared/ipc';
import {
  formatMoney,
  purchaseKey,
  type NumberFormatId,
} from '../../../shared/money';
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
  return purchases[purchaseKey(domain.domainName)];
}

function preview(notes: string): string {
  const line = notes.split(/\r?\n/)[0]?.trim() ?? '';
  if (line.length <= 40) return line;
  return `${line.slice(0, 40)}…`;
}

/** Fills the cell, including its padding, so one click anywhere opens the editor. */
function PurchaseCell({
  domain,
  onEdit,
  align = 'left',
  title,
  empty = false,
  children,
}: {
  domain: Domain;
  onEdit: (domain: Domain) => void;
  align?: 'left' | 'right';
  title?: string;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={
        empty ? `Purchase details for ${domain.domainName}` : undefined
      }
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

/** Purchase date, amount, and notes columns for the Domains table. */
export function purchaseColumns({
  purchases,
  preferredCurrency,
  numberFormat,
  onEdit,
}: {
  purchases: Record<string, DomainPurchase>;
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  onEdit: (domain: Domain) => void;
}): PurchaseColumn[] {
  return [
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
    {
      key: 'purchaseNotes',
      label: 'Notes',
      hideOnMobile: true,
      render: (d) => {
        const notes = recordOf(purchases, d)?.notes ?? '';
        return (
          <PurchaseCell
            domain={d}
            onEdit={onEdit}
            title={notes || undefined}
            empty={!notes}
          >
            {notes ? preview(notes) : '—'}
          </PurchaseCell>
        );
      },
      sortValue: (d) => recordOf(purchases, d)?.notes?.toLowerCase() || null,
    },
  ];
}
