import { toast } from 'sonner';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, CircleX, ExternalLink, RefreshCw } from 'lucide-react';
import type {
  CredentialValues,
  RegistrarMeta,
  RegistrarName,
} from '../../../shared/ipc';
import {
  REGISTRAR_HELP,
  type HelpLink as HelpLinkData,
} from '../../../shared/registrar-help';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../store/app';
import { timeAgo } from '../../lib/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
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
  const [adding, setAdding] = useState<RegistrarName | null>(null);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const add = async (name: RegistrarName) => {
    setCreating(true);
    try {
      await window.api.createRegistrarAccount(name, label);
      await loadRegistrars();
      setAdding(null);
      setLabel('');
    } catch (err) {
      toast.error(String(err));
    } finally {
      setCreating(false);
    }
  };

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
          Add named accounts for each registrar. Credentials are encrypted at
          rest and shared by the app and MCP. Saving syncs only that account.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {(Object.keys(REGISTRAR_HELP) as RegistrarName[]).sort().map((name) => (
          <section key={name} className="flex flex-col gap-3" aria-label={name}>
            {sorted
              .filter((r) => r.name === name)
              .map((r) => (
                <RegistrarCard key={r.accountId ?? r.name} meta={r} />
              ))}
            {adding === name ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add(name);
                }}
              >
                <Input
                  aria-label="New account label"
                  placeholder="Personal or Company"
                  value={label}
                  maxLength={100}
                  onChange={(e) => setLabel(e.target.value)}
                  autoFocus
                />
                <Button disabled={creating || !label.trim()} type="submit">
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAdding(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <Button
                variant="outline"
                className="self-start"
                onClick={() => {
                  setAdding(name);
                  setLabel('');
                }}
              >
                Add account to{' '}
                {sorted.find((r) => r.name === name)?.displayName ?? name}
              </Button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function RegistrarCard({ meta }: { meta: RegistrarMeta }) {
  const syncRegistrar = useAppStore((s) => s.syncRegistrar);
  const setRegistrarEnabled = useAppStore((s) => s.setRegistrarEnabled);
  const [label, setLabel] = useState(meta.accountLabel ?? 'Default');
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const refreshCache = useAppStore((s) => s.applyPortfolioCacheUpdate);
  const [values, setValues] = useState<CredentialValues>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (open) {
      void window.api
        .getRegistrarCredentials(meta.name, meta.accountId)
        .then(setValues)
        .catch((err) => toast.error(String(err)));
    }
  }, [open, meta.name, meta.accountId]);

  // Sync this registrar's domains. `syncRegistrar` updates the shared store
  // (portfolio + metadata), so this card's header status, the status bar, and
  // the Domains page all reflect the result on their own.
  const runSync = async () => {
    setSyncing(true);
    try {
      await syncRegistrar(meta.name, meta.accountId);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSyncing(false);
    }
  };

  // Save credentials, then immediately sync so the domains appear without a
  // separate step (and against the values just entered, not stale saved ones).
  const save = async () => {
    setSaving(true);
    try {
      const stored = await window.api.getRegistrarCredentials(
        meta.name,
        meta.accountId,
      );
      const clean = Object.fromEntries(
        Object.entries(values)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value),
      );
      const changed = Object.keys({ ...stored, ...clean }).some(
        (key) => stored[key] !== clean[key],
      );
      if (changed)
        await window.api.saveRegistrarCredentials(
          meta.name,
          clean,
          meta.accountId,
        );
      setValues(clean);
      await window.api.renameRegistrarAccount(
        meta.accountId ?? meta.name,
        label,
      );
      if (changed) await runSync();
      else {
        await loadRegistrars();
        await refreshCache();
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  // Enable/disable this registrar. Disabling keeps its credentials and
  // cached data and stops syncs; enabling re-syncs it. The store updates the
  // portfolio, pricing, and metadata, so every surface reflects it.
  const toggleEnabled = async (next: boolean) => {
    setToggling(true);
    try {
      await setRegistrarEnabled(meta.name, next, meta.accountId);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setToggling(false);
    }
  };

  const busy = saving || syncing || toggling || testing;
  const { configured, enabled, sync } = meta;
  const help = REGISTRAR_HELP[meta.name];

  return (
    <Card className="gap-0 overflow-hidden rounded-md py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Header row: the name + sync status expand the card; the Sync button
            sits outside the triggers so it works even while collapsed. */}
        <div className="flex items-center gap-3 px-5 py-[13px]">
          {/* Enable/disable toggle, kept to the far left and outside the expand
              triggers so it reads as a row-level on/off (not a sync switch) and
              isn't hit when expanding the card. Always shown so every logo lines
              up; read-only (off) until the registrar has credentials. */}
          <div className="flex w-9 shrink-0 justify-center">
            <Switch
              checked={configured && enabled}
              onCheckedChange={(v) => void toggleEnabled(v)}
              disabled={busy || !configured}
              aria-label={
                configured
                  ? `${enabled ? 'Disable' : 'Enable'} ${meta.displayName} · ${meta.accountLabel ?? 'Default'}`
                  : `${meta.displayName} — add credentials to enable`
              }
              title={
                !configured
                  ? 'Add credentials to enable this registrar'
                  : enabled
                    ? 'Disable this account (keeps credentials and cached data)'
                    : 'Enable and sync this registrar'
              }
            />
          </div>
          <CollapsibleTrigger className="flex flex-1 items-center gap-[18px] text-left">
            <span
              className={cn(
                'flex items-center gap-2.5 font-medium',
                // Dim the name for a configured-but-disabled registrar so the
                // off state reads at a glance.
                configured && !enabled && 'opacity-50',
              )}
            >
              <RegistrarLogo name={meta.name} label={meta.displayName} />
              {meta.displayName} · {meta.accountLabel ?? 'Default'}
            </span>
            <SyncStatus meta={meta} syncing={syncing} />
          </CollapsibleTrigger>
          {/* Sync only makes sense for an enabled registrar. */}
          {configured && enabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runSync()}
              disabled={busy}
              title="Sync this registrar’s domains now"
              // Absorb the button's height into the row's vertical padding so a
              // configured row (which shows this button) stays the same slim
              // height as an unconfigured one, rather than growing to fit it.
              className="-my-1 text-muted-foreground hover:text-foreground"
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
          {/* Where the credentials come from, with real links to the pages
              (opened in the system browser via the window-open handler). */}
          <div className="mb-4 flex flex-col gap-2">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {help.summary}
            </p>
            {help.links.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {help.links.map((link) => (
                  <HelpLink key={link.url} link={link} />
                ))}
              </div>
            )}
          </div>

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`${meta.accountId}-label`}>
                Account label
              </FieldLabel>
              <Input
                id={`${meta.accountId}-label`}
                value={label}
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            {meta.configFields.map((field) => {
              const id = `${meta.accountId ?? meta.name}-${field.name}`;
              const fieldHelp = help.fields[field.name];
              return (
                <Field key={field.name} className="gap-1.5">
                  <FieldLabel htmlFor={id}>
                    {field.label}
                    {field.required && (
                      <span className="text-destructive"> *</span>
                    )}
                  </FieldLabel>
                  {/* Only fields that need disambiguating carry a description;
                      it sits under the label, ahead of the input. */}
                  {fieldHelp && (
                    <FieldDescription className="text-[13px]">
                      {fieldHelp}
                    </FieldDescription>
                  )}
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
                      type={field.type === 'password' ? 'password' : 'text'}
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
            <Button
              onClick={() => void save()}
              disabled={busy || !label.trim()}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {configured && enabled && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setTesting(true);
                  try {
                    const result = await window.api.testRegistrarAccount(
                      meta.name,
                      meta.accountId,
                    );
                    if (result.success) toast.success('Connection successful');
                    else toast.error(result.message ?? 'Connection failed');
                  } catch (err) {
                    toast.error(String(err));
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setRemoving(!removing)}
            >
              Remove account
            </Button>
            {configured && !syncing && sync.lastError && (
              <span className="ml-auto flex items-center gap-1.5 text-sm text-destructive">
                <CircleX className="size-4" />
                {sync.lastError}
              </span>
            )}
          </div>
          {removing && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span>Remove this account’s credentials and cached domains?</span>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await window.api.removeRegistrarAccount(
                      meta.accountId ?? meta.name,
                    );
                    await loadRegistrars();
                    await refreshCache();
                  } catch (err) {
                    toast.error(String(err));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Remove
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(false)}>
                Cancel
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * A real external link in the help copy. `target="_blank"` hands the URL to the
 * main process's window-open handler, which opens it in the system browser and
 * denies the in-app window.
 */
function HelpLink({ link }: { link: HelpLinkData }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
    >
      {link.label}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

// Brand SVGs live with the marketing site (site/src/assets/logos); share that
// one folder so adding a registrar is just dropping in `<name>.svg` — the glob
// picks it up here, no import to edit. Keyed by filename, which matches the
// RegistrarName (e.g. godaddy.svg → "godaddy").
const LOGO_RAW = import.meta.glob('../../../../site/src/assets/logos/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_RAW).map(([path, svg]) => [
    path
      .split('/')
      .pop()!
      .replace(/\.svg$/, ''),
    svg,
  ]),
);

/**
 * Strip the brand fills so the logo renders as a flat monochrome mark that
 * inherits `currentColor` — letting a `text-*` class tint it a uniform grey.
 * Drops width/height too so the size comes from CSS.
 */
function monochrome(svg: string): string {
  return (
    svg
      // Drop the XML prolog and comments some exports carry (e.g. dynadot).
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // Drop <style> blocks (e.g. dynadot colors its paths via a `.st0` class).
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\s(?:width|height|fill)="[^"]*"/g, '')
      // Neutralize any inline `fill:#…` left in style attributes.
      .replace(/fill:\s*#[0-9a-fA-F]{3,8}/g, 'fill:currentColor')
      .replace('<svg', '<svg fill="currentColor"')
      .trim()
  );
}

/**
 * The registrar's logo, shown as a small grey mark before the name. Reuses the
 * marketing site's brand SVGs, flattened to `currentColor` for a uniform tint.
 */
function RegistrarLogo({
  name,
  label,
}: {
  name: RegistrarName;
  label: string;
}) {
  const svg = LOGOS[name];
  if (!svg) return null;
  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className="inline-flex size-[27px] shrink-0 items-center justify-center text-muted-foreground/70 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: monochrome(svg) }}
    />
  );
}

/**
 * The registrar's sync state, shown in the card header:
 *  - not configured → "Not set" badge
 *  - configured but disabled → "Disabled" badge
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
  if (!meta.enabled) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Disabled
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
