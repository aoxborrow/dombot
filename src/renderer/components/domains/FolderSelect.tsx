import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NONE = '__none__';
const NEW = '__new__';

/**
 * Pick a folder by name: one of yours, Hidden, or a new one typed in. The
 * value is the folder's name ("" for none); a name that isn't a folder yet
 * is created by whatever saves it.
 */
export function FolderSelect({
  value,
  onChange,
  folderNames,
  noneLabel = 'No folder',
  id,
}: {
  value: string;
  onChange: (name: string) => void;
  folderNames: string[];
  /** The empty choice, e.g. "No folder" or "From the file". */
  noneLabel?: string;
  id?: string;
}) {
  const known = (name: string) =>
    name.trim().toLowerCase() === 'hidden' ||
    folderNames.some((f) => f.toLowerCase() === name.trim().toLowerCase());
  const [creating, setCreating] = useState(value !== '' && !known(value));

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
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {folderNames.map((f) => (
            <SelectItem key={f} value={f}>
              {f}
            </SelectItem>
          ))}
          <SelectItem value="Hidden">Hidden</SelectItem>
          <SelectSeparator />
          <SelectItem value={NEW}>New folder…</SelectItem>
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
