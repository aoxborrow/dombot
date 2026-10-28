import type { RegistrarName } from '../../shared/ipc';

export const DYNADOT_ACTIVATION_NOTICE =
  'Dynadot hasn’t accepted this key yet. New keys can take a few minutes to become active. We’ll try again every 30 seconds for up to 3 minutes. You can stop waiting at any time.';

export class DynadotActivationPending extends Error {
  constructor() {
    super(
      'Dynadot still hasn’t accepted this key. If you just created it, wait a little longer and retry. Otherwise, check that the API key and secret are correct, API access is enabled, and any IP restrictions allow this connection.',
    );
  }
}

function waitForActivation(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Only retry Dynadot authentication during account creation. A rejected
 * connection test never persists an account; other failures may be from saving
 * and must not be replayed. The provider cannot distinguish activation from a
 * bad key, so keep the wait bounded and the guidance conditional. */
export async function connectRegistrarWithActivationWait<T>(
  registrar: RegistrarName,
  connect: () => Promise<T>,
  signal: AbortSignal,
  onWaiting: (waiting: boolean) => void,
): Promise<T> {
  const deadline = Date.now() + 180_000;
  for (let retry = 0; ; retry++) {
    signal.throwIfAborted();
    if (retry > 0 && Date.now() > deadline)
      throw new DynadotActivationPending();
    try {
      return await connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        registrar !== 'dynadot' ||
        !/\b401\b[\s\S]*\bUnauthorized\b/i.test(message)
      )
        throw error;
      if (retry >= 6 || Date.now() >= deadline)
        throw new DynadotActivationPending();
      onWaiting(true);
      try {
        await waitForActivation(
          signal,
          Math.min(30_000, deadline - Date.now()),
        );
      } finally {
        onWaiting(false);
      }
    }
  }
}
