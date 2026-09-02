import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, CircleX, RefreshCw } from 'lucide-react';
import type { CredentialValues, RegistrarMeta } from '../../../shared/ipc';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../store/app';
import { timeAgo } from '../../lib/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function RegistrarsSettings() {
  const registrars = useAppStore((s) => s.registrars);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);

  // Shared store metadata is the source of truth (so the status bar and Domains
  // agree); load it once and let store actions (save/sync) keep it fresh.
  useEffect(() => {
    void loadRegistrars();
  }, [loadRegistrars]);

  const sorted = useMemo(
    () =>
      (registrars ?? [])
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [registrars],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Registrars</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Store API credentials for each registrar. They&apos;re encrypted on
          this device and used by both the app and the MCP server. Saving syncs
          that registrar&apos;s domains automatically.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {sorted.map((r) => (
          <RegistrarCard key={r.name} meta={r} />
        ))}
      </div>
    </div>
  );
}

function RegistrarCard({ meta }: { meta: RegistrarMeta }) {
  const syncRegistrar = useAppStore((s) => s.syncRegistrar);
  const [values, setValues] = useState<CredentialValues>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (open) {
      void window.api.getRegistrarCredentials(meta.name).then(setValues);
    }
  }, [open, meta.name]);

  // Sync this registrar's domains. `syncRegistrar` updates the shared store
  // (portfolio + metadata), so this card's header status, the status bar, and
  // the Domains page all reflect the result on their own.
  const runSync = async () => {
    setSyncing(true);
    try {
      await syncRegistrar(meta.name);
    } finally {
      setSyncing(false);
    }
  };

  // Save credentials, then immediately sync so the domains appear without a
  // separate step (and against the values just entered, not stale saved ones).
  const save = async () => {
    setSaving(true);
    try {
      await window.api.saveRegistrarCredentials(meta.name, values);
      await runSync();
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || syncing;
  const { configured, sync } = meta;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Header row: the name + sync status expand the card; the Sync button
            sits outside the triggers so it works even while collapsed. */}
        <div className="flex items-center gap-3 px-5 py-4">
          <CollapsibleTrigger className="flex flex-1 items-center gap-[18px] text-left">
            <span className="font-medium">{meta.displayName}</span>
            <SyncStatus meta={meta} syncing={syncing} />
          </CollapsibleTrigger>
          {configured && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runSync()}
              disabled={busy}
              title="Sync this registrar’s domains now"
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn(syncing && 'animate-spin')} />
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
          )}
          <CollapsibleTrigger
            className="shrink-0"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="border-t px-5 py-4">
          {meta.helpText && (
            <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
              {meta.helpText}
            </p>
          )}

          <FieldGroup className="gap-4">
            {meta.configFields.map((field) => {
              const id = `${meta.name}-${field.name}`;
              return (
                <Field key={field.name} className="gap-1.5">
                  <FieldLabel htmlFor={id}>
                    {field.label}
                    {field.required && (
                      <span className="text-destructive"> *</span>
                    )}
                  </FieldLabel>
                  {field.type === 'select' ? (
                    <Select
                      value={values[field.name] ?? ''}
                      onValueChange={(v) =>
                        setValues((prev) => ({ ...prev, [field.name]: v }))
                      }
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {field.options?.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={id}
                      value={values[field.name] ?? ''}
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                  )}
                </Field>
              );
            })}
          </FieldGroup>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void save()} disabled={busy}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {configured && !syncing && sync.lastError && (
              <span className="ml-auto flex items-center gap-1.5 text-sm text-destructive">
                <CircleX className="size-4" />
                {sync.lastError}
              </span>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * The registrar's sync state, shown in the card header:
 *  - not configured → "Not set" badge
 *  - configured + last sync ok → green "Last synced <ago> · N domains"
 *  - configured + last sync errored → amber "Sync failed" (error in tooltip)
 *  - configured + never synced → amber "Not synced yet"
 *  - a sync in flight → muted "Syncing…"
 */
function SyncStatus({
  meta,
  syncing,
}: {
  meta: RegistrarMeta;
  syncing: boolean;
}) {
  if (syncing) {
    return <span className="text-sm text-muted-foreground">Syncing…</span>;
  }
  if (!meta.configured) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Not set
      </Badge>
    );
  }

  const { lastSyncedAt, lastError, domainCount } = meta.sync;
  if (lastError) {
    return (
      <span className="flex items-center gap-1.5" title={lastError}>
        <span className="size-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
          Sync failed
        </span>
      </span>
    );
  }
  if (lastSyncedAt == null) {
    // Configured but never synced — pending, not a problem, so keep it neutral
    // (amber is reserved for actual sync failures).
    return (
      <span className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
        <span className="text-[13px] font-medium text-muted-foreground">
          Not synced yet
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 shrink-0 rounded-full bg-[#31613b] dark:bg-[#7ac28d]" />
      <span className="text-[13px] font-medium text-[#31613b] dark:text-[#7ac28d]">
        Last synced {timeAgo(lastSyncedAt)}
      </span>
      <span className="text-xs text-muted-foreground">
        · {domainCount} domain{domainCount === 1 ? '' : 's'}
      </span>
    </span>
  );
}
