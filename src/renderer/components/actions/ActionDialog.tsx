import { useState, type ReactNode } from 'react';
import { localDay } from '../../../shared/domain-events';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// The one layout for single and bulk actions (docs/activity-redesign.md,
// "Action dialogs"): the title names the action, the line under it says what
// it applies to, then the form, then Cancel and the action.

const NAMES_SHOWN = 3;

/** "example.com", or "12 domains: a.com, b.com, c.com, and 9 more". */
export function TargetSummary({ names }: { names: string[] }) {
  if (names.length === 1) {
    return <span className="font-mono text-foreground">{names[0]}</span>;
  }
  const shown = names.slice(0, NAMES_SHOWN);
  const more = names.length - shown.length;
  return (
    <>
      <span className="font-medium text-foreground">
        {names.length} domains:
      </span>{' '}
      <span className="font-mono">{shown.join(', ')}</span>
      {more > 0 && `, and ${more} more`}
    </>
  );
}

/** The action dialogs' header: what you're doing, and to what. */
export function ActionHeader({
  title,
  names,
}: {
  title: string;
  names: string[];
}) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>
        <TargetSummary names={names} />
      </DialogDescription>
    </DialogHeader>
  );
}

/** A date input for an action, starting at today. */
export function DateField({
  id,
  label = 'Date',
  value,
  onChange,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Today as a date input's value. */
export const todayInput = () => localDay();

/**
 * A confirm-style action: header, an explanation, optional fields, and the
 * action button. `onConfirm` runs with the button disabled; if it throws, the
 * message shows and the dialog stays open.
 */
export function ActionDialog({
  title,
  names,
  description,
  children,
  actionLabel,
  destructive = false,
  disabled = false,
  onConfirm,
  onClose,
}: {
  title: string;
  names: string[];
  description?: ReactNode;
  children?: ReactNode;
  actionLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'Something went wrong.').replace(
          /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
          '',
        ),
      );
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <ActionHeader title={title} names={names} />
        {(description || children || error) && (
          <div className="flex flex-col gap-4">
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            {children}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending || disabled}
            onClick={() => void confirm()}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
