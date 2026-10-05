import { ViewSwitch } from '../data-table/Toolbar';

/** Active vs Archive (names you no longer own), leading the filter toolbar. */
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
      label="Active domains or archived domains"
      className=""
      options={[
        {
          id: 'owned',
          label: 'Active',
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
