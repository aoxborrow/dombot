// One request at a time per isolate.
//
// The core keeps every namespace in module-level memory and the Worker
// re-hydrates it from D1 at the start of each request. A Workers isolate
// serves concurrent requests, interleaving them at every `await` — so without
// this, a poll arriving while a bulk step is mid-registrar-call would
// re-hydrate under it (and reset the bulk runner's in-memory job), a login
// burst would read the same attempts counter, and two writers would each
// persist their own stale view. DomBot is a single-user app: serializing the
// requests that touch state costs nothing noticeable and makes the
// hydrate → handle → flush cycle atomic within the isolate.
//
// Asset requests never take the lock (they touch no state). Other isolates
// still run in parallel; per-request hydration keeps them consistent with
// what's durable, which is the same guarantee as before.

let tail: Promise<void> = Promise.resolve();
let depth = 0;

/** Runs `fn` once every earlier `withRequestLock` call has finished. */
export function withRequestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(() => {
    depth++;
    return fn();
  });
  tail = run.then(
    () => {
      depth--;
    },
    () => {
      depth--;
    },
  );
  return run;
}

/** Whether a locked section is running right now (tests, diagnostics). */
export function requestLockHeld(): boolean {
  return depth > 0;
}
