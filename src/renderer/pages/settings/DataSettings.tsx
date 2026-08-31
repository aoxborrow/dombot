import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppStore } from '../../store/app';

/**
 * Data & cache settings. dombot caches your portfolio, per-domain detail,
 * aftermarket, and renewal prices on disk (timestamped) so the app opens fully
 * populated with no network calls. Clearing forces the next load to re-fetch.
 */
export default function DataSettings() {
  const clearAllCaches = useAppStore((s) => s.clearAllCaches);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  const onClear = async () => {
    setClearing(true);
    setCleared(false);
    try {
      await clearAllCaches();
      setCleared(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Data</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          dombot caches your portfolio, domain detail, marketplace listings, and
          renewal prices on disk so it opens instantly. Data older than 14 days
          is flagged as stale; refresh any time from the Domains or Renewals
          page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Cached data
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Clear every on-disk cache and reset the loaded portfolio. Your saved
            registrar credentials, manual prices, and folders are kept. The next
            “Load domains” re-fetches everything fresh.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => void onClear()}
              disabled={clearing}
            >
              {clearing ? 'Clearing…' : 'Clear cache'}
            </Button>
            {cleared && (
              <span className="text-sm text-muted-foreground">
                Cache cleared.
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
