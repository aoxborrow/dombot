// Pure helpers behind the bulk-action dialog: bucketing a selection by
// eligibility, titling an op, and the results CSV. No React, no IPC.

import type {
  BulkJob,
  Domain,
  DomainOp,
  DomainOpKind,
  DomainOpStatus,
  RegistrarMeta,
} from '../../shared/ipc';
import { OP_LABEL, unsupportedReason } from '../../shared/domain-ops';

export interface Bucketed {
  /** Will be sent to the registrar. */
  eligible: Domain[];
  /** Already in the target state — nothing to do. */
  skipped: { domain: Domain; reason: string }[];
  /** The registrar can't do this op. */
  unsupported: { domain: Domain; reason: string }[];
}

/**
 * Splits a selection into what a bulk `op` would actually touch. "Already in
 * state" is judged from the merged row, but only when the row's detail has
 * been fetched (`isEnriched`) or the field is list-accurate (auto-renew) — a
 * summary-only row may read `false` for privacy/lock without meaning it, so
 * those stay eligible and the registrar's answer decides.
 */
export function bucketSelection(
  domains: readonly Domain[],
  op: DomainOp,
  registrars: RegistrarMeta[] | null,
  isEnriched: (d: Domain) => boolean,
): Bucketed {
  const out: Bucketed = { eligible: [], skipped: [], unsupported: [] };
  for (const d of domains) {
    const meta = registrars?.find((r) => r.name === d.registrar);
    const reason = meta
      ? unsupportedReason(meta.name, meta.features, op)
      : null;
    if (reason) {
      out.unsupported.push({ domain: d, reason });
      continue;
    }
    const already = alreadyInState(d, op, isEnriched(d));
    if (already) {
      out.skipped.push({ domain: d, reason: already });
      continue;
    }
    out.eligible.push(d);
  }
  return out;
}

function alreadyInState(
  d: Domain,
  op: DomainOp,
  enriched: boolean,
): string | null {
  switch (op.kind) {
    case 'autoRenew':
      return d.autoRenew === op.enabled
        ? `Auto-renew already ${op.enabled ? 'on' : 'off'}`
        : null;
    case 'privacy':
      return enriched && d.privacy === op.enabled
        ? `Privacy already ${op.enabled ? 'on' : 'off'}`
        : null;
    case 'lock':
      return enriched && d.locked === op.locked
        ? `Already ${op.locked ? 'locked' : 'unlocked'}`
        : null;
    default:
      return null;
  }
}

/** Imperative title for an op, e.g. "Enable auto-renew", "Unlock". */
export function bulkOpTitle(op: DomainOp): string {
  switch (op.kind) {
    case 'autoRenew':
      return `${op.enabled ? 'Enable' : 'Disable'} auto-renew`;
    case 'privacy':
      return `${op.enabled ? 'Enable' : 'Disable'} WHOIS privacy`;
    case 'lock':
      return op.locked ? 'Lock' : 'Unlock';
    case 'nameservers':
      return 'Set nameservers';
    case 'urlForwarding':
      return 'Set URL forwarding';
    case 'emailForwarding':
      return 'Set email forwarding';
    case 'authCode':
      return 'Get auth codes';
    case 'renew':
      return `Renew for ${op.years} year${op.years === 1 ? '' : 's'}`;
  }
}

/** Ops whose bulk form deserves the destructive (red) action button. */
export function isRiskyOp(op: DomainOp): boolean {
  return (
    (op.kind === 'lock' && !op.locked) ||
    (op.kind === 'privacy' && !op.enabled) ||
    op.kind === 'renew'
  );
}

export const STATUS_LABEL: Record<DomainOpStatus, string> = {
  ok: 'Done',
  failed: 'Failed',
  unsupported: 'Unsupported',
  skipped: 'Skipped',
  'rate-limited': 'Rate limited',
  cancelled: 'Cancelled',
};

