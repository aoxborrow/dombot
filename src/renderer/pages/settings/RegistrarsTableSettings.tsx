import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, RotateCw } from 'lucide-react';
import type {
  CredentialValues,
  RegistrarMeta,
  RegistrarName,
  TestResult,
} from '../../../shared/ipc';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

/**
 * A status-grouped variant of the Registrars settings page (imported from a
 * Claude Design mock). Instead of a stack of collapsible cards, registrars are
 * shown as a dense table split into Needs attention / Connected / Not
 * configured, each row carrying an enable toggle, a status dot, an in-row Test
 * button, and an expand-in-place credential editor.
 *
 * The current card-based page lives alongside this one — both are reachable
 * from the Settings sidebar.
 */

/** Derived connection state for a registrar row. */
type RowStatus = 'connected' | 'error' | 'unconfigured';

/** Shared 5-column grid so header and rows line up exactly. */
const ROW_GRID = 'grid-cols-[36px_1.05fr_1.5fr_88px_150px]';

const STATUS_META: Record<
  RowStatus,
  { label: string; dot: string; fg: string }
> = {
  connected: {
    label: 'Connected',
    dot: 'bg-emerald-500',
    fg: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    label: 'Auth error',
    dot: 'bg-destructive',
    fg: 'text-destructive',
  },
  unconfigured: {
    label: 'Not configured',
    dot: 'bg-muted-foreground/60',
    fg: 'text-muted-foreground',
  },
};

