# Activity and notifications redesign

A planning doc for bringing the Activity page and the header bell up to the
Domains page's standard. The domain history in #106 works, but its Activity
page is a basic table, the bell carries every action inline, and alerts,
errors, and information are mixed together. This doc collects the decisions
made so far and the order of the work.

Builds on the domain event log (`docs/storage-model.md`). The work lands as
PRs stacked on #106 (branch `domain-events`) while #106 is open.

Status: phase 1 (sync errors) is merged into `domain-events` (#113), and so
is the change that makes arrivals the lowest-priority alert. How sync errors
show in the bell is revisited with the bell redesign (phase 6). Everything
else is planned.

## Goals

- **One table.** Activity gets the Domains table's column sorting, bulk
  selection, scrolling, pagination, and sticky header, because both use the
  same component.
- **One page layout.** Activity matches Domains: title and a top-right
  switch, then a toolbar with search on the left, filters on the right, and
  Reset.
- **Clear severity.** You can tell at a glance what needs you, how urgently,
  and what's only history.
- **Bulk review.** Act on many alerts at once, e.g. mark 20 names that left
  a registrar as Dropped.
- **One set of dialogs.** Single and bulk actions use the same dialog
  components, titled by the action.
- **A quiet bell.** The bell summarizes and points to Activity; it doesn't
  carry actions. It has to stay usable with a large portfolio.

## Non-goals

- New event types or storage changes. Everything here reads the event log as
  it is.
- The follow-up features (manual domains #108, venues #109, installments
  #110, MCP #111). They'll plug into the table and dialogs built here.

## Severity and notifications

Two separate questions:

1. **Does it need you?** Only an open alert does: an unresolved `removed`
   (a name left an account) or `added` (a name arrived). Everything else —
   moves, sales and purchases you recorded, later renewals — is history. It
   shows in Activity and never notifies.
2. **How urgently?** Among the things that need you:

| Severity | What                              | Why                                                             |
| -------- | --------------------------------- | --------------------------------------------------------------- |
| Error    | A registrar account's sync failed | Something is broken, and the portfolio may be missing names     |
| High     | A name left an account            | You need to find out what happened: sold, dropped, transferred? |
| Low      | A name arrived                    | It still needs review, but only to record what you paid         |

There's no "info" severity. Info is the absence of one.

**Where each piece lives:**

- **Review priority is one shared function.** `reviewPriority(event)` returns
  `'high' | 'low' | null`. Activity uses it for row highlighting, the priority
  badge, and the Priority filter. It isn't stored on events, so priorities
  can change later (or new kinds can be added, like "expiring with auto-renew
  off") without a migration.
- **Notifications are what needs you now.** They're open reviews at their
  priority, plus sync errors at `error`, which only notifications have. They
  come from the event log and each account's sync status and are never
  stored. Dismissing still lives on the event, and a sync error clears
  itself when the account's next sync succeeds.

```ts
interface Notification {
  id: string; // the event id, or `sync:<accountId>`
  severity: 'error' | 'high' | 'low';
  kind: 'sync-error' | 'departure' | 'arrival';
  at: number; // ms epoch: when recorded, or the failed sync
  accountId: string | null;
  domain: string | null;
  eventId: string | null;
  message: string;
}
```

- **One list for every consumer.** The bell, the Activity page's counts, and
  later MCP (#111) all read `notifications(events, registrars)` from shared
  code.
- **Sync errors are never Activity rows.** They're an account's current
  state, not something that happened to a domain.

## Sync errors (done, #113)

The error details live on the account's card in Settings → Registrars.
Everywhere else says which accounts failed and points there.

- **Domains banner:** one line: "Registrars failed to sync: Namecheap,
  Spaceship · Open registrar settings" (`SyncErrorsAlert`, using the tinted
  `error` variant of `Alert`).
- **Settings → Registrars:** failing accounts are listed first. Each shows
  its last error as a bordered banner under the card header, whether the
  card is open or collapsed.
- **Status bar:** the sync pill shows an error icon and is red when an
  account's sync failed, or amber when an account hasn't synced yet. It
  links to registrar settings.
- **Bell:** one line per failed account, no link.

## The table component

Extract a shared table from `pages/Domains.tsx`, which is about 2,250 lines
and hand-built, then move Domains onto it with no visible change before
Activity uses it. Any regression shows up on a page that's already known to
work.

- **What's shared:**
  - column definitions (header, cell, sort value, alignment, width);
  - sorting with the current direction;
  - row selection: checkbox, shift-click ranges, select all filtered;
  - the sticky header;
  - horizontal and vertical scrolling;
  - pagination with rows per page;
  - the bulk bar slot;
  - an optional per-row menu slot;
  - the empty-state row.
- **What stays page-specific:** filters, the data itself, special columns
  (Folder, Renewal), and the row menus' contents.
- **Why our own component, not a library:** the current behavior (shift
  select, the sticky header, the Folder and Renewal columns) is already
  tuned, and TanStack Table would mean a rewrite rather than an extraction.
  The split can follow TanStack's headless shape: hooks for sort, selection,
  and paging, plus a presentational table.

## Action dialogs

- **One dialog layout.** A title naming the action ("Mark as Dropped",
  "Record purchase"), a subtitle with what it applies to ("example.com" or
  "20 domains"), the form, and Cancel plus the action button. This replaces
  the narrow dialogs whose title is the domain name.
- **One component per action,** taking one target or many:
  - Record purchase and Record sale (with "mark as Sold" and no price, for
    bulk);
  - Dropped and Archived;
  - Move back to Owned;
  - Dismiss and bring back;
  - Delete.
- **Shared by every entry point:** the Domains row menu, the Domains bulk
  bar, Activity rows, and the Activity bulk bar.
- **Dates default to today.** Every date field in an action dialog starts at
  today's date; you change it if the event happened on another day.
- **Batch APIs underneath.** For example
  `setDispositions(items: {domain, resolves?}[], type)` writes one
  `putEvents` batch instead of one call per name. The same goes for dismiss,
  Sold, and restore.

## Activity page

### Layout

- **Title row:** "Activity", the tracking-since line, and the Needs review /
  All switch at the top right, where Owned / Archive sits on Domains.
- **Toolbar:** search on the left, filters on the right, then Reset.
- **Filters:**
  - Priority: High, Low.
  - Type: Arrived, Left, Moved, Purchased, Registered, Sold, Dropped,
    Archived, Renewed.
  - Account: a registrar account.
  - Source: You, Registrar sync, Import, Lookup (later Agent).
  - Date: presets only — last 7, 14, 30, 90, or 180 days.

### Columns

| Column  | Content                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------- |
| ☐       | Selection                                                                                          |
| Date    | The event's day; the exact time on hover                                                           |
| Domain  | The name (Unicode)                                                                                 |
| Type    | A colored badge: Arrived, Left, Moved, Sold, …                                                     |
| Account | Registrar logo and account label; from → to for a move; blank when there's none                    |
| Details | Amount and currency, years, venue later                                                            |
| Source  | You, Registrar sync, Import, Lookup (renamed from "By"; "Sync" becomes "Registrar sync")           |
| Status  | Priority badge for open alerts; the outcome for closed ones (Sold, Came back, Dismissed) with Undo |
| Actions | The fixed action set                                                                               |

- **Open alerts stand out.** The row is tinted by priority, and the Status
  cell has a High or Low badge.
- **The same actions on every alert row:** Sold, Dropped, Archived, Record
  purchase. The ones that don't apply are grayed out: a departure can't
  record a purchase, an arrival can't be Sold. Dismiss is an X at the end.
- **The domain row menu:** reusing the Domains row menu on Activity rows is
  doable. It needs a domain row for names no account reports any more, and
  the Archive view already builds those (`archiveRows`). It comes last and is
  dropped if it gets messy.

### Bulk actions

With rows selected, a bulk bar like the Domains one offers Dropped, Archived,
Sold (no price), Dismiss, and later Record purchase with shared values. Each
opens the same dialog as the single action, titled for the count. The bulk
bar only offers actions that apply to every selected row, or it says how many
rows each action skips.

## The bell

- **Header:** "Notifications", with a link to Activity (the Activity icon)
  at the top right.
- **Body:** a compact list, one row per notification, errors first and then
  by severity and time. Each row shows a severity marker, the type badge, the
  domain (or account, for sync errors), and the time.
- **No action buttons.** A line like "5 need review" links to Activity
  filtered to Needs review.
- **Capped at about eight rows.** More shows as "and N more".
- **Recent moves drop out.** They're history, and Activity has them.
- **Badge:** it counts notifications and takes the most severe color: red
  for errors, amber for high, gray when only low-priority items are waiting.

## Phases

Each phase is a PR stacked on `domain-events`.

1. **Sync errors** — done, #113.
2. **Table component.** Extract it, and move Domains onto it with no visible
   change.
3. **Action dialogs and batch APIs.** The shared dialog layout, one component
   per action, and batch core and IPC methods. The Domains row menu and bulk
   bar switch to them.
4. **Notification model.** `reviewPriority`, `notifications()`, and tests.
   The bell and Activity counts read from them.
5. **Activity page.** Rebuilt on the table: layout, filters, columns, row
   highlighting, fixed actions, bulk bar, and the Source rename.
6. **Bell.** The compact list, with no actions and the Activity link in the
   header.
7. **Row menu on Activity** (optional). Reuse the Domains row menu.

Phases 2 and 3 are independent of each other, and 4 only needs the event log.
5 needs 2 to 4, and 6 needs 4.

## Testing

- **Unit tests:**
  - `reviewPriority` and `notifications()`: every event and outcome
    combination, plus sync errors;
  - the batch APIs: one write per batch, `resolves` kept per item;
  - the table hooks: sort, shift-select ranges, paging.
- **Demo checks for each phase:**
  - Seed more events: several departures and arrivals, and an old sale.
  - For sync errors, use a temporary local change that makes demo accounts
    fail, never committed.
- **Domains regression check after phase 2:** sort each column, shift-select,
  select all filtered, change pages, the sticky header, and horizontal scroll
  on a phone.

## Open questions

- **Record purchase in bulk:** one price for many names, or leave the price
  blank and mark them only as registered or purchased?

Decided:

- **Date filter:** presets only (7, 14, 30, 90, 180 days).
- **Dates in action dialogs** default to today, so Sold in bulk without a
  price is a sale dated today with no amount.