/** Statuses worth a retry. */
export function isRetryable(status: DomainOpStatus): boolean {
  return (
    status === 'failed' || status === 'rate-limited' || status === 'cancelled'
  );
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The results report: one row per target with its status and message. */
export function resultsToCsv(job: BulkJob): string {
  const withCodes = hasAuthCodes(job);
  const header = ['Domain', 'Registrar', 'Status', 'Message'];
  if (withCodes) header.push('Auth code');
  const rows = job.results.map((r) => {
    const row = [
      r.target.domainName,
      r.target.registrar,
      STATUS_LABEL[r.status],
      r.message,
    ];
    if (withCodes) row.push(r.data?.authCode ?? '');
    return row;
  });
  return [header, ...rows]
    .map((row) => row.map(csvField).join(','))
    .join('\r\n');
}

/** Filename for a results export, e.g. "dombot-bulk-auto-renew-2026-09-04.csv". */
export function resultsCsvFilename(job: BulkJob): string {
  const label = OP_LABEL[job.op.kind].replace(/\s+/g, '-');
  const date = new Date(job.startedAt).toISOString().slice(0, 10);
  return `dombot-bulk-${label}-${date}.csv`;
}

/** The boolean ops: the ones whose bulk dialog offers an on/off choice. */
export type FlagKind = 'autoRenew' | 'privacy' | 'lock';

/** A domain's current value for a flag kind. */
export function flagOf(d: Domain, kind: FlagKind): boolean {
  return kind === 'autoRenew'
    ? d.autoRenew
    : kind === 'privacy'
      ? d.privacy
      : d.locked;
}

/** The op for a flag kind and a target value. */
export function flagOp(kind: FlagKind, on: boolean): DomainOp {
  return kind === 'lock' ? { kind, locked: on } : { kind, enabled: on };
}

/** The target value an op sets, for the boolean kinds. */
export function flagTarget(op: DomainOp): boolean | null {
  return op.kind === 'lock'
    ? op.locked
    : op.kind === 'autoRenew' || op.kind === 'privacy'
      ? op.enabled
      : null;
}

/**
 * The op the bulk dialog opens with for a flag kind: the value that flips the
 * majority of the selection (ties turn it on), so the most likely intent is
 * preselected and the rows already there show as skipped.
 */
export function defaultFlagOp(
  kind: FlagKind,
  domains: readonly Domain[],
): DomainOp {
  const on = domains.filter((d) => flagOf(d, kind)).length;
  const majorityOn = on > domains.length / 2;
  return flagOp(kind, !majorityOn);
}

/** The op a bulk dialog opens with for a kind chosen from the menu. */
export function defaultBulkOp(
  kind: DomainOpKind,
  domains: readonly Domain[],
): DomainOp {
  switch (kind) {
    case 'autoRenew':
    case 'privacy':
    case 'lock':
      return defaultFlagOp(kind, domains);
    case 'nameservers':
      return { kind, nameservers: [] };
    case 'urlForwarding':
      return { kind, forwards: [], skipIfExisting: true };
    case 'emailForwarding':
      return { kind, forwards: [], skipIfExisting: true };
    case 'authCode':
      return { kind };
    case 'renew':
      return { kind, years: 1 };
  }
}

/**
 * For a forwarding op over a mixed selection: the registrars whose own rules
 * reject the rule set (Gandi: no apex; NameSilo: one apex rule), each with the
 * reasons. Domains at those registrars are held back from the job. `validate`
 * is the per-registrar validator; `generic` its registrar-agnostic errors,
 * which are subtracted so only the registrar-specific ones remain.
 */
export function registrarRuleConflicts(
  domains: readonly Domain[],
  validate: (registrar: string) => { errors: string[] },
  generic: readonly string[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const registrar of new Set(domains.map((d) => d.registrar))) {
    const specific = validate(registrar).errors.filter(
      (e) => !generic.includes(e),
    );
    if (specific.length > 0) out.set(registrar, specific);
  }
  return out;
}

/** Whether any result carries an auth code (the results CSV adds a column). */
export function hasAuthCodes(job: BulkJob): boolean {
  return job.results.some((r) => r.data?.authCode);
}
