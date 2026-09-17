import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * A password field with an inline show/hide toggle pinned to its right edge,
 * so people can reveal what they typed (an API key, a passphrase). Forwards
 * every `Input` prop; `type` is managed here. The toggle stays usable while the
 * input is `disabled` (revealing a stored value is read-only), but hides itself
 * when the field is empty so there's nothing to peek at.
 */
function PasswordInput({
  className,
  value,
  disabled,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = React.useState(false);
  const hasValue = value != null && String(value).length > 0;

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        // Room for the toggle so long values don't slide under it.
        className={cn('pr-9', className)}
        {...props}
      />
      {hasValue && (
        <button
          type="button"
          // Not a tab stop: it's a convenience, and keeping it out of the tab
          // order means Tab moves straight from the field to the next control.
          tabIndex={-1}
          aria-label={visible ? 'Hide value' : 'Show value'}
          title={visible ? 'Hide' : 'Show'}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          {visible ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </button>
      )}
    </div>
  );
}

export { PasswordInput };
