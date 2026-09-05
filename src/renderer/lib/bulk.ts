// Pure helpers behind the bulk-action dialog: bucketing a selection by
// eligibility, titling an op, and the results CSV. No React, no IPC.

import type {
  BulkJob,
  Domain,
  DomainOp,
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
  const header = ['Domain', 'Registrar', 'Status', 'Message'];
  const rows = job.results.map((r) => [
    r.target.domainName,
    r.target.registrar,
    STATUS_LABEL[r.status],
    r.message,
  ]);
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
