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
      {...props}
    />
  );
}

export { Toaster };
