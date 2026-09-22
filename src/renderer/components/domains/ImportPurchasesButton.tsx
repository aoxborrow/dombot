import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { parsePurchaseCsv } from '../../../shared/purchase-csv';
import { DEFAULT_CURRENCY } from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';

/**
 * Import a CSV of purchase fields. Columns match Domains → Export. Rows with
 * every purchase cell blank are skipped.
 */
export function ImportPurchasesButton({
  onResult,
}: {
  onResult: (text: string, error: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importPurchases = useAppStore((s) => s.importPurchases);
  const preferred = useAppStore(
    (s) => s.settings?.preferredCurrency ?? DEFAULT_CURRENCY,
  );

  async function onFile(file: File) {
    try {
      const parsed = parsePurchaseCsv(await file.text(), preferred);
      const saved =
        parsed.rows.length > 0 ? await importPurchases(parsed.rows) : null;
      const errors = [...parsed.errors, ...(saved?.errors ?? [])];
      const updated = saved?.updated ?? 0;
      const parts = [
        `Updated ${updated} purchase record${updated === 1 ? '' : 's'}.`,
      ];
      if (parsed.skipped > 0) {
        parts.push(
          `Skipped ${parsed.skipped} blank row${parsed.skipped === 1 ? '' : 's'}.`,
        );
      }
      if (errors.length > 0) parts.push(errors.slice(0, 3).join(' '));
      onResult(parts.join(' '), errors.length > 0);
    } catch (err) {
      onResult(err instanceof Error ? err.message : 'Import failed', true);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        title="CSV columns: Domain, Purchase date, Purchase amount, Currency, Notes"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" />
        Import purchases
      </Button>
    </>
  );
}
