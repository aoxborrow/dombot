/** Serialize a keyed service operation through persistence and rollback, not
 * just the underlying disk write. Independent keys retain their own queues. */
export function serialByKey() {
  const pending = new Map<string, Promise<unknown>>();
  return async function run<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = pending.get(key);
    const next = previous
      ? previous.catch(() => undefined).then(action)
      : action();
    pending.set(key, next);
    try {
      return await next;
    } finally {
      if (pending.get(key) === next) pending.delete(key);
    }
  };
}
