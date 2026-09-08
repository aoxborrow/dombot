import { resolveDomainAccount } from './registrars';
import type {
  BulkJob,
  BulkStep,
  DomainOp,
  DomainOpKind,
  DomainOpResult,
  DomainOpStatus,
  DomainTarget,
  RegistrarName,
} from '../../shared/ipc';
import {
  broadcastBulkFinished,
  broadcastBulkProgress,
  broadcastPortfolioChanged,
} from '../events';
import { Namespace } from '../storage/namespace';
import { applyDomainOp } from './domain-ops';

// The bulk-job runner: one `DomainOp` over many targets, respecting each
// registrar's rate limits (one lane per registrar, with a concurrency and a
// minimum spacing between request starts). One job at a time.
//
// The job is a persisted document, advanced in *steps*: `stepBulk()` runs one
// slice — for every registrar whose lane is ready, up to its concurrency of
// pending targets — records the results, and reports when the next slice may
// start. Who calls `stepBulk` repeatedly depends on the host: the desktop
// host drives itself in-process (`setBulkAutoDrive(true)`), while the web host
// has the renderer call it, since a Worker can't hold a loop across requests.
// Either way a job survives a process restart: its pending list and lane
// timers are in the store, not in a closure. See docs/web-deployment.md.
//
// Auth codes (`result.data`) are never persisted: the in-memory job keeps
// them for the session; the stored copy is redacted.

interface LanePolicy {
  /** Concurrent requests to this registrar. */
  lanes: number;
  /** Minimum gap between request *starts* across the registrar's lanes. */
  spacingMs: number;
}

const DEFAULT_POLICY: LanePolicy = { lanes: 2, spacingMs: 500 };

// Starting points from the library's registrar notes (docs/registrars/*.md);
// tune against real accounts.
const LANE_POLICY: Partial<Record<RegistrarName, LanePolicy>> = {
  dynadot: { lanes: 1, spacingMs: 1000 }, // Regular tier: 1 thread / 60 req-min
  porkbun: { lanes: 1, spacingMs: 1000 },
  namebright: { lanes: 1, spacingMs: 1000 }, // ~30 req / 30 s
  spaceship: { lanes: 1, spacingMs: 2000 }, // some endpoints 5 req / window
  namecheap: { lanes: 2, spacingMs: 1200 }, // ~50 req / min
  godaddy: { lanes: 2, spacingMs: 2500 }, // ~600 req / 23 min
};

/** Money ops serialize; Porkbun allows one renew attempt per 10 s. */
function policyFor(registrar: RegistrarName, kind: DomainOpKind): LanePolicy {
  const base = LANE_POLICY[registrar] ?? DEFAULT_POLICY;
  if (kind !== 'renew') return base;
  return {
    lanes: 1,
    spacingMs: Math.max(
      base.spacingMs,
      registrar === 'porkbun' ? 10_000 : 2_000,
    ),
  };
}

/** How long a lane pauses after an item still comes back rate-limited. */
const RATE_LIMIT_PAUSE_MS = 30_000;

const STATUSES: DomainOpStatus[] = [
  'ok',
  'failed',
  'unsupported',
  'skipped',
  'rate-limited',
  'cancelled',
];

/** The persisted job: the public snapshot plus the runner's own state. */
interface StoredJob extends BulkJob {
  /** Targets not yet attempted, in selection order. */
  pending: DomainTarget[];
  /**
   * Targets claimed by the slice in flight. Only ever non-empty in the store
   * while a request is out; if a job is loaded with some still here, the
   * process that claimed them died mid-request and their outcome is unknown.
   */
  inFlight: DomainTarget[];
  /** Set by cancelBulk; the next step records the rest as cancelled. */
  cancelRequested: boolean;
  /** Per-registrar lane: the earliest time its next request may start. */
  notBefore: Partial<Record<RegistrarName, number>>;
}

const sameTarget = (a: DomainTarget, b: DomainTarget): boolean =>
  a.registrar === b.registrar &&
  (a.accountId ?? a.registrar) === (b.accountId ?? b.registrar) &&
  a.domainName === b.domainName;

const JOB_KEY = 'job';
const store = new Namespace<StoredJob>('bulk-jobs');

// In-memory copy of the stored job (results keep their `data`), the abort
// controller for the step in flight, and a wake-up for the driver's sleep.
let job: StoredJob | null = null;
let inFlight: Promise<BulkStep> | null = null;
let stepController: AbortController | null = null;
let wakeDriver: (() => void) | null = null;
let autoDrive = false;

/** Desktop host: drive every started job in-process. Off for the web host. */
export function setBulkAutoDrive(enabled: boolean): void {
  autoDrive = enabled;
}

