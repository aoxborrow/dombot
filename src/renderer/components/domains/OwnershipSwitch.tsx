import type { ReactNode } from 'react';
import { Archive, Globe } from 'lucide-react';
import { ViewSwitch } from '../data-table/Toolbar';

/** Small caps, like the table's column names, so the two read as labels. */
function SmallCaps({ children }: { children: ReactNode }) {
  return <span className="text-xs tracking-wider uppercase">{children}</span>;
}

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
          label: <SmallCaps>Active</SmallCaps>,
          icon: Globe,
          count: ownedCount,
          active: !archive,
          onClick: onOwned,
        },
        {
          id: 'archive',
          label: <SmallCaps>Archive</SmallCaps>,
          icon: Archive,
          count: archiveCount,
          active: archive,
          onClick: onArchive,
        },
      ]}
    />
  );
}
