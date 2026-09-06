import { randomUUID } from 'node:crypto';
import type {
  BulkJob,
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
import { applyDomainOp } from './domain-ops';

// The bulk-job runner: one `DomainOp` over many targets, owned by main so the
// per-registrar rate limits can be respected (one lane per registrar, with a
// concurrency and minimum spacing each), cancellation is a real abort, and the
// job survives the renderer navigating away. One job at a time. Progress
// streams to windows per item; the final snapshot is kept for re-attaching.
// See docs/domain-editing.md.

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

interface Running {
  job: BulkJob;
  controller: AbortController;
}

let current: Running | null = null;
let last: BulkJob | null = null;

/** The running job, else the most recent finished one, else null. */
export function getBulkJob(): BulkJob | null {
  return snapshot(current?.job ?? last);
}

export function isBulkRunning(): boolean {
  return current !== null;
}

/**
 * Starts a job. Throws if one is already running. Returns the initial
 * snapshot immediately; the work continues in the background and reports via
 * the bulk events.
 */
export function startBulk(targets: DomainTarget[], op: DomainOp): BulkJob {
  if (current) throw new Error('A bulk job is already running.');
  if (targets.length === 0) throw new Error('No domains selected.');

  const job: BulkJob = {
    id: randomUUID(),
    op,
    status: 'running',
    total: targets.length,
    results: [],
    counts: Object.fromEntries(
      STATUSES.map((s) => [s, 0]),
    ) as BulkJob['counts'],
    startedAt: Date.now(),
    finishedAt: null,
  };
  const controller = new AbortController();
  current = { job, controller };
  void run(job, targets, controller);
  return snapshot(job)!;
}

/** Aborts the running job (any id, or the given one). No-op otherwise. */
export function cancelBulk(jobId?: string): void {
  if (!current) return;
  if (jobId && current.job.id !== jobId) return;
  current.controller.abort();
}

async function run(
  job: BulkJob,
  targets: DomainTarget[],
  controller: AbortController,
): Promise<void> {
  const byRegistrar = new Map<RegistrarName, DomainTarget[]>();
  for (const t of targets) {
    const list = byRegistrar.get(t.registrar) ?? [];
    list.push(t);
    byRegistrar.set(t.registrar, list);
  }

  const record = (result: DomainOpResult) => {
    job.results.push(result);
    job.counts[result.status] += 1;
    broadcastBulkProgress({
      jobId: job.id,
      result,
      done: job.results.length,
      total: job.total,
    });
  };

  await Promise.all(
    [...byRegistrar.entries()].map(([registrar, queue]) =>
      runLane(registrar, queue, job.op, controller.signal, record),
    ),
  );

  job.status = controller.signal.aborted ? 'cancelled' : 'done';
  job.finishedAt = Date.now();
  current = null;
  last = job;
  // Items were applied with `silent`, so reconcile any open window once.
  if (job.counts.ok > 0) broadcastPortfolioChanged();
  broadcastBulkFinished(snapshot(job)!);
}

/**
 * One registrar's lane: `policy.lanes` workers pull from a shared queue, with
 * `spacingMs` between request starts across all of them. A rate-limited
 * result pauses the whole lane before the next pull. Once aborted, remaining
 * items are recorded as cancelled without a network call.
 */
async function runLane(
  registrar: RegistrarName,
  queue: DomainTarget[],
  op: DomainOp,
  signal: AbortSignal,
  record: (r: DomainOpResult) => void,
): Promise<void> {
  const policy = policyFor(registrar, op.kind);
  let next = 0;
  let lastStart = 0;
  let pausedUntil = 0;

  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const target = queue[next++];
      if (signal.aborted) {
        record({ target, status: 'cancelled', message: 'Cancelled' });
        continue;
      }
      // Pace: honor the lane pause and the minimum spacing between starts.
      const wait = Math.max(
        pausedUntil - Date.now(),
        lastStart + policy.spacingMs - Date.now(),
        0,
      );
      if (wait > 0) await sleep(wait, signal);
      if (signal.aborted) {
        record({ target, status: 'cancelled', message: 'Cancelled' });
        continue;
      }
      lastStart = Date.now();
      const result = await applyDomainOp(target, op, { signal, silent: true });
      if (result.status === 'rate-limited') {
        pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      }
      record(result);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(policy.lanes, queue.length) }, worker),
  );
}

/** Resolves after `ms`, or immediately when the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** A structured-clone-safe copy (results array included) for IPC. */
function snapshot(job: BulkJob | null | undefined): BulkJob | null {
  if (!job) return null;
  return { ...job, results: [...job.results], counts: { ...job.counts } };
}
