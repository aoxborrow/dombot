import type { ReactNode } from 'react';
import { Archive, Globe, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ViewSwitch } from '../data-table/Toolbar';

/** Small caps, like the table's column names, so the two read as labels. */
function SmallCaps({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] tracking-wider uppercase">{children}</span>
  );
}

/** The icon a size under the switch's default, to suit the small caps. */
const small = (Icon: LucideIcon) =>
  function SmallIcon({ className }: { className?: string }) {
    return <Icon className={cn(className, 'size-3.5')} />;
  };
const ActiveIcon = small(Globe);
const ArchiveIcon = small(Archive);

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
      // Tighter round the smaller icon (a pixel off each side) and squarer
      // segments than the switch's default.
      className="[&_[role=radio]]:gap-[7px] [&_[role=radio]]:rounded-[3px] [&_[role=radio]]:pl-[11px]"
      options={[
        {
          id: 'owned',
          label: <SmallCaps>Active</SmallCaps>,
          icon: ActiveIcon,
          count: ownedCount,
          active: !archive,
          onClick: onOwned,
        },
        {
          id: 'archive',
          label: <SmallCaps>Archive</SmallCaps>,
          icon: ArchiveIcon,
          count: archiveCount,
          active: archive,
          onClick: onArchive,
        },
      ]}
    />
  );
}
