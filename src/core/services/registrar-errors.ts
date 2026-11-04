import { redactSecrets } from '@aoxborrow/registrar-client';

/** Wrap the provider, including extended methods reached through client.provider.
 * Redaction happens before results can enter caches, logs, IPC, or MCP. */
export function protectRegistrar<T extends object>(
  provider: T,
  credentials: Record<string, string | undefined>,
): T {
  const clean = (result: unknown): unknown => {
    if (
      result &&
      typeof result === 'object' &&
      'message' in result &&
      typeof result.message === 'string'
    ) {
      return {
        ...result,
        message: redactSecrets(result.message, credentials),
      };
    }
    return result;
  };
  const fail = (error: unknown): never => {
    if (error instanceof Error) {
      // Keep its class/status so retry and cancellation classification still work.
      error.message = redactSecrets(error.message, credentials);
      error.stack = `${error.name}: ${error.message}`;
      delete error.cause;
      throw error;
    }
    throw new Error(redactSecrets(String(error), credentials));
  };
  return new Proxy(provider, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        try {
          const result: unknown = Reflect.apply(value, target, args);
          return result instanceof Promise
            ? result.then(clean, fail)
            : clean(result);
        } catch (error) {
          return fail(error);
        }
      };
    },
  });
}
