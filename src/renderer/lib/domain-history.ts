import { accountDisplayLabel } from '../../shared/account-label';
import type { RegistrarMeta } from '../../shared/ipc';
import type { ArchiveLabel } from '../../shared/ownership';

// Renderer helpers over the domain event log: the words for Archive labels
// and accounts. The rows Archive shows for names no longer in any account are
// built in shared/ownership.ts.

export const ARCHIVE_LABEL: Record<ArchiveLabel, string> = {
  sold: 'Sold',
  dropped: 'Dropped',
  archived: 'Archived',
  removed: 'Removed',
};

/** "GoDaddy #2" for an account id, or null when it's gone from Settings. */
export function accountName(
  registrars: RegistrarMeta[] | null,
  accountId: string | null | undefined,
): string | null {
  if (!accountId) return null;
  const meta = registrars?.find((r) => (r.accountId ?? r.name) === accountId);
  if (!meta) return null;
  const siblings = registrars!.filter((r) => r.name === meta.name && r.saved);
  return siblings.length > 1 && meta.accountLabel
    ? `${meta.displayName} ${accountDisplayLabel(meta.accountLabel)}`
    : meta.displayName;
}
