import type { Domain } from './ipc';

// Registrar date-only values have no zone. Allow one day of ambiguity near
// midnight; a registration weeks or years ahead is never explained by a zone.
const DATE_ONLY_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** Qualify registrar creation dates only. Expiry/renewal may be in the future.
 * Imported user facts are outside this provider-data projection. */
export function qualifyCreationDate<T extends Partial<Domain>>(
  domain: T,
  now = Date.now(),
): T {
  if (domain.source === 'imported' || domain.createdDate == null) return domain;
  const created = new Date(domain.createdDate).getTime();
  const expires =
    domain.expirationDate == null
      ? NaN
      : new Date(domain.expirationDate).getTime();
  const issue = !Number.isFinite(created)
    ? 'invalid'
    : created > now + DATE_ONLY_TOLERANCE_MS
      ? 'future'
      : Number.isFinite(expires) && created > expires + DATE_ONLY_TOLERANCE_MS
        ? 'after-expiration'
        : null;
  const result = { ...domain };
  if (issue) {
    result.createdDate = null;
    result.createdDateIssue = issue;
  } else {
    delete result.createdDateIssue;
  }
  return result;
}

/** Invalid or omitted detail must not erase a known inventory creation date.
 * Other fields keep their existing detail precedence. */
export function mergeDomainDetail<T extends Partial<Domain>>(
  base: T,
  detail: Partial<Domain>,
  now = Date.now(),
): T & Partial<Domain> {
  const listed = qualifyCreationDate(base, now);
  const extra = qualifyCreationDate(detail, now);
  const result = { ...listed, ...extra };
  result.createdDate = extra.createdDate ?? listed.createdDate ?? null;
  const issue =
    extra.createdDateIssue ??
    (extra.createdDate == null ? listed.createdDateIssue : undefined);
  if (issue) result.createdDateIssue = issue;
  else delete result.createdDateIssue;
  return qualifyCreationDate(result, now);
}
