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
  const setRegistrarEnabled = useAppStore((s) => s.setRegistrarEnabled);
  const [values, setValues] = useState<CredentialValues>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);

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

  // Enable/disable this registrar. Disabling keeps its credentials but drops its
  // cached data and stops syncs; enabling re-syncs it. The store updates the
  // portfolio, pricing, and metadata, so every surface reflects it.
  const toggleEnabled = async (next: boolean) => {
    setToggling(true);
    try {
      await setRegistrarEnabled(meta.name, next);
    } finally {
      setToggling(false);
    }
  };

  const busy = saving || syncing || toggling;
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
                  ? `${enabled ? 'Disable' : 'Enable'} ${meta.displayName}`
                  : `${meta.displayName} — add credentials to enable`
              }
              title={
                !configured
                  ? 'Add credentials to enable this registrar'
                  : enabled
                    ? 'Disable this registrar (keeps credentials, drops its data)'
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
              {meta.displayName}
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
            {meta.configFields.map((field) => {
              const id = `${meta.name}-${field.name}`;
              const fieldHelp = help.fields[field.name];
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
                  {fieldHelp && (
                    <FieldDescription className="text-[13px]">
                      {fieldHelp.text}
                      {fieldHelp.link && (
                        <>
                          {' '}
                          <HelpLink link={fieldHelp.link} inline />
                        </>
                      )}
                    </FieldDescription>
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
 * A real external link in the help copy. `target="_blank"` hands the URL to the
 * main process's window-open handler, which opens it in the system browser and
 * denies the in-app window. `inline` drops the icon so it sits naturally at the
 * end of a field description sentence.
 */
function HelpLink({
  link,
  inline = false,
}: {
  link: HelpLinkData;
  inline?: boolean;
}) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1 underline-offset-4 hover:underline',
        inline ? 'text-inherit' : 'text-[13px] font-medium text-primary',
      )}
    >
      {link.label}
      {!inline && <ExternalLink className="size-3 shrink-0" aria-hidden />}
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
