import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import Login from './pages/Login';
import { ThemeProvider } from '@/components/theme-provider';
import { createHttpApi, setSessionActive } from './api/http';
import { markWeb, type AuthMode } from './lib/platform';
import './index.css';

// HashRouter is used because the packaged app loads over the file:// protocol,
// where BrowserRouter's history paths do not resolve.
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

const root = createRoot(container);

function render(node: React.ReactNode) {
  root.render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="dark">{node}</ThemeProvider>
    </React.StrictMode>,
  );
}

const app = (
  <HashRouter>
    <App />
  </HashRouter>
);

// On desktop the preload script has already put `window.api` in place. In a
// browser (the self-hosted web build) there is none, so install the HTTP
// implementation and, in password mode, show the login screen until the
// session cookie is in place. See src/renderer/api/http.ts.
if (window.api) {
  render(app);
} else {
  window.api = createHttpApi();
  void (async () => {
    const status = (await fetch('/auth/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .catch(() => ({ mode: 'password', authenticated: false }))) as {
      mode: AuthMode;
      authenticated: boolean;
    };
    markWeb(status.mode);
    const start = () => {
      setSessionActive(true);
      render(app);
    };
    if (status.authenticated) start();
    else render(<Login onSuccess={start} />);
  })();
}
