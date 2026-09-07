import type {
  BulkJob,
  BulkProgress,
  Domain,
  DombotApi,
  Revisions,
} from '../../shared/ipc';

// `window.api` for the web host: the same DombotApi the Electron preload
// exposes, over HTTP. Every request/response method is `POST /api/<name>`
// with `{ args }`; the Worker validates and dispatches through the same
// method table the desktop uses (src/worker/index.ts).
//
// What differs from the preload bridge:
//  - Events. There's no push channel, so the four `onX` subscriptions poll
//    `getRevisions` (fast while a bulk job runs, slow otherwise, paused when
//    the tab is hidden) and fire when a counter moves. The renderer then
//    refetches exactly as it does when Electron pushes.
//  - Bulk jobs. A Worker can't hold a loop, so this client drives a running
//    job by calling `stepBulk` until it finishes (see driveBulk).
//  - Browser-native bits: `openExternal` is window.open, `saveCsv` is a
//    download, `getAppInfo` comes from the server with platform 'web'.
//  - Dates. Domains cross the wire as JSON, so ISO strings are revived here
//    (the Electron bridge's structured clone did that implicitly).

type Listener<T> = (payload: T) => void;

class HttpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpApiError';
  }
}

// Set by the bootstrap once the app is rendered behind a live session. Until
// then a 401 is just "not signed in yet" and must not trigger a reload (the
// login screen would loop).
let sessionActive = false;
export function setSessionActive(active: boolean): void {
  sessionActive = active;
}

async function call<T>(method: string, args: unknown[] = []): Promise<T> {
  // JSON has no `undefined`: a trailing omitted optional would arrive as
  // `null` and fail the method's schema. Drop them; `invoke` pads them back.
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
  const res = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
    credentials: 'same-origin',
  });
  const body = (await res.json().catch(() => ({}))) as {
    result?: T;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 401 && sessionActive) {
      // Session expired (or password rotated): back to the login screen.
      sessionActive = false;
      window.location.reload();
    }
    throw new HttpApiError(
      body.error ?? `${method} failed (${res.status})`,
      res.status,
    );
  }
  return body.result as T;
}

// ── date revival ────────────────────────────────────────────────────────────

function reviveDomain<T extends Partial<Domain>>(d: T): T {
  const out = { ...d } as Partial<Domain>;
  if (out.createdDate != null) out.createdDate = new Date(out.createdDate);
  if (out.expirationDate != null)
    out.expirationDate = new Date(out.expirationDate);
  return out as T;
}

function reviveDomains<T extends { domains: Domain[] }>(p: T): T {
  return { ...p, domains: p.domains.map(reviveDomain) };
}

function reviveJob(job: BulkJob | null): BulkJob | null {
  if (!job) return null;
  return {
    ...job,
    results: job.results.map((r) =>
      r.patch ? { ...r, patch: reviveDomain(r.patch) } : r,
    ),
  };
}

// ── polling ─────────────────────────────────────────────────────────────────

const FAST_MS = 2_000;
const SLOW_MS = 15_000;

class Poller {
  private last: Revisions | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  readonly listeners = {
    portfolio: new Set<Listener<void>>(),
    bulk: new Set<Listener<void>>(),
    approvals: new Set<Listener<void>>(),
  };

