import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * An in-place "are you sure?" anchored to whatever triggers it — the shared
 * confirmation for cell-level actions (unlock, privacy, and any future cell
 * that changes something at the registrar). Owns its open state: opens on the
 * trigger's click, closes on Cancel, outside click, or confirm.
 *
 * `children` is the trigger and must accept a ref (a plain button is fine).
 */
export function ConfirmPopover({
  title,
  body,
  actionLabel,
  destructive = false,
  disabled = false,
  onConfirm,
  children,
}: {
  title: ReactNode;
  body?: ReactNode;
  /** The action button's label, e.g. "Unlock". */
  actionLabel: string;
  /** Style the action as destructive (red). */
  destructive?: boolean;
  /** Keep the popover closed (the trigger is disabled anyway). */
  disabled?: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-3">
        <p className="text-sm font-medium">{title}</p>
        {body && <p className="mt-1 text-xs text-muted-foreground">{body}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {actionLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
