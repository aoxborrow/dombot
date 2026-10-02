import { useMemo, useState } from 'react';
import { toAscii } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ActionHeader } from '../actions/ActionDialog';

/** The Registrar select's value for a registrar DomBot doesn't know. */
const OTHER = '__other__';
/** …and for none at all. */
const NONE = '__none__';
/** Auto-renew's "not said" value. */
const UNKNOWN = 'unknown';

/**
 * Edit a manual name's registration fields: the registrar (one DomBot knows,
 * or free text), the registration and expiration dates, and auto-renew. A
 * manual name isn't at a connected account, so nothing here touches a
 * registrar; DomBot just keeps what you enter.
 */
export function ManualDomainDialog({
  domain,
  onClose,
}: {
  domain: Domain;
  onClose: () => void;
}) {
  const manualDomains = useAppStore((s) => s.manualDomains);
  const registrars = useAppStore((s) => s.registrars);
  const saveManualDomain = useAppStore((s) => s.saveManualDomain);
  const record = manualDomains[toAscii(domain.domainName)];

  // Every registrar DomBot supports, once each.
  const options = useMemo(() => {
    const byName = new Map<string, string>();
    for (const r of registrars ?? []) byName.set(r.name, r.displayName);
    return [...byName].sort((a, b) => a[1].localeCompare(b[1]));
  }, [registrars]);

  const [registrar, setRegistrar] = useState(
    record?.registrar ?? (record?.registrarLabel ? OTHER : NONE),
  );
  const [label, setLabel] = useState(record?.registrarLabel ?? '');
  const [created, setCreated] = useState(record?.createdDate ?? '');
  const [expires, setExpires] = useState(record?.expirationDate ?? '');
  const [autoRenew, setAutoRenew] = useState(
    record?.autoRenew == null ? UNKNOWN : record.autoRenew ? 'on' : 'off',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const known = registrar !== OTHER && registrar !== NONE;
      await saveManualDomain(domain.domainName, {
        registrar: known ? registrar : null,
        registrarLabel: registrar === OTHER ? label.trim() || null : null,
        createdDate: created || null,
        expirationDate: expires || null,
        autoRenew: autoRenew === UNKNOWN ? null : autoRenew === 'on',
      });
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not save.';
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*/, ''));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <ActionHeader title="Edit details" names={[domain.domainName]} />
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            No connected account holds this name, so DomBot keeps what you enter
            here. When an account reports it, sync takes over.
          </p>
          <div className="flex flex-col gap-2">
            <Label>Registrar</Label>
            <Select value={registrar} onValueChange={setRegistrar}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {options.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other…</SelectItem>
              </SelectContent>
            </Select>
            {registrar === OTHER && (
              <Input
                aria-label="Registrar name"
                placeholder="e.g. Epik"
                maxLength={100}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual-created">Registered</Label>
              <Input
                id="manual-created"
                type="date"
                value={created}
                onChange={(e) => setCreated(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual-expires">Expires</Label>
              <Input
                id="manual-expires"
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Auto-renew</Label>
            <Select value={autoRenew} onValueChange={setAutoRenew}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNKNOWN}>Not set</SelectItem>
                <SelectItem value="on">On</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
