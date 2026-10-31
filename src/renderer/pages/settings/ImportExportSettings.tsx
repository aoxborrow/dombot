import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import {
  MAX_BUNDLE_BYTES,
  isSealedBundle,
  openBundle,
  sealBundle,
} from '../../../shared/bundle-seal';
import { domainsCsvTemplate } from '../../../shared/domain-csv';
import { isDemo } from '../../lib/platform';
import { exportAllDomains } from '../../lib/domain-export';
import { ImportDomainsDialog } from '../../components/domains/ImportDomainsDialog';
import { SettingsCard, SettingsField } from './SettingsCard';

/**
 * Getting data in and out of DomBot: your domains as a spreadsheet, and a
 * backup of everything it stores.
 */
export default function ImportExportSettings() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">Import/Export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring domains in from a spreadsheet or export them, and back up
          everything DomBot stores to keep a copy or move to another DomBot.
        </p>
      </div>
      <SpreadsheetCard />
      <BackupCard />
    </div>
  );
}

/**
 * Your domains as a spreadsheet: import names (with what you paid, sold for,
 * and are asking) from any CSV, export them all as a DomBot CSV, or start
 * from the template (docs/domain-import-export.md).
 */
function SpreadsheetCard() {
  const [importing, setImporting] = useState(false);

  async function onExport() {
    try {
      const n = await exportAllDomains();
      if (n !== null) toast.success(`Exported ${n} name${n === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onTemplate() {
    try {
      const result = await window.api.saveTextFile(
        domainsCsvTemplate(),
        'dombot-domains-template.csv',
      );
      if (result.saved) toast.success('Template downloaded');
    } catch (err) {
      toast.error('Download failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <SettingsCard title="Spreadsheet" contentClassName="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Import domains from a CSV: a DomBot export, a registrar or marketplace
        export, or your own list. You match the columns and review every change
        before anything is saved, and names already here are only added to.
        Export writes every name, Owned and Archive, one per row, in a file
        DomBot can import again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="gap-2" onClick={() => setImporting(true)}>
          <Upload className="size-4" />
          Import domains…
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => void onExport()}
        >
          <Download className="size-4" />
          Export all domains
        </Button>
        <Button variant="ghost" onClick={() => void onTemplate()}>
          Download template
        </Button>
      </div>
      {importing && <ImportDomainsDialog onClose={() => setImporting(false)} />}
    </SettingsCard>
  );
}

/**
 * A backup of everything DomBot stores, and the way back: one card, since
 * the file Export writes is the file Restore reads.
 */
function BackupCard() {
  return (
    <SettingsCard title="Backup" contentClassName="flex flex-col gap-5">
      <ExportSection />
      <RestoreSection />
    </SettingsCard>
  );
}

/**
 * The whole store as one JSON file. Optionally sealed with a passphrase,
 * since the file holds registrar and market API keys.
 */
function ExportSection() {
  const [exportPass, setExportPass] = useState('');
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      let text = await window.api.exportData();
      if (exportPass) text = await sealBundle(text, exportPass);
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await window.api.saveTextFile(
        text,
        `dombot-data-${stamp}.json`,
      );
      if (result.saved) toast.success('Data exported');
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Export</h3>
      <p className="text-sm text-muted-foreground">
        Export everything — registrar and market keys, portfolio, imported
        domains, folders, prices, BIN prices, history, settings, and MCP
        pairings — as one JSON file. Use it as a backup or to move to another
        DomBot. Leave the passphrase blank and anyone who opens the file can
        read your API keys. Type one and the file is locked: Restore asks for
        that same passphrase, and DomBot does not keep a copy. If you forget it,
        the backup cannot be opened.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SettingsField
          label="Passphrase (optional)"
          htmlFor="export-pass"
          className="w-56"
        >
          <PasswordInput
            id="export-pass"
            revealLabel="export passphrase"
            autoComplete="new-password"
            value={exportPass}
            onChange={(e) => setExportPass(e.target.value)}
          />
        </SettingsField>
        <Button onClick={() => void onExport()} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export data'}
        </Button>
      </div>
    </section>
  );
}

/** Restore a backup, which replaces the store. */
function RestoreSection() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{
    name: string;
    text: string;
    sealed: boolean;
  } | null>(null);
  const [importPass, setImportPass] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) {
      toast.error('Data file is too large (maximum 32 MiB).');
      return;
    }
    const text = await file.text();
    setImportPass('');
    setImportError(null);
    setPending({ name: file.name, text, sealed: isSealedBundle(text) });
  };

  const onImport = async () => {
    if (!pending) return;
    setImporting(true);
    setImportError(null);
    try {
      const text = pending.sealed
        ? await openBundle(pending.text, importPass)
        : pending.text;
      const { namespaces, entries } = await window.api.importData(text);
      toast.success(
        `Restored ${entries} item${entries === 1 ? '' : 's'} across ${namespaces} section${namespaces === 1 ? '' : 's'}`,
      );
      setPending(null);
      // Every screen holds derived state; a reload is the honest refresh.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-medium">Restore</h3>
      <p className="text-sm text-muted-foreground">
        Restore replaces everything stored here with a backup file. It does not
        contact your registrars or markets. The next Sync does. Names in the
        file that an account no longer has will leave the list then, and names
        an account has that the file does not will appear. Purchase records are
        kept either way, including for names that are not in the list.
      </p>
      <div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button
          variant="outline"
          disabled={isDemo()}
          onClick={() => fileInput.current?.click()}
        >
          Restore from file…
        </Button>
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace all data?</DialogTitle>
            <DialogDescription>
              Everything currently stored — registrar and market keys,
              portfolio, folders, prices, settings, MCP pairings — will be
              replaced with the contents of{' '}
              <span className="font-mono">{pending?.name}</span>. This
              can&apos;t be undone; export first if you want a copy.
            </DialogDescription>
          </DialogHeader>
          {pending?.sealed && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-pass">Passphrase</Label>
              <PasswordInput
                id="import-pass"
                revealLabel="import passphrase"
                autoComplete="off"
                value={importPass}
                onChange={(e) => setImportPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void onImport()}
              />
            </div>
          )}
          {importError && (
            <p className="text-sm text-destructive">{importError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onImport()}
              disabled={importing || (pending?.sealed && !importPass)}
            >
              {importing ? 'Restoring…' : 'Replace and restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