  constructor(private readonly isFast: () => boolean) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.tick();
    });
  }

  private hasListeners(): boolean {
    return Object.values(this.listeners).some((s) => s.size > 0);
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.hasListeners()) return;
    this.timer = setTimeout(
      () => void this.tick(),
      this.isFast() ? FAST_MS : SLOW_MS,
    );
  }

  async tick(): Promise<void> {
    if (!this.hasListeners()) return;
    if (this.busy || document.visibilityState !== 'visible') {
      this.schedule();
      return;
    }
    this.busy = true;
    try {
      const rev = await call<Revisions>('getRevisions');
      if (this.last) {
        for (const kind of ['portfolio', 'bulk', 'approvals'] as const) {
          if (rev[kind] !== this.last[kind]) {
            for (const l of this.listeners[kind]) l();
          }
        }
      }
      this.last = rev;
    } catch {
      // Transient; the next tick retries.
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  subscribe(kind: keyof Poller['listeners'], l: Listener<void>): () => void {
    this.listeners[kind].add(l);
    if (!this.timer) void this.tick();
    return () => {
      this.listeners[kind].delete(l);
    };
  }
}

// ── bulk driving ────────────────────────────────────────────────────────────

/** Whether this client is currently stepping a job (drives the poll rate). */
let driving: string | null = null;

const progressListeners = new Set<Listener<BulkProgress>>();
const finishedListeners = new Set<Listener<BulkJob>>();

/**
 * Steps a running job to completion from the browser: each `stepBulk`
 * returns the job after one slice plus when the next may start. Progress
 * events are synthesized from the results that arrived in each step, so the
 * renderer's existing handlers see the same stream the desktop pushes.
 */
async function driveBulk(jobId: string, seenResults: number): Promise<void> {
  if (driving) return;
  driving = jobId;
  let seen = seenResults;
  try {
    for (;;) {
      const { job, nextAt } = await call<{
        job: BulkJob;
        nextAt: number | null;
      }>('stepBulk', [jobId]);
      const revived = reviveJob(job)!;
      for (let i = seen; i < revived.results.length; i++) {
        const p: BulkProgress = {
          jobId: revived.id,
          result: revived.results[i],
          done: i + 1,
          total: revived.total,
        };
        for (const l of progressListeners) l(p);
      }
      seen = revived.results.length;
      if (revived.status !== 'running') {
        for (const l of finishedListeners) l(revived);
        return;
      }
      const wait = nextAt === null ? 0 : Math.max(0, nextAt - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  } catch (err) {
    console.error('[bulk] stepping stopped:', err);
  } finally {
    driving = null;
  }
}

// ── the api object ──────────────────────────────────────────────────────────

export function createHttpApi(): DombotApi {
  const poller = new Poller(() => driving !== null);
  const m =
    <T>(name: string) =>
    (...args: unknown[]) =>
      call<T>(name, args);

  return {
    ping: m<string>('ping'),
    getAppInfo: m('getAppInfo'),
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    saveCsv: async (content, suggestedName) => {
      const blob = new Blob(['﻿' + content], {
        type: 'text/csv;charset=utf-8',
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = suggestedName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      return { saved: true, path: suggestedName };
    },

    hydrateFromCache: async () => {
      const snap =
        await call<Awaited<ReturnType<DombotApi['hydrateFromCache']>>>(
          'hydrateFromCache',
        );
      return {
        ...snap,
        portfolio: snap.portfolio ? reviveDomains(snap.portfolio) : null,
        detail: Object.fromEntries(
          Object.entries(snap.detail).map(([k, v]) => [k, reviveDomain(v)]),
        ),
      };
    },
    clearAllCaches: m('clearAllCaches'),
    getPortfolioPricing: m('getPortfolioPricing'),
    setManualPrice: m('setManualPrice'),

    listDynadotDomains: async () =>
      (await call<Domain[]>('listDynadotDomains')).map(reviveDomain),
    listPortfolio: async (refresh) =>
      reviveDomains(
        await call<Awaited<ReturnType<DombotApi['listPortfolio']>>>(
          'listPortfolio',
          [refresh],
        ),
      ),
    syncRegistrar: async (name) =>
      reviveDomains(
        await call<Awaited<ReturnType<DombotApi['syncRegistrar']>>>(
          'syncRegistrar',
          [name],
        ),
      ),
    getDomainDetail: async (registrar, domainName, refresh) => {
      const d = await call<Partial<Domain> | null>('getDomainDetail', [
        registrar,
        domainName,
        refresh,
      ]);
      return d ? reviveDomain(d) : null;
    },
    applyDomainOp: async (target, op) => {
      const r = await call<Awaited<ReturnType<DombotApi['applyDomainOp']>>>(
        'applyDomainOp',
        [target, op],
      );
      return r.patch ? { ...r, patch: reviveDomain(r.patch) } : r;
    },
    getUrlForwarding: m('getUrlForwarding'),
    getEmailForwarding: m('getEmailForwarding'),

    startBulk: async (targets, op) => {
      const job = reviveJob(await call<BulkJob>('startBulk', [targets, op]))!;
      void driveBulk(job.id, 0);
      return job;
    },
    cancelBulk: m('cancelBulk'),
    getBulkJob: async () => {
      const job = reviveJob(await call<BulkJob | null>('getBulkJob'));
      // Re-attach: if a job is still running (page reload mid-job), resume
      // stepping it from here.
      if (job?.status === 'running') void driveBulk(job.id, job.results.length);
      return job;
    },
    stepBulk: async (jobId) => {
      const s = await call<Awaited<ReturnType<DombotApi['stepBulk']>>>(
        'stepBulk',
        [jobId],
      );
      return { ...s, job: reviveJob(s.job)! };
    },
    onBulkProgress: (cb) => {
      progressListeners.add(cb);
      return () => {
        progressListeners.delete(cb);
      };
    },
    onBulkFinished: (cb) => {
      finishedListeners.add(cb);
      return () => {
        finishedListeners.delete(cb);
      };
    },

    getRegistrarMetadata: m('getRegistrarMetadata'),
    getRegistrarCredentials: m('getRegistrarCredentials'),
    saveRegistrarCredentials: m('saveRegistrarCredentials'),
    setRegistrarEnabled: async (name, enabled) =>
      reviveDomains(
        await call<Awaited<ReturnType<DombotApi['setRegistrarEnabled']>>>(
          'setRegistrarEnabled',
          [name, enabled],
        ),
      ),

    getMcpInfo: m('getMcpInfo'),
    listPendingApprovals: m('listPendingApprovals'),
    resolveApproval: m('resolveApproval'),
    listMcpClients: m('listMcpClients'),
    revokeMcpClient: m('revokeMcpClient'),
    onApprovalsChanged: (cb) => poller.subscribe('approvals', cb),
    onPortfolioChanged: (cb) => poller.subscribe('portfolio', cb),

    getFolders: m('getFolders'),
    createFolder: m('createFolder'),
    updateFolder: m('updateFolder'),
    deleteFolder: m('deleteFolder'),
    assignFolder: m('assignFolder'),

    getSettings: m('getSettings'),
    updateSettings: m('updateSettings'),

    getRevisions: m('getRevisions'),
  };
}
