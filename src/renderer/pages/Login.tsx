import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// The web host's login screen (password auth mode). Posts to /auth/login;
// the Worker sets an HttpOnly session cookie and the app reloads into the
// real UI. Nothing here is reachable on desktop.

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      });
      if (res.ok) {
        onSuccess();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Sign-in failed (${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border p-6"
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Dom<span style={{ color: '#7ac28d' }}>Bot</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter this instance&apos;s password to continue.
          </p>
        </div>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Forgot it? The operator can rotate it with{' '}
          <code>npm run web:rotate-password</code>.
        </p>
      </form>
    </div>
  );
}
