import { useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Owned vs Archive (names you no longer own), leading the filter toolbar: a
 * dropdown that names the current list, with the counts in its menu so the
 * button stays narrow. Both labels share one grid cell so the button keeps
 * the wider one's width and the toolbar doesn't shift when it flips.
 */
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
    { id: 'owned', label: 'Owned', count: ownedCount, onSelect: onOwned },
    {
      id: 'archive',
      label: 'Archive',
      count: archiveCount,
      onSelect: onArchive,
    },
  ];
  const current = archive ? 'archive' : 'owned';
  // Picked with the pointer: don't hand focus back to the button, where it
  // would show a focus ring. A keyboard pick still returns there.
  const byPointer = useRef(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          title="Owned domains or former domains"
          className="gap-1.5 pr-2.5"
        >
          <span className="grid">
            {options.map((o) => (
              <span
                key={o.id}
                className={cn(
                  'col-start-1 row-start-1 text-left',
                  o.id !== current && 'invisible',
                )}
              >
                {o.label}
              </span>
            ))}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44"
        onPointerDown={() => (byPointer.current = true)}
        onCloseAutoFocus={(e) => {
          if (byPointer.current) e.preventDefault();
          byPointer.current = false;
        }}
      >
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(id) => options.find((o) => o.id === id)?.onSelect()}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id}>
              {o.label}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {o.count.toLocaleString('en-US')}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
