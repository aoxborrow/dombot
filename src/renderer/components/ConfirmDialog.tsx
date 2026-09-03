import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * A modal confirmation with a consistent shape: title, description, the
 * caller's content, an optional type-to-confirm word, and a Cancel + action
 * footer. The shared modal for anything that needs more than a popover —
 * renewals (money), and later the bulk-action dialog's confirm stage.
 *
 * Always rendered open; the parent unmounts it via `onClose`. While `busy`
 * the dialog can't be dismissed and the action shows `busyLabel`.
 */
export function ConfirmDialog({
  title,
  description,
  children,
  actionLabel,
  busyLabel,
  busy = false,
  disabled = false,
  destructive = false,
  typeToConfirm,
  onConfirm,
  onClose,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actionLabel: string;
  /** Action label while `busy` (defaults to `actionLabel`). */
  busyLabel?: string;
  busy?: boolean;
  /** Extra gate on the action, beyond `typeToConfirm` and `busy`. */
  disabled?: boolean;
  destructive?: boolean;
  /** Require typing this word (case-insensitive) before the action enables. */
  typeToConfirm?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const typedOk =
    !typeToConfirm ||
    typed.trim().toUpperCase() === typeToConfirm.toUpperCase();
  const canConfirm = typedOk && !busy && !disabled;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {(children || typeToConfirm) && (
          <div className="flex flex-col gap-4">
            {children}
            {typeToConfirm && (
              <Field>
                <FieldLabel htmlFor={inputId}>
                  Type <span className="font-mono">{typeToConfirm}</span> to
                  confirm
                </FieldLabel>
                <Input
                  id={inputId}
                  value={typed}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canConfirm) onConfirm();
                  }}
                  className="w-40 font-mono uppercase"
                />
              </Field>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy ? (busyLabel ?? actionLabel) : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
