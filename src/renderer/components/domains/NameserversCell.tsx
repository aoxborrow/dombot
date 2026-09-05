import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { Domain, DomainOp } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import {
  reportOpResult,
  targetOf,
  useOpUnsupportedReason,
} from '../../lib/domain-ops';
import { useNameserverPresets } from './useNameserverPresets';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { NameserversEditor } from './NameserversEditor';

/** Registrar caveats shown inside the editor. */
const EDITOR_NOTE: Record<string, string> = {
  namebright:
    'NameBright nameserver updates are built from its documented API but haven’t been verified against a live account.',
};

/**
 * The Nameservers cell: the current set (first host + "+N"), clickable to
 * open the editor in a popover. Saving writes the full set to the registrar —
 * pessimistically, with a spinner in the cell until the registrar answers —
 * and remembers the set as a recent preset. Disabled with a tooltip where the
 * registrar can't change nameservers (Cloudflare).
 */
export function NameserversCell({ domain }: { domain: Domain }) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const rememberNameservers = useAppStore((s) => s.rememberNameservers);
  const key = `${domain.registrar}:${domain.domainName}`;
  const pending = useAppStore((s) => s.mutating[key] ?? false);
  const [open, setOpen] = useState(false);

  const probe: DomainOp = { kind: 'nameservers', nameservers: [] };
  const reason = useOpUnsupportedReason(domain.registrar, probe);

  const save = (nameservers: string[]) => {
    const op: DomainOp = { kind: 'nameservers', nameservers };
    setOpen(false);
    void applyDomainOp(targetOf(domain), op).then((result) => {
      if (reportOpResult(op, result)) void rememberNameservers(nameservers);
    });
  };

  const empty = domain.nameservers.length === 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending || reason !== null}
          title={
            reason ??
            `${domain.nameservers.join('\n')}${empty ? '' : '\n\n'}Click to edit`
          }
          className={cn(
            'group inline-flex max-w-[280px] cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent',
            reason !== null && 'opacity-60',
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : empty ? (
            <span className="text-muted-foreground/50">—</span>
          ) : (
            <span className="inline-flex min-w-0 items-baseline gap-1.5 font-mono text-[13px] text-foreground/70">
              <span className="truncate">{domain.nameservers[0]}</span>
              {domain.nameservers.length > 1 && (
                <span className="opacity-60">
                  +{domain.nameservers.length - 1}
                </span>
              )}
            </span>
          )}
          {!pending && reason === null && (
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        {open && (
          <EditorWithPresets
            domain={domain}
            onSave={save}
            onCancel={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

// Mounted only while the popover is open, so the preset derivation (a pass
// over the whole portfolio) runs once per open rather than once per row.
function EditorWithPresets({
  domain,
  onSave,
  onCancel,
}: {
  domain: Domain;
  onSave: (nameservers: string[]) => void;
  onCancel: () => void;
}) {
  const presets = useNameserverPresets();

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        Nameservers for{' '}
        <span className="font-mono font-normal">{domain.domainName}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        One per line. Replaces the full set at the registrar.
      </p>
      <NameserversEditor
        initial={domain.nameservers}
        presets={presets}
        note={EDITOR_NOTE[domain.registrar]}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}
