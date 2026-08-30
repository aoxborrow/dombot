import { useEffect, useState } from 'react';
import { Check, ChevronDown, CircleCheck, CircleX } from 'lucide-react';
import type {
  CredentialValues,
  RegistrarMeta,
  TestResult,
} from '../../../shared/ipc';
import { cn } from '@/lib/utils';
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
  const [registrars, setRegistrars] = useState<RegistrarMeta[]>([]);

  const load = async () => {
    const metas = await window.api.getRegistrarMetadata();
    metas.sort((a, b) => a.displayName.localeCompare(b.displayName));
    setRegistrars(metas);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Registrars</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Store API credentials for each registrar. They&apos;re encrypted on
          this device and used by both the app and the MCP server.
        </p>
      </div>

      <div className="flex flex-col gap-3">
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
    <Card className="gap-0 overflow-hidden py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
          <span className="flex items-center gap-3">
            <span className="font-medium">{meta.displayName}</span>
            {meta.configured ? (
              <Badge variant="secondary">
                <Check />
                Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not set
              </Badge>
            )}
          </span>
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t px-5 py-4">
          {meta.helpText && (
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              {meta.helpText}
            </p>
          )}

          <FieldGroup>
            {meta.configFields.map((field) => {
              const id = `${meta.name}-${field.name}`;
              return (
                <Field key={field.name}>
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
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void runTest()}
              disabled={testing}
            >
              {testing ? 'Testing…' : 'Test connection'}
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
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
