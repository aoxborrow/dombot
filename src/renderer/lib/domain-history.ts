import { accountDisplayLabel } from '../../shared/account-label';
import { toAscii, toUnicode } from '../../shared/domain-name';
import type { Domain, RegistrarMeta } from '../../shared/ipc';
import type { ArchiveLabel, Ownership } from '../../shared/ownership';

// Renderer helpers over the domain event log: the rows Archive shows for
// names no longer in any account, and the words for labels and accounts.

export const ARCHIVE_LABEL: Record<ArchiveLabel, string> = {
  sold: 'Sold',
  dropped: 'Dropped',
  archived: 'Archived',
  left: 'Left your accounts',
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

/**
 * Rows for names in Archive that no registrar reports any more. They carry
 * the account the name was last seen in; created and expires start empty and
 * the Archive view fills them from the public registration lookup.
 */
export function archiveRows(
  ownership: Map<string, Ownership>,
  live: Domain[],
  registrars: RegistrarMeta[] | null,
): Domain[] {
  const held = new Set(live.map((d) => toAscii(d.domainName)));
  const rows: Domain[] = [];
  for (const [name, o] of ownership) {
    if (!o.archived || held.has(name)) continue;
    const meta = registrars?.find(
      (r) => (r.accountId ?? r.name) === o.lastAccountId,
    );
    rows.push({
      registrar: (meta?.name ?? '') as Domain['registrar'],
      accountId: o.lastAccountId ?? undefined,
      accountLabel: meta?.accountLabel,
      domainName: toUnicode(name),
      status: '',
      createdDate: null,
      expirationDate: null,
      renewalDate: null,
      autoRenew: false,
      locked: false,
      privacy: false,
      nameservers: [],
      syncedAt: new Date(o.event?.createdAt ?? 0),
      deleted: false,
      departed: true,
    });
  }
  return rows;
}
