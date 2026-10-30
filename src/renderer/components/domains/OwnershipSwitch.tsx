import { Archive, Globe, Store } from 'lucide-react';
import { ToolbarSwitch } from '../data-table/FilterToolbar';
import type { DomainsView } from './DomainsCards';

/**
 * Active, Listings (the same names with their market columns; once a market
 * account is connected) and Archive (names you no longer own), leading the
 * filter toolbar.
 */
export function OwnershipSwitch({
  view,
  ownedCount,
  archiveCount,
  listings,
  onView,
}: {
  view: DomainsView;
  ownedCount: number;
  archiveCount: number;
  /** Whether Listings is offered. */
  listings: boolean;
  onView: (view: DomainsView) => void;
}) {
  return (
    <ToolbarSwitch
      label="Active domains, their market listings, or archived domains"
      // Three don't fit a phone with their counts.
      className={listings ? 'max-sm:[&_.tabular-nums]:hidden' : undefined}
      options={[
        {
          id: 'active',
          label: 'Active',
          icon: Globe,
          count: ownedCount,
          active: view === 'active',
          onClick: () => onView('active'),
        },
        ...(listings
          ? [
              {
                id: 'listings',
                label: 'Listings',
                icon: Store,
                count: ownedCount,
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
