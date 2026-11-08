/**
 * One line about a failure for the log: the error's class, the fields support
 * asks for (a market's or registrar's code, the HTTP status, Afternic's
 * request id), then its message. Never the request URL: Atom's carries the
 * token, so only fields known to be safe are read.
 */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & {
    code?: unknown;
    providerCode?: unknown;
    status?: unknown;
    requestId?: unknown;
  };
  const fields: string[] = [];
  for (const [key, value] of [
    ['code', e.code],
    ['providerCode', e.providerCode],
    ['status', e.status],
    ['requestId', e.requestId],
  ] as const) {
    if (typeof value === 'string' ? value !== '' : typeof value === 'number')
      fields.push(`${key}=${value}`);
  }
  const head = fields.length ? `${e.name} ${fields.join(' ')}` : e.name;
  return `${head}: ${e.message}`;
}
