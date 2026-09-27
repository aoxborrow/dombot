import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTheme } from '@/components/theme-provider';

/**
 * App-wide toast host (shadcn's sonner wrapper). Mount once near the app root;
 * fire toasts from anywhere with `toast(...)` from 'sonner'. Colors key off our
 * CSS variables so it matches the current theme, and it follows the app's
 * `useTheme()` (our 'auto' maps to sonner's 'system').
 */
function Toaster({ ...props }: ToasterProps) {
  const { theme } = useTheme();
  const resolved: ToasterProps['theme'] = theme === 'auto' ? 'system' : theme;

  return (
    <Sonner
      theme={resolved}
      richColors
      closeButton
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Room on the right for the close button.
          toast: '!pr-9',
          // The close button sits inside the toast's top right, in its color.
          closeButton:
            '!left-auto !right-2 !top-2 !size-5 !transform-none !border-0 !bg-transparent !text-current opacity-60 hover:!bg-current/10 hover:opacity-100',
          // An action (Undo) is a small outlined button in the toast's own
          // color, not sonner's solid white one.
          actionButton:
            '!h-6 !rounded-md !border !border-current/35 !bg-transparent !px-2 !text-xs !font-medium !text-current hover:!bg-current/10',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
