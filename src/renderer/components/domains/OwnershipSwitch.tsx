import { ViewSwitch } from '../data-table/Toolbar';

/** Owned vs Archive (names you no longer own), leading the filter toolbar. */
export function OwnershipSwitch({
  archive,
  ownedCount,
  archiveCount,
  onOwned,
  onArchive,
}: {
  archive: boolean;
  ownedCount: number;
  archiveCount: number;
  onOwned: () => void;
  onArchive: () => void;
}) {
  return (
    <ViewSwitch
      label="Owned domains or former domains"
      className=""
      options={[
        {
          id: 'owned',
          label: 'Owned',
          count: ownedCount,
          active: !archive,
          onClick: onOwned,
        },
        {
          id: 'archive',
          label: 'Archive',
          count: archiveCount,
          active: archive,
          onClick: onArchive,
        },
      ]}
    />
  );
}
