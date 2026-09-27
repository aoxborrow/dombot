import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';

/**
 * One line naming the accounts whose last sync failed, with a link at the
 * end. The errors themselves are on each account's card in Settings →
 * Registrars.
 */
export function SyncErrorsAlert({
  label,
  names,
  action,
}: {
  /** e.g. "Registrars failed to sync". */
  label: string;
  names: string[];
  action?: ReactNode;
}) {
  return (
    <Alert variant="error" className="py-2.5">
      <CircleAlert />
      <p className="col-start-2">
        <span className="font-medium">{label}:</span> {names.join(', ')}
        {action && (
          <>
            <span className="text-muted-foreground"> · </span>
            {action}
          </>
        )}
      </p>
    </Alert>
  );
}
