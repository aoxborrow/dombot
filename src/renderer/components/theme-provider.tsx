import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'auto';

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'dombot-theme';

const ThemeProviderContext = createContext<ThemeProviderState>({
  theme: 'dark',
  setTheme: () => undefined,
});

/** Resolves 'auto' to the OS preference; passes 'dark'/'light' through. */
function resolve(theme: Theme): 'dark' | 'light' {
  if (theme !== 'auto') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function readStored(fallback: Theme): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'auto') return v;
  } catch {
    // localStorage may be unavailable; fall back to the default.
  }
  return fallback;
}

/**
 * Applies the theme by toggling the `dark`/`light` class on <html> (the class
 * our CSS variables key off). In 'auto' mode it follows the OS and updates live
 * when the system preference changes.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readStored(defaultTheme),
  );

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const mode = resolve(theme);
      root.classList.remove('light', 'dark');
      root.classList.add(mode);
    };
    apply();

    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = (next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the in-memory state still updates.
    }
    setThemeState(next);
  };

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeProviderContext);
}