export default function RegistrarsTableSettings() {
  const [registrars, setRegistrars] = useState<RegistrarMeta[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Session-only test outcomes, keyed by registrar name. A failing test moves a
  // registrar into "Needs attention" for the rest of the session.
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  // Enable/disable is presentational for now — there's no backend to persist it,
  // so it lives in memory and defaults to "on" for configured registrars.
  const [enabledOverride, setEnabledOverride] = useState<
    Record<string, boolean>
  >({});

  const load = async () => {
    const metas = await window.api.getRegistrarMetadata();
    metas.sort((a, b) => a.displayName.localeCompare(b.displayName));
    setRegistrars(metas);
  };

  useEffect(() => {
    void load();
  }, []);

  const statusOf = (meta: RegistrarMeta): RowStatus => {
    if (!meta.configured) return 'unconfigured';
    if (tests[meta.name] && !tests[meta.name].ok) return 'error';
    return 'connected';
  };

  const enabledOf = (meta: RegistrarMeta) =>
    meta.name in enabledOverride
      ? enabledOverride[meta.name]
      : meta.configured;

  const groups = useMemo(() => {
    const g: Record<RowStatus, RegistrarMeta[]> = {
      error: [],
      connected: [],
      unconfigured: [],
    };
    for (const meta of registrars) g[statusOf(meta)].push(meta);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrars, tests]);

  const runTest = async (name: RegistrarName) => {
    setTestingId(name);
    try {
      const result = await window.api.testRegistrar(name);
      setTests((prev) => ({ ...prev, [name]: result }));
    } finally {
      setTestingId(null);
    }
  };

  const sections: { key: RowStatus; label: string; accent: string }[] = [
    { key: 'error', label: 'Needs attention', accent: 'text-destructive' },
    {
      key: 'connected',
      label: 'Connected',
      accent: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      key: 'unconfigured',
      label: 'Not configured',
      accent: 'text-muted-foreground',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Registrars</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          API credentials for each registrar, encrypted on this device and
          shared with the MCP server.
        </p>
      </div>

      <div>
        {sections.map(({ key, label, accent }) => {
          const rows = groups[key];
          if (rows.length === 0) return null;
          return (
            <section key={key}>
              <div
                className={cn(
                  'grid items-center gap-3.5 border-b px-1 pt-6 pb-2 first:pt-0',
                  ROW_GRID,
                )}
              >
                <div />
                <div
                  className={cn(
                    'text-[10.5px] font-bold tracking-[0.11em] uppercase',
                    accent,
                  )}
                >
                  {label}
                </div>
                <div className="text-[10.5px] font-bold tracking-[0.11em] text-muted-foreground uppercase">
                  Status
                </div>
                <div />
                <div />
              </div>

              {rows.map((meta) => (
                <RegistrarRow
                  key={meta.name}
                  meta={meta}
                  status={statusOf(meta)}
                  enabled={enabledOf(meta)}
                  test={tests[meta.name]}
                  testing={testingId === meta.name}
                  editing={editingId === meta.name}
                  onToggle={() =>
                    setEnabledOverride((prev) => ({
                      ...prev,
                      [meta.name]: !enabledOf(meta),
                    }))
                  }
                  onTest={() => void runTest(meta.name)}
                  onEdit={() =>
                    setEditingId((cur) =>
                      cur === meta.name ? null : meta.name,
                    )
                  }
                  onSaved={() => {
                    setEditingId(null);
                    void load();
                  }}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RegistrarRow({
  meta,
  status,
  enabled,
  test,
  testing,
  editing,
  onToggle,
  onTest,
  onEdit,
  onSaved,
}: {
  meta: RegistrarMeta;
  status: RowStatus;
  enabled: boolean;
  test: TestResult | undefined;
  testing: boolean;
  editing: boolean;
  onToggle: () => void;
  onTest: () => void;
  onEdit: () => void;
  onSaved: () => void;
}) {
  const sm = STATUS_META[status];
  const configured = status !== 'unconfigured';

  // Trailing detail after the status label: the last test's message this
  // session (red when it failed). We don't persist real "last tested" times.
  const detail = test
    ? { text: test.message, color: test.ok ? 'text-muted-foreground' : 'text-destructive' }
    : null;

  return (
    <div className={cn('border-t', editing && 'bg-muted/30')}>
      <div className={cn('grid items-center gap-3.5 px-1 py-3', ROW_GRID)}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'Disable registrar' : 'Enable registrar'}
          onClick={onToggle}
          disabled={!configured}
          className={cn(
            'relative h-5 w-[34px] shrink-0 rounded-full transition-colors',
            enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30',
            !configured && 'opacity-50',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform',
              enabled && 'translate-x-3.5',
            )}
          />
        </button>

        <div
          className={cn(
            'truncate font-semibold',
            !configured && 'text-muted-foreground',
          )}
        >
          {meta.displayName}
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('size-2 shrink-0 rounded-full', sm.dot)} />
          <span className={cn('shrink-0 text-sm font-semibold', sm.fg)}>
            {sm.label}
          </span>
          {detail && (
            <>
              <span className="shrink-0 text-muted-foreground/50">·</span>
              <span
                className={cn(
                  'truncate font-mono text-xs',
                  detail.color,
                )}
              >
                {detail.text}
              </span>
            </>
          )}
        </div>

        <div className="flex justify-start">
          {configured && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={onTest}
              disabled={testing}
            >
              <RotateCw className={cn('size-3', testing && 'animate-spin')} />
              {testing ? 'Testing…' : 'Test'}
            </Button>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            className={cn(
              'h-8 w-full text-xs',
              editing &&
                'border-emerald-500/45 text-emerald-600 dark:text-emerald-400',
            )}
          >
            {editing ? 'Close' : configured ? 'Edit connection' : 'Add connection'}
          </Button>
        </div>
      </div>

      {editing && (
        <RegistrarEditor meta={meta} onCancel={onEdit} onSaved={onSaved} />
      )}
    </div>
  );
}

function RegistrarEditor({
  meta,
  onCancel,
  onSaved,
}: {
  meta: RegistrarMeta;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<CredentialValues>({});
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void window.api.getRegistrarCredentials(meta.name).then(setValues);
  }, [meta.name]);

  const save = async () => {
    setSaving(true);
    setTest(null);
    try {
      await window.api.saveRegistrarCredentials(meta.name, values);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await window.api.testRegistrar(meta.name));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="px-1 pt-1 pb-5">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        {meta.helpText && (
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {meta.helpText}
          </p>
        )}

        <FieldGroup className="max-w-lg">
          {meta.configFields.map((field) => {
            const id = `tbl-${meta.name}-${field.name}`;
            return (
              <Field key={field.name}>
                <FieldLabel htmlFor={id}>
                  {field.label}
                  {field.required && <span className="text-destructive"> *</span>}
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

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={saving}>
            {saving
              ? 'Saving…'
              : meta.configured
                ? 'Save changes'
                : 'Save & connect'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void runTest()}
            disabled={testing}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {test && (
            <span
              className={cn(
                'flex items-center gap-1.5 text-sm',
                test.ok ? 'text-foreground' : 'text-destructive',
              )}
            >
              {test.ok ? (
                <CircleCheck className="size-4" />
              ) : (
                <CircleX className="size-4" />
              )}
              {test.message}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            Encrypted on this device · shared with the MCP server
          </span>
        </div>
      </div>
    </div>
  );
}
