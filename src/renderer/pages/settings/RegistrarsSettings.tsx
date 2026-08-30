import { useEffect, useState } from 'react';
import type {
  CredentialValues,
  RegistrarMeta,
  TestResult,
} from '../../../shared/ipc';

export default function RegistrarsSettings() {
  const [registrars, setRegistrars] = useState<RegistrarMeta[]>([]);

  const load = async () =>
    setRegistrars(await window.api.getRegistrarMetadata());

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Registrars</h2>
        <p className="mt-1 text-sm text-slate-400">
          Store API credentials for each registrar. They&apos;re encrypted on
          this device and used by both the app and the MCP server.
        </p>
      </div>

      <div className="space-y-4">
        {registrars.map((r) => (
          <RegistrarCard key={r.name} meta={r} onSaved={load} />
        ))}
      </div>
    </div>
  );
}

function RegistrarCard({
  meta,
  onSaved,
}: {
  meta: RegistrarMeta;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<CredentialValues>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) {
      void window.api.getRegistrarCredentials(meta.name).then(setValues);
    }
  }, [open, meta.name]);

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
    <section className="rounded-lg border border-slate-800 bg-slate-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="font-medium">{meta.displayName}</span>
          {meta.configured ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
              Configured
            </span>
          ) : (
            <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-xs text-slate-400">
              Not set
            </span>
          )}
        </span>
        <span className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 px-5 py-4">
          {meta.helpText && (
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              {meta.helpText}
            </p>
          )}

          <div className="space-y-3">
            {meta.configFields.map((field) => (
              <label key={field.name} className="block">
                <span className="mb-1 block text-sm text-slate-300">
                  {field.label}
                  {field.required && <span className="text-red-400"> *</span>}
                </span>
                {field.type === 'select' ? (
                  <select
                    value={values[field.name] ?? ''}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.name]: e.target.value }))
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'password' ? 'password' : 'text'}
                    value={values[field.name] ?? ''}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.name]: e.target.value }))
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                )}
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => void runTest()}
              disabled={testing}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {test && (
              <span
                className={`text-sm ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {test.ok ? '✓ ' : '✗ '}
                {test.message}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
