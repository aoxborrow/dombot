import {
  SOLD_FOLDER_ID,
  builtInFolderName,
  isHiddenFolder,
} from '../../shared/ipc';

export type FolderMovePlan =
  | { action: 'noop' }
  | { action: 'apply' }
  | { action: 'sold' }
  | {
      action: 'confirm';
      title: string;
      description: string;
      actionLabel: string;
    };

/**
 * What clicking a folder should do for the names that are not already there.
 * Sold opens the sale dialog. Dropped, Archive, and a return to Owned ask
 * first. A normal folder change applies immediately.
 */
export function planFolderMove(
  currentFolderIds: (string | null)[],
  nextFolderId: string | null,
  names: string[],
  destinationName: string | null,
): FolderMovePlan {
  if (names.length === 0) return { action: 'noop' };
  if (nextFolderId === SOLD_FOLDER_ID) return { action: 'sold' };

  const sourcesHidden = currentFolderIds.map((id) => isHiddenFolder(id));
  const anyHidden = sourcesHidden.some(Boolean);
  const nextHidden = isHiddenFolder(nextFolderId);
  if (!anyHidden && !nextHidden) return { action: 'apply' };

  const one = names.length === 1;
  const title = one ? names[0] : `${names.length} domains`;

  if (!nextHidden) {
    const placed = destinationName ? `, in ${destinationName}` : '';
    return {
      action: 'confirm',
      title,
      description: one
        ? `Show this name in Owned again${placed}? Sale and purchase details stay saved.`
        : `Show these ${names.length} domains in Owned again${placed}? Sale and purchase details stay saved.`,
      actionLabel: 'Show in Owned',
    };
  }

  const label = builtInFolderName(nextFolderId) ?? 'Archive';
  const allHidden = sourcesHidden.every(Boolean);
  const leavingSold = currentFolderIds.some((id) => id === SOLD_FOLDER_ID);
  const where = allHidden
    ? one
      ? 'It stays in History.'
      : 'They stay in History.'
    : anyHidden
      ? one
        ? 'It shows under History.'
        : 'They show under History.'
      : one
        ? 'It leaves Owned and shows under History. You can move it back later.'
        : 'They leave Owned and show under History. You can move them back later.';
  const sale = leavingSold ? ' Sale details already saved stay saved.' : '';
  return {
    action: 'confirm',
    title,
    description: one
      ? `Move this name to ${label}? ${where}${sale}`
      : `Move these ${names.length} domains to ${label}? ${where}${sale}`,
    actionLabel: `Move to ${label}`,
  };
}
