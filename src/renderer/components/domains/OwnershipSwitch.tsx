import { Archive, Globe, Tag } from 'lucide-react';
import { ToolbarSwitch } from '../data-table/FilterToolbar';
import type { DomainsView } from './DomainsCards';

/**
 * Owned, Listings (the same names with their market columns; once a market
 * account is connected) and Archive (names you no longer own), leading the
 * filter toolbar.
 */
export function OwnershipSwitch({
  view,
  ownedCount,
  listedCount,
  archiveCount,
  listings,
  onView,
}: {
  view: DomainsView;
  ownedCount: number;
  /** Owned names live on a market: Listings shows every owned name, but
   * its count is what's listed. */
  listedCount: number;
  archiveCount: number;
  /** Whether Listings is offered. */
  listings: boolean;
  onView: (view: DomainsView) => void;
}) {
  return (
    <ToolbarSwitch
      fillOnPhone
      label="Owned domains, their market listings, or archived domains"
      // Three don't fit a phone with their counts.
      className={listings ? 'max-sm:[&_.tabular-nums]:hidden' : undefined}
      options={[
        {
          id: 'owned',
          label: 'Owned',
          icon: Globe,
          count: ownedCount,
          active: view === 'owned',
          onClick: () => onView('owned'),
        },
        ...(listings
          ? [
              {
                id: 'listings',
                label: 'Listings',
                icon: Tag,
                count: listedCount,
                active: view === 'listings',
                onClick: () => onView('listings'),
              },
            ]
          : []),
        {
          id: 'archive',
          label: 'Archive',
          icon: Archive,
          count: archiveCount,
          active: view === 'archive',
          onClick: () => onView('archive'),
        },
      ]}
    />
  );
}
