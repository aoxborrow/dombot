# Folders

A planning doc for adding **folders** — a lightweight way to organize domains into
named, colored groups (think Gmail labels). This first cut is deliberately small:
a folder is just a name, a short description, and a color. But it's designed so
that folders can later carry **per-folder settings** that cascade to their
domains (the motivating example: marking a folder — and therefore its domains —
as "for sale").

## Goals

- Create, edit, and delete folders (name, description, color).
- Assign each domain to **at most one** folder, from the Domains table.
- Show the assigned folder as a colored chip in the Domains table.
- Filter the table by folder (including an "Unassigned" bucket).
- Configure folders on a new **Settings → Folders** tab.
- Persist everything on disk as **user data** (survives a cache clear), following
  the same pattern as manual renewal-price overrides.

## Non-goals (for this cut)

- Many-to-many labels (a domain in multiple folders). We start one-to-one and
  note below how to grow to many-to-many if we want it.
- Actual per-folder behavior (e.g. "for sale"). We only lay the data groundwork
  so it's a small, additive change later.
- Bulk multi-row assignment, drag-and-drop, nested folders, MCP exposure. All
  listed under [Future work](#future-work).

## Design decisions

- **One folder per domain.** The request says "display *the assigned folder*"
  (singular), and "folder" reads as a container, not a tag. A domain has at most
  one folder; a folder has many domains. This keeps the assignment a simple
  `domainKey → folderId` map. See [Future work](#future-work) for the
  many-to-many path.
- **Folders are user data, not cache.** They live beside `pricing-overrides.json`
  and must **not** be dropped by _Settings → Data → Clear cache_ (which only
  clears fetched/derived data). Same rule that already protects manual prices and
  registrar credentials.
- **Store a color _key_, not a hex value.** The renderer owns a fixed palette
  that maps each key to theme-aware Tailwind classes (light + dark), exactly like
  `LIFECYCLE_TONE` in [Domains.tsx](../src/renderer/pages/Domains.tsx). Main stays
  presentation-agnostic (the cache layer is already "type-agnostic"); only the
  renderer knows how a color looks.
- **Assignment key = `${registrar}:${domainName}`.** This is the existing stable
  per-domain key (`domainKey` in [store/app.ts](../src/renderer/store/app.ts) and
  the `${registrar}:${domain}` convention used by pricing). Reuse it verbatim so
  folders line up with detail/pricing maps.
- **Settings namespaced for the future.** Per-folder config goes in a nested
  `settings` bag (`{ forSale?: boolean; ... }`), not flat top-level fields, so we
  can add config without colliding with core folder fields and can define a clean
  "effective config" resolution (folder settings today; per-domain overrides
  layered on later).

## Data model

New shared types in [src/shared/ipc.ts](../src/shared/ipc.ts):

```ts
/** Palette key for a folder's color. The renderer maps this to theme-aware
 *  classes; main only ever stores/returns the key. */
export type FolderColor =
  | 'gray'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink';

/** Future per-folder config that cascades to the folder's domains. Kept as an
 *  optional bag so new keys are additive. Empty/absent today. */
export interface FolderSettings {
  /** Marks the folder's domains as listed for sale. Not yet acted on. */
  forSale?: boolean;
  // future: autoRenew?: boolean; nameserverProfile?: string; ...
}

/** A user-defined folder for organizing domains. */
export interface Folder {
  /** Stable id (crypto.randomUUID() in main). */
  id: string;
  name: string;
  /** Short, may be empty. */
  description: string;
  color: FolderColor;
  /** Per-folder config; absent until we add features that use it. */
  settings?: FolderSettings;
}

/** Everything the renderer restores on launch: the folder definitions plus the
 *  domain→folder map (keyed `${registrar}:${domainName}`). Mirrors the shape of
 *  CachedSnapshot. */
export interface FoldersSnapshot {
  folders: Folder[];
  /** domainKey → folderId. A domain absent from the map is unassigned. */
  assignments: Record<string, string>;
}
```

Notes:

- `folders` is an **array** so display order is explicit (creation order, and a
  future reorder feature just permutes it).
- `assignments` only records assigned domains; unassigned = absent key. Orphaned
  entries (a domain that left the portfolio, or a folder id that was deleted) are
  harmless; deletion cleans up the folder's entries, and we can optionally prune
  keys not present in the current portfolio (kept for now — a transferred-away
  domain might come back).

## Persistence (main)

New service [src/main/services/folders.ts](../src/main/services/folders.ts),
modeled on the overrides half of
[services/pricing.ts](../src/main/services/pricing.ts): a single JSON file under
`app.getPath('userData')`, lazily loaded into a module cache, whole-file
`writeFileSync` on each mutation (the dataset is a handful of folders and at most
a few hundred assignments — the same scale pricing already rewrites wholesale).

- **File:** `folders.json` = `{ folders: Folder[]; assignments: Record<string,string> }`.
  One file keeps definitions and assignments atomic and makes delete-cleanup
  trivial. (Alternative: split into `folders.json` + `folder-assignments.json`
  like pricing's cache/overrides split — chosen against here for atomicity, but
  it's an easy swap if assignment writes ever get hot.)

Exported functions:

```ts
export function getFolders(): FoldersSnapshot;            // launch hydration
export function createFolder(input: {                     // returns the created folder
  name: string; description: string; color: FolderColor;
}): Folder;
export function updateFolder(                             // patch name/description/color/settings
  id: string,
  patch: Partial<Pick<Folder, 'name' | 'description' | 'color' | 'settings'>>,
): void;
export function deleteFolder(id: string): void;           // also drops assignments to it
export function assignFolder(                             // folderId null = unassign
  domainKey: string,
  folderId: string | null,
): void;
```

`deleteFolder` removes the definition **and** every assignment pointing at it, so
no dangling references survive. `assignFolder` validates that `folderId` exists
(unknown id → unassign, defensively).

## IPC wiring

Follow the existing feature-module pattern end to end:

- **Channels** — add to `IpcChannels` in [src/shared/ipc.ts](../src/shared/ipc.ts):
  `foldersList: 'folders:list'`, `foldersCreate: 'folders:create'`,
  `foldersUpdate: 'folders:update'`, `foldersDelete: 'folders:delete'`,
  `foldersAssign: 'folders:assign'`.
- **Handlers** — new [src/main/ipc/folders.ts](../src/main/ipc/folders.ts) with
  `registerFoldersIpc()`, called from
  [src/main/ipc/index.ts](../src/main/ipc/index.ts) (one line, next to the other
  `register*Ipc()` calls). Each handler is a thin wrapper over the service, like
  [ipc/pricing.ts](../src/main/ipc/pricing.ts).
- **Preload** — add methods to [src/preload.ts](../src/preload.ts) and to the
  `DombotApi` interface in [src/shared/ipc.ts](../src/shared/ipc.ts):

  ```ts
  getFolders: () => Promise<FoldersSnapshot>;
  createFolder: (input: { name: string; description: string; color: FolderColor }) => Promise<Folder>;
  updateFolder: (id: string, patch: Partial<Pick<Folder, 'name' | 'description' | 'color' | 'settings'>>) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  assignFolder: (domainKey: string, folderId: string | null) => Promise<void>;
  ```

## Renderer state (zustand)

Extend [src/renderer/store/app.ts](../src/renderer/store/app.ts):

```ts
folders: Folder[];
folderAssignments: Record<string, string>;   // domainKey → folderId
loadFolders: () => Promise<void>;             // called once on launch
createFolder: (input) => Promise<Folder>;
updateFolder: (id, patch) => Promise<void>;
deleteFolder: (id) => Promise<void>;          // updates local map too
assignFolder: (domainKey, folderId | null) => Promise<void>;
```

- `loadFolders` is invoked from [App.tsx](../src/renderer/App.tsx) alongside
  `hydrateFromCache`, so folders paint instantly on launch.
- Mutations call `window.api.*`, then update local `folders` /
  `folderAssignments` optimistically (or re-read the snapshot — start with a
  local update for snappiness, matching how `setManualPrice` writes back into the
  `pricing` map).
- `deleteFolder` must also strip any `folderAssignments` entries referencing it
  in the local map, mirroring the service.
- `clearAllCaches` **does not** touch `folders`/`folderAssignments` — folders are
  user data. (Verify the reset object in `clearAllCaches` omits them.)

## UI — colors

A small renderer lib [src/renderer/lib/folders.ts](../src/renderer/lib/folders.ts)
owns the palette, mirroring `LIFECYCLE_TONE`:

```ts
export const FOLDER_COLORS: Record<FolderColor, { chip: string; swatch: string; label: string }> = {
  blue:   { label: 'Blue',   swatch: 'bg-blue-500',   chip: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' },
  // …one row per key, each with light + dark classes…
};
export const FOLDER_COLOR_KEYS = Object.keys(FOLDER_COLORS) as FolderColor[];
export function folderChipClasses(color: FolderColor): string { /* fallback to gray for unknown keys */ }
```

- `chip` styles the table badge; `swatch` is the solid dot used in the color
  picker and the folder-select menu; `label` is the human name.
- An unknown/legacy key falls back to `gray` so a hand-edited file never crashes
  rendering.

## UI — Domains table

The **Folder** column joins the two columns that already live outside the static
`COLUMNS` array (Afternic and Renewal), because its data comes from store maps,
not the `Domain` object, and its cell needs an interactive assign control. Follow
that exact injected-column pattern in
[Domains.tsx](../src/renderer/pages/Domains.tsx):

- **Placement:** after the Registrar column (a natural "organizational" slot).
- **Header:** a sortable header using a `FOLDER` sentinel, like the `AFTERNIC` /
  `RENEWAL` sentinels already used in `toggleSort` and the `valueOf` switch.
- **Cell:** a `FolderCell` that reads the domain's assignment
  (`folderAssignments[domainKey]`) and the `folders` list:
  - **Assigned →** a colored `Badge` (folder name) using `folderChipClasses`,
    clickable to open the assign menu.
  - **Unassigned →** a muted, low-emphasis affordance (e.g. a small outline
    "Assign" / a `—` that reveals a control on hover), also opening the menu.
  - **Assign menu:** a `DropdownMenu` (already imported) listing every folder
    (radio-style single choice, with its color swatch), a **None** entry to
    clear, and a **New folder…** shortcut that routes to Settings → Folders.
    Calls `assignFolder(domainKey, folderId | null)`.
- **Sorting:** in the `valueOf` switch, `FOLDER` → the folder's display **name**
  (or its index in `folders`); unassigned returns `null` so it sorts last, per
  the existing null-sorts-last rule.

> Optional refactor (not required for v1): generalize the `Column` model to pass
> a context object (`{ labels, folders, assignments, aftermarket, pricing,
> onAssign }`) to `render`/`sortValue`, so Afternic, Renewal, and Folder stop
> being special-cased inline. Nice cleanup, but bigger blast radius — keep v1 to
> the established injected pattern to stay low-risk.

## UI — Folder filter

Reuse the existing `MultiSelectFilter` (as TLD/Registrar/Expiration/Nameservers
do). Add a **Folder** filter to the toolbar:

- **Options:** one per folder — `{ value: folder.id, label: folder.name, count }`
  where `count` is domains currently assigned to it (derive from
  `folderAssignments`, like the nameserver-group counts) — plus a special
  **Unassigned** option (`value: '__unassigned__'`).
- **Predicate:** with a non-empty selection, keep a domain whose assignment is in
  the selection; a domain with no assignment matches only when `__unassigned__`
  is selected. Slots into the existing `filtered` `useMemo` next to the other
  filters, and resets `page` to 0 on change like the rest.

## UI — Settings → Folders

New tab in [Settings.tsx](../src/renderer/pages/Settings.tsx) (a `TabsTrigger` +
`TabsContent`, placed before **Data**) and a new page
[src/renderer/pages/settings/FoldersSettings.tsx](../src/renderer/pages/settings/FoldersSettings.tsx),
structured like [RegistrarsSettings](../src/renderer/pages/settings/RegistrarsSettings.tsx):

- Header + one-line description.
- **New folder** button → an inline form / dialog: name (required), description
  (optional), color picker (a row of swatch buttons from `FOLDER_COLORS`).
- A list of folder cards/rows, each showing the color swatch, name, description,
  and its **domain count**, with **Edit** (same form) and **Delete**.
- **Delete** confirms first, and the confirm text notes that its domains will
  become unassigned (it removes assignments, not domains).
- **Empty state** when no folders exist yet: "Create your first folder to start
  organizing your domains."

## Cross-cutting

- **CSV export** — add a "Folder" column to `domainsToCsv` in
  [src/renderer/lib/csv.ts](../src/renderer/lib/csv.ts) (it already receives
  registrar labels and aftermarket; pass `folders` + `assignments` too, emit the
  folder name or empty).
- **Launch** — `loadFolders()` in [App.tsx](../src/renderer/App.tsx)'s mount
  effect, next to `hydrateFromCache()`.
- **Clear cache safety** — confirm `clearAllCaches` (store + `ipc/cache.ts`)
  leaves `folders.json` untouched, and optionally add a sentence to
  [DataSettings.tsx](../src/renderer/pages/settings/DataSettings.tsx) clarifying
  that folders (like credentials and manual prices) are preserved.

## Implementation phases

Each phase is independently reviewable; typecheck, lint, and prettier stay clean
throughout, and the app is launched to verify at the end (per the repo workflow —
work in a git worktree on a feature branch and open a PR).

1. **Types + service.** `Folder`/`FolderColor`/`FolderSettings`/`FoldersSnapshot`
   in shared/ipc; `services/folders.ts` with load/persist + CRUD + assign.
2. **IPC + preload.** Channels, `ipc/folders.ts` + registration, preload methods,
   `DombotApi` signatures.
3. **Store + launch.** State, actions, `loadFolders` wired into App.tsx; verify
   `clearAllCaches` preserves folders.
4. **Settings → Folders.** Tab + CRUD page + color picker.
5. **Table integration.** Color lib, `FolderCell` + assign menu, injected Folder
   column + sort sentinel.
6. **Filter.** Folder `MultiSelectFilter` with the Unassigned bucket + counts.
7. **Polish.** CSV column, empty states, DataSettings copy, a11y labels; launch
   and smoke-test create → assign → filter → delete.

## Future work

Groundwork this design intentionally leaves room for:

- **Per-folder settings that act on domains.** The motivating case: a `forSale`
  flag on `FolderSettings`. The model would be an **effective config** resolver —
  a domain inherits its folder's `settings`, with room to layer a per-domain
  override on top later. A "For sale" column/filter and a folder-settings section
  in the folder edit form drop in without schema churn.
- **Per-domain overrides** of inherited folder settings (the override layer
  above).
- **Many-to-many labels.** Change `assignments` to
  `Record<string, string[]>` and the cell to render multiple chips; the filter
  predicate becomes "intersects selection". A one-time migration wraps each
  existing value in an array.
- **Bulk assignment** — row selection in the table + an "Assign to folder…"
  action.
- **Reordering / nesting** folders.
- **MCP exposure** — surface a domain's folder (and eventually `forSale`) through
  the embedded MCP tools (e.g. include it in `list_portfolio`, or add a folders
  tool), so agents can organize and query by folder too.
</content>
</invoke>