function loadJob(): StoredJob | null {
  if (!job) {
    const stored = store.get(JOB_KEY);
    // Pre-account jobs were queued under the provider's legacy default account.
    // Pin those targets to that ID; never infer a newly-added account on resume.
    const migratedTarget = (target: DomainTarget): DomainTarget => ({
      ...target,
      accountId: target.accountId ?? target.registrar,
    });
    job = stored
      ? {
          ...stored,
          pending: stored.pending.map(migratedTarget),
          inFlight: (stored.inFlight ?? []).map(migratedTarget),
          results: stored.results.map((r) => ({
            ...r,
            target: migratedTarget(r.target),
          })),
        }
      : null;
  }
  return job;
}

function persist(): void {
  if (!job) return;
  void store.set(JOB_KEY, {
    ...job,
    results: job.results.map((r) =>
      r.data
        ? {
            target: r.target,
            status: r.status,
            message: r.message,
            patch: r.patch,
          }
        : r,
    ),
  });
}

/** A structured-clone-safe copy of the public fields. */
function snapshot(j: StoredJob | null): BulkJob | null {
  if (!j) return null;
  return {
    id: j.id,
    op: j.op,
    status: j.status,
    total: j.total,
    results: [...j.results],
    counts: { ...j.counts },
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}

/** The running job, else the most recent finished one, else null. */
export function getBulkJob(): BulkJob | null {
  return snapshot(loadJob());
}

export function isBulkRunning(): boolean {
  return loadJob()?.status === 'running';
}

/**
 * Starts a job. Throws if one is already running. Returns the initial
 * snapshot; on an auto-driving host the work then continues in the
 * background and reports via the bulk events, otherwise the caller steps it.
 */
export function startBulk(targets: DomainTarget[], op: DomainOp): BulkJob {
  if (isBulkRunning()) throw new Error('A bulk job is already running.');
  if (targets.length === 0) throw new Error('No domains selected.');
  targets = targets.map((t) => ({
    ...t,
    accountId: resolveDomainAccount(t.registrar, t.domainName, t.accountId).id,
  }));

  job = {
    id: crypto.randomUUID(),
    op,
    status: 'running',
    total: targets.length,
    results: [],
    counts: Object.fromEntries(
      STATUSES.map((s) => [s, 0]),
    ) as BulkJob['counts'],
    startedAt: Date.now(),
    finishedAt: null,
    pending: [...targets],
    inFlight: [],
    cancelRequested: false,
    notBefore: {},
  };
  persist();
  if (autoDrive) void driveBulk(job.id);
  return snapshot(job)!;
}

/** Requests cancellation of the running job (any id, or the given one). The
 *  step in flight is aborted; the remainder is recorded as cancelled. */
export function cancelBulk(jobId?: string): void {
  const j = loadJob();
  if (!j || j.status !== 'running') return;
  if (jobId && j.id !== jobId) return;
  j.cancelRequested = true;
  persist();
  stepController?.abort();
  wakeDriver?.();
}

function record(j: StoredJob, result: DomainOpResult): void {
  j.inFlight = j.inFlight.filter((t) => !sameTarget(t, result.target));
  j.results.push(result);
  j.counts[result.status] += 1;
  persist();
  broadcastBulkProgress({
    jobId: j.id,
    result,
    done: j.results.length,
    total: j.total,
  });
}

function finish(j: StoredJob): void {
  j.status = j.cancelRequested ? 'cancelled' : 'done';
  j.finishedAt = Date.now();
  j.pending = [];
  persist();
  // Items were applied with `silent`, so reconcile any open window once.
  if (j.counts.ok > 0) broadcastPortfolioChanged();
  broadcastBulkFinished(snapshot(j)!);
}

/** Earliest time any registrar with pending work may start, or null. */
function nextStartAt(j: StoredJob): number | null {
  let earliest: number | null = null;
  for (const registrar of new Set(j.pending.map((t) => t.registrar))) {
    const at = j.notBefore[registrar] ?? 0;
    earliest = earliest === null ? at : Math.min(earliest, at);
  }
  return earliest;
}

/**
 * Advances the job one slice: for each registrar whose lane is ready, runs up
 * to its concurrency of pending targets (in parallel across registrars),
 * records the results, and finishes the job when nothing is pending. Returns
 * the snapshot plus `nextAt`, the earliest time another slice can do work
 * (null once finished). Safe to call while a slice is in flight — it returns
 * that slice's result rather than starting another.
 */
export function stepBulk(jobId?: string): Promise<BulkStep> {
  const j = loadJob();
  if (!j || (jobId && j.id !== jobId)) {
    throw new Error('No such bulk job.');
  }
  if (inFlight) return inFlight;
  inFlight = runStep(j).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

const ORPHAN_MESSAGE =
  'Interrupted mid-request — outcome unknown; check the domain at the registrar';
const UNRUN_MESSAGE = 'Interrupted — the app was closed before this item ran';

/**
 * Targets that a previous process claimed but never recorded: it died with
 * the request out. We can't know whether the registrar applied it, so it's
 * recorded as cancelled with a message that says to check — never re-run
 * (a renew could double-charge).
 */
function reconcileOrphans(j: StoredJob): void {
  if (stepController !== null) return; // this process owns the slice
  for (const target of j.inFlight) {
    j.results.push({ target, status: 'cancelled', message: ORPHAN_MESSAGE });
    j.counts.cancelled += 1;
  }
  if (j.inFlight.length > 0) {
    console.warn(
      `[bulk] ${j.inFlight.length} item(s) of job ${j.id} were in flight when a previous process died`,
    );
    j.inFlight = [];
    persist();
  }
}

async function runStep(j: StoredJob): Promise<BulkStep> {
  if (j.status !== 'running') return { job: snapshot(j)!, nextAt: null };
  reconcileOrphans(j);

  if (j.cancelRequested) {
    for (const target of j.pending) {
      record(j, { target, status: 'cancelled', message: 'Cancelled' });
    }
    j.pending = [];
  }
  if (j.pending.length === 0) {
    finish(j);
    return { job: snapshot(j)!, nextAt: null };
  }

  // Pick this slice: per ready registrar, up to `lanes` targets.
  const now = Date.now();
  const slice: DomainTarget[] = [];
  const perRegistrar = new Map<RegistrarName, number>();
  for (const target of j.pending) {
    const policy = policyFor(target.registrar, j.op.kind);
    if ((j.notBefore[target.registrar] ?? 0) > now) continue;
    const taken = perRegistrar.get(target.registrar) ?? 0;
    if (taken >= policy.lanes) continue;
    perRegistrar.set(target.registrar, taken + 1);
    slice.push(target);
  }
  if (slice.length === 0) {
    return { job: snapshot(j)!, nextAt: nextStartAt(j) };
  }

  // Claim them (pending → inFlight, so a crash mid-slice can't lose them),
  // stamp each lane's next start, and run the slice in parallel.
  j.pending = j.pending.filter((t) => !slice.includes(t));
  j.inFlight = slice;
  for (const registrar of perRegistrar.keys()) {
    j.notBefore[registrar] = now + policyFor(registrar, j.op.kind).spacingMs;
  }
  persist();

  const controller = new AbortController();
  stepController = controller;
  try {
    await Promise.all(
      slice.map(async (target) => {
        const result = controller.signal.aborted
          ? { target, status: 'cancelled' as const, message: 'Cancelled' }
          : await applyDomainOp(target, j.op, {
              signal: controller.signal,
              silent: true,
            });
        if (result.status === 'rate-limited') {
          j.notBefore[target.registrar] = Date.now() + RATE_LIMIT_PAUSE_MS;
        }
        record(j, result);
      }),
    );
  } finally {
    stepController = null;
  }

  if (j.cancelRequested) {
    for (const target of j.pending) {
      record(j, { target, status: 'cancelled', message: 'Cancelled' });
    }
    j.pending = [];
  }
  if (j.pending.length === 0) {
    finish(j);
    return { job: snapshot(j)!, nextAt: null };
  }
  return { job: snapshot(j)!, nextAt: nextStartAt(j) };
}

/**
 * Steps the job to completion, sleeping until each next start. The desktop
 * host's driver; also usable by any host that can hold a loop. Cancellation
 * wakes the sleep so the job closes out promptly.
 */
export async function driveBulk(jobId: string): Promise<void> {
  for (;;) {
    const { job: j, nextAt } = await stepBulk(jobId);
    if (j.status !== 'running') return;
    const wait = nextAt === null ? 0 : nextAt - Date.now();
    if (wait > 0) await sleepUntilWoken(wait);
  }
}

function sleepUntilWoken(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wakeDriver = null;
      resolve();
    }
    wakeDriver = done;
  });
}

/**
 * Startup reconciliation: a job still marked running was interrupted by a
 * crash or quit. Nothing resumes on its own — a renew is money — so the
 * remaining targets are recorded as cancelled: unrun ones with a message
 * that says so, and any that were mid-request with one that says the outcome
 * is unknown. The report then accounts for every selected domain.
 */
export function abandonInterruptedBulk(): void {
  const j = loadJob();
  if (!j || j.status !== 'running') return;
  reconcileOrphans(j);
  for (const target of j.pending) {
    j.results.push({ target, status: 'cancelled', message: UNRUN_MESSAGE });
    j.counts.cancelled += 1;
  }
  j.pending = [];
  j.cancelRequested = true;
  j.status = 'cancelled';
  j.finishedAt = Date.now();
  persist();
  console.warn(
    `[bulk] closed out interrupted job ${j.id}: ${j.counts.cancelled} item(s) not run`,
  );
}

/** Forgets the in-memory job so the next read comes from the store: tests,
 *  and the web host at the start of each request (another isolate may have
 *  advanced the job). */
export function resetBulkMemory(): void {
  job = null;
  inFlight = null;
  stepController = null;
  wakeDriver = null;
}
