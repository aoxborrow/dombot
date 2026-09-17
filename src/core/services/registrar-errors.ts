/** Never let a registrar's request URL or echoed credential become a diagnostic. */
export function redactRegistrarMessage(
  message: string,
  credentials: Record<string, string | undefined> = {},
): string {
  let safe = message.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      url.username = '';
      url.password = '';
      // Query-authenticated providers put keys here. Drop the whole query,
      // including unknown future credential parameter names.
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return '[redacted URL]';
    }
  });
  const secrets = Object.values(credentials).filter((v): v is string =>
    Boolean(v),
  );
  for (const secret of secrets.sort((a, b) => b.length - a.length)) {
    for (const value of new Set([
      secret,
      encodeURIComponent(secret),
      new URLSearchParams({ v: secret }).toString().slice(2),
    ])) {
      safe = safe.split(value).join('[redacted]');
    }
  }
  return safe;
}

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
        message: redactRegistrarMessage(result.message, credentials),
      };
    }
    return result;
  };
  const fail = (error: unknown): never => {
    if (error instanceof Error) {
      // Keep its class/status so retry and cancellation classification still work.
      error.message = redactRegistrarMessage(error.message, credentials);
      error.stack = `${error.name}: ${error.message}`;
      delete error.cause;
      throw error;
    }
    throw new Error(redactRegistrarMessage(String(error), credentials));
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
