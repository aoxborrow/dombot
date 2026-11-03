import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useNarrowScreen } from '../../lib/narrow-screen';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * A submenu of the row and bulk menus. On a phone there's no room beside the
 * menu for it (Radix won't shift a submenu sideways, so it ran off the
 * screen), so there it opens in place instead: the trigger toggles its items
 * in, indented under it, and the menu stays open. The menu itself scrolls
 * when that makes it too tall; the items get no scroll box of their own.
 */
export function MenuSub({
  icon,
  label,
  disabled,
  title,
  contentClassName = 'w-56',
  children,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  /** The trigger's tooltip, e.g. why it's disabled. */
  title?: string;
  /** Classes on the submenu beside the menu (its width). */
  contentClassName?: string;
  children: ReactNode;
}) {
  const narrow = useNarrowScreen();
  const [open, setOpen] = useState(false);

  if (!narrow)
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled} title={title}>
          {icon}
          {label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={contentClassName}>
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );

  return (
    <>
      <DropdownMenuItem
        disabled={disabled}
        title={title}
        aria-expanded={open}
        onSelect={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {icon}
        {label}
        <ChevronDown
          className={cn(
            'ml-auto size-4 transition-transform',
            open && 'rotate-180',
          )}
        />
      </DropdownMenuItem>
      {open && <div className="ml-[15px] border-l pl-1">{children}</div>}
    </>
  );
}
