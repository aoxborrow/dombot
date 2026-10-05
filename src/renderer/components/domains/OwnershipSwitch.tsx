import { Archive, Globe } from 'lucide-react';
import { ToolbarSwitch } from '../data-table/FilterToolbar';

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
    <ToolbarSwitch
      label="Active domains or archived domains"
      options={[
        {
          id: 'owned',
          label: 'Active',
          icon: Globe,
          count: ownedCount,
          active: !archive,
          onClick: onOwned,
        },
        {
          id: 'archive',
          label: 'Archive',
          icon: Archive,
          count: archiveCount,
          active: archive,
          onClick: onArchive,
        },
      ]}
    />
  );
}
