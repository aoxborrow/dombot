import { Fragment, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';

/**
 * One line naming the accounts whose last sync failed, with room for a link.
 * The errors themselves live on each account's card in Settings → Registrars.
 */
export function SyncErrorsAlert({
  names,
  detail,
  action,
}: {
  /** Account names, already formatted (plain text or links). */
  names: { key: string; node: ReactNode }[];
  detail: string;
  action?: ReactNode;
}) {
  const parts = new Intl.ListFormat(undefined, {
    type: 'conjunction',
  }).formatToParts(names.map((n) => n.key));
  let i = 0;
  return (
    <Alert variant="error" className="py-2.5">
      <CircleAlert />
      <div className="col-start-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p>
          <span className="font-medium">
            {parts.map((p, n) =>
              p.type === 'element' ? (
                <Fragment key={n}>{names[i++].node}</Fragment>
              ) : (
                <Fragment key={n}>{p.value}</Fragment>
              ),
            )}{' '}
            failed to sync.
          </span>{' '}
          <span className="text-foreground/80">{detail}</span>
        </p>
        {action}
      </div>
    </Alert>
  );
}
