import { cn } from '@/lib/utils';

/** Owned vs Archive (names you no longer own), same segmented style as the theme switch. */
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
  const options = [
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
  ] as const;

  return (
    <div
      role="radiogroup"
      aria-label="Owned domains or former domains"
      className="mt-1 inline-flex items-center gap-1 self-start rounded-lg border p-1 text-sm sm:mt-[7px]"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.active}
          onClick={option.onClick}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-md px-3 font-medium text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-accent/50',
            option.active && 'bg-foreground/10 text-foreground dark:bg-accent',
          )}
        >
          {option.label}
          <span
            className={cn(
              'tabular-nums',
              option.active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {option.count}
          </span>
        </button>
      ))}
    </div>
  );
}
