import { useState } from 'react';
import { EyeOff, FolderPlus } from 'lucide-react';
import type { Folder } from '../../../shared/ipc';
import { folderColorStyle } from '../../lib/folders';
import { FolderIcon } from '../icons/FolderIcon';
import { FolderOffIcon } from '../icons/FolderOffIcon';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NONE = '__none__';
const NEW = '__new__';

/**
 * Pick a folder by name, with the icons and colors of the Folder filter:
 * one of yours, Hidden, or a new one typed in. The value is the folder's
 * name ("" for none); a name that isn't a folder yet is created by whatever
 * saves it.
 */
export function FolderSelect({
  value,
  onChange,
  folders,
  noneLabel = 'No folder',
  id,
}: {
  value: string;
  onChange: (name: string) => void;
  folders: Folder[];
  /** The empty choice, e.g. "No folder" or "From the file". */
  noneLabel?: string;
  id?: string;
}) {
  const known = (name: string) =>
    name.trim().toLowerCase() === 'hidden' ||
    folders.some((f) => f.name.toLowerCase() === name.trim().toLowerCase());
  const [creating, setCreating] = useState(value !== '' && !known(value));
  const icon = 'size-4 shrink-0';

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={creating ? NEW : value === '' ? NONE : value}
        onValueChange={(v) => {
          setCreating(v === NEW);
          onChange(v === NONE || v === NEW ? '' : v);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            <FolderOffIcon
              className={cn(icon, 'text-muted-foreground/50')}
              aria-hidden
            />
            {noneLabel}
          </SelectItem>
          {folders.map((f) => (
            <SelectItem key={f.id} value={f.name}>
              <FolderIcon
                className={cn(icon, folderColorStyle(f.color).text)}
                aria-hidden
              />
              {f.name}
            </SelectItem>
          ))}
          <SelectItem value="Hidden">
            <EyeOff className={icon} aria-hidden />
            Hidden
          </SelectItem>
          <SelectSeparator />
          <SelectItem value={NEW}>
            <FolderPlus className={icon} aria-hidden />
            New folder…
          </SelectItem>
        </SelectContent>
      </Select>
      {creating && (
        <Input
          autoFocus
          aria-label="New folder name"
          placeholder="Folder name"
          maxLength={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
