import type { Domain, PortfolioChange } from '../../shared/ipc';
import {
  ARCHIVE_FOLDER_ID,
  DROPPED_FOLDER_ID,
  SOLD_FOLDER_ID,
} from '../../shared/ipc';
import { domainKey } from '../../shared/account-key';

/**
 * Rows for names that left and were filed in Sold, Dropped, or Archive.
 * They are not in the registrar list. The Domains History view shows all
 * three together; its folder filter narrows to one.
 * A move between the user's accounts is not one of these rows.
 * Created and expires start empty here. The History view fills them from
 * the public registration lookup, and shows a dash when the name is free.
 */
export function departedDomains(
  changes: PortfolioChange[],
  live: Domain[],
  assignments: Record<string, string>,
): Domain[] {
  const liveKeys = new Set(live.map((domain) => domainKey(domain)));
  const seen = new Set<string>();
  const rows: Domain[] = [];
  for (const change of changes) {
    const folderId =
      change.resolution === 'sold'
        ? SOLD_FOLDER_ID
        : change.resolution === 'dropped'
          ? DROPPED_FOLDER_ID
          : change.resolution === 'archive'
            ? ARCHIVE_FOLDER_ID
            : null;
    if (!folderId || !change.fromAccountId || !change.fromRegistrar) continue;
    const key = `${change.fromAccountId}:${change.domainName}`;
    if (liveKeys.has(key) || seen.has(key)) continue;
    if (assignments[key] !== folderId) continue;
    seen.add(key);
    rows.push({
      registrar: change.fromRegistrar as Domain['registrar'],
      accountId: change.fromAccountId,
      accountLabel: change.fromLabel ?? undefined,
      domainName: change.domainName,
      status: '',
      createdDate: null,
      expirationDate: null,
      renewalDate: null,
      autoRenew: false,
      locked: false,
      privacy: false,
      nameservers: [],
      syncedAt: new Date(change.at),
      deleted: false,
      departed: true,
    });
  }
  return rows;
}
