# Owned and Archive — letting a name go

Built. It replaced Mark as Dropped, Archive, and the Hidden folder with one
rule, and Delete now applies only to names you no longer hold:

**Archive holds only names you no longer have.** Nothing you hold goes there
by hand. Not renewing a name means turning off its auto-renew, the real
setting at the registrar, which DomBot already reads and changes.

The rule lives in `src/shared/ownership.ts` (`standingOf`): every screen,
the MCP tools and the CSV export read Owned and Archive from there.

## Why

- **Four ways to put a name away, and they overlap.** Archive was "the same
  as Dropped without saying why" ([storage-model.md](storage-model.md)), and
  Hidden was for names "you're letting go and don't want to mark".
- **Mark as Dropped reads as if the name is gone.** It isn't: DomBot can't
  delete a registration, and the name stays registered (often still
  auto-renewing) until it expires. It also asks for a date nobody needs.
- **Delete doesn't delete a name an account holds.** `deleteDomains` clears its
  events, notes, folder and prices, and the row stays in Owned with no
  history.
- **None of them changes the registrar,** so a name marked Dropped with
  auto-renew on renews anyway.
- **Renewals counts names in Archive.** It sums every synced and imported name
  with no ownership check (`src/renderer/pages/Renewals.tsx`).

## Owned

Every name you hold, synced or imported. Its state comes from what DomBot
already knows; you never set it.

| State    | When                                                  | Shown                                                      |
| -------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| Renewing | Auto-renew on                                         | Nothing extra                                              |
| Expiring | Auto-renew off, expiry within 30 days                 | Nothing on the row (MCP's `expiring`; a card later)        |
| Expired  | Past expiry, still in the account (grace, redemption) | Expired / Grace / Redemption pill in the Expiration column |
| Sold     | You recorded a sale and the buyer hasn't taken it yet | "Sold" pill                                                |

- **Expiring only inside 30 days.** A name with auto-renew off that expires
  in 2031, or even in three months, isn't news yet.
- **The Grace and Redemption pills** are read from the registrar's status
  (`domainLifecycle` in `src/renderer/pages/Domains.tsx`); **Expired** shows
  when the registrar says so or the date has passed. They sit in the
  Expiration column after the date, which is orange inside 30 days and red
  past expiry, like the Expired pill (Grace is fuchsia, Redemption purple),
  with no countdown once past. The Expiration filter's Expired includes Grace
  and Redemption, which it lists under it. Only Hold (DNS off, not an expiry matter) stays beside the
  name, with the Sold and Imported pills. Expiring isn't a pill: the
  Expiration column's colour and the Auto-renew filter already show it on the row, and
  it's worked out for MCP and a future summary card.
- **A new Auto-renew filter** (On, Off, and Unknown for names you added
  by hand) beside Registrar, TLD and Folder. There isn't one today, and
  it's how you see what you're letting go.
- **Imported names** use the auto-renew and expiry you entered. Unknown
  auto-renew is never Expiring.

## Archive

Names that left every account. The label comes from facts, in this order:

| Label   | When                                                                            | Needs review         |
| ------- | ------------------------------------------------------------------------------- | -------------------- |
| Sold    | You recorded a sale (before or after it left)                                   | No                   |
| Deleted | The registration lookup says it isn't registered (the rule in storage-model.md) | No                   |
| Expired | It left after its last known expiry date (the `expires` on its `removed`)       | No                   |
| Removed | It left before expiry, with no sale recorded                                    | Yes: Sold or Dismiss |

- **Expired needs no review.** A name that leaves after its expiry date lapsed,
  or the registrar's expired-domain auction took it. Either way it's gone and
  you didn't sell it.
- **Deleted is the only certain one.** Archive already looks up departed names
  and can show a name as unregistered. The central RDAP module
  ([#105](https://github.com/aoxborrow/dombot/issues/105)) makes that one
  reliable path.
- **Removed is the one question left.** A name that leaves early was
  transferred out, pushed to another account, or sold. The review answers are
  Sold (with the price) or Dismiss. Dismissed stays Removed.
- **A name that comes back** to one of your accounts returns to Owned, as
  today (`added`).

### Imported names

No sync sees an imported name leave, so it reaches Archive another way:

- **A recorded sale** moves it to Archive at once. Nothing else would.
- **Its expiry date**: 90 days past expiry (beyond grace, redemption, and
  pending delete) it moves to Archive as Expired. Until then it shows as
  Expired in Owned, where you can update the date if you renewed it.
- **The lookup**: a definite "not registered" makes it Deleted sooner, and
  once #105 lands a later expiry from RDAP updates the date.

That gives imported names the same lifecycle as synced ones. It also means an
imported history of names you let go (sample-import.csv has dozens) lands in
Archive from its expiry dates, with no status to set.

## What you do by hand

- **Toggle auto-renew**, per row or in bulk, as today. Cloudflare and
  101domain can't change it through their APIs, so the toggle stays disabled
  with the reason it shows now (`unsupportedReason`); you change it there and
  sync reads it back.
- **Record a sale.** A name you still hold keeps its row in Owned with the Sold
  pill until the buyer takes it, then moves to Archive as Sold with no review:
  sync already writes that removal as dismissed for a name you've labeled
  (`src/shared/sync-diff.ts`). The pill doubles as a reminder to finish the
  transfer. Undo deletes the sale.
- **Delete**, only for names no connected account holds: imported names and
  Archive names. In a bulk selection it shows how many it applies to
  ("Delete … 12 of 50"), the way Activity's bulk actions do.

That's the whole list. **Gone:** Mark as Dropped and its date field, Archive,
Move back to Owned (the only manual label left is a sale, and undoing it is
part of the sale dialog), the Hidden folder, and Delete for held names. A held
name's row menu ends at Mark as Sold, with no red item.

## Renewals

Counts Owned names, minus Sold ones. Archive names are never counted, so the
current bug goes away by construction.

A switch picks **All**, **Auto-renew** or **Manual** (auto-renew off, or
unknown for a name you added: it renews only if you renew it), and the whole
page (totals, months, donuts) follows it. On the right of the title, a
multi-select **Registrar** dropdown has the Domains filter's options: one per account,
then the registrars of the names you added (`src/renderer/lib/registrar-filter.tsx`).

## Dynadot: off is manual renewal

Dynadot has three renew options: auto-renew, manual renewal, and Do Not Renew
("our system will not send you expiration reminders"). registrar-client's
`setAutoRenew(false)` writes `donot` (`src/registrars/dynadot.ts`), so turning
auto-renew off in DomBot also silently turns off Dynadot's reminder emails.
Reading collapses both into `autoRenew: false`.

Off means "won't renew automatically" and nothing more, so the library writes
`reset` (manual renewal). DomBot never sets Do Not Renew. registrar-client
0.10.1 writes `reset`, and DomBot depends on it. Still to check live: that
`reset` doesn't fall back to an account-level auto-renew default.

## Storage and events

No migration concerns: get the model right while there are few users.

- **Drop the `dropped` and `archived` event types.** Storage migration 5 deletes
  any existing ones (and bundle import drops them). A held name that was
  marked comes back to Owned, which is correct under the new rule.
- **Drop the Hidden folder.** Migration 5 deletes `__hidden__` assignments, so
  those names return to no folder. `HIDDEN_FOLDER_ID`, `isHiddenFolder` and
  `builtInFolderName` go, along with every special case for them.
- **Nothing new is stored but one field.** Expiring, Expired, Deleted and
  Sold-pending are all worked out when shown. `ArchiveLabel` is
  `sold | deleted | expired | removed`. Expired needs the expiry a name had
  when it left, which no record keeps once it's gone, so sync writes it on
  the `removed` (`expires`) when it had passed, and writes that removal
  already dismissed: a lapse has nothing to review.
- **History of your decision:** once every domain change writes an event
  ([#151](https://github.com/aoxborrow/dombot/issues/151)), turning auto-renew
  off shows up in the name's history. That's the record of when you let a name
  go.

## MCP

- **`domain_ownership_set` goes.** Its jobs were Dropped, Archived and Move
  back to Owned. Undoing a sale moves to `domain_sale_set` (a `remove: true`
  flag), whose description today points at `domain_ownership_set` for that.
- **`domain_sale_set`** no longer says it moves the name to Archive: a held
  name stays in Owned until it leaves.
- **`portfolio_query`**: `archiveLabel` is `sold`, `deleted`, `expired` or
  `removed`. Rows gain `expiring` (Owned, auto-renew off, within 30 days) and
  `salePending` (a sale recorded on a name you still hold). `hidden` and the
  "Hidden" folder filter go. The `autoRenew` filter already exists.
- **Folder tools** lose the built-in Hidden folder.
- **Agents let a name go** with `domain_set_autorenew`, the same as you.
- Update [mcp-tools.md](mcp-tools.md) and the README's tool list.

## CSV import and export

- **Export** `Status`: `Owned`, `Sold`, `Expired`, `Deleted`, `Removed`.
- **Import** `Status`: `Sold` records a sale as today. `Owned` and an empty
  cell write nothing. `Dropped`, `Expired`, `Deleted`, `Archived` and the other
  old words are accepted and ignored with a note ("DomBot works this out from
  the expiry date"), so older files still import. A row that uses one with no
  expiry date warns that the name will stay in Owned.
- **Folder** `Hidden` is an ordinary folder name.
- Update [domain-import-export.md](domain-import-export.md), the sample and
  example CSVs, and `ImportStatus` in `src/shared/import-values.ts`.

## How it landed

One PR, in this order:

1. **Model.** Drop the two event types and the Hidden folder (migration 5,
   bundle v9); derive the Owned states and Archive labels
   (`src/shared/ownership.ts`, `archiveLabelOf` in Domains); imported names'
   90-day rule.
2. **Domains UI.** The Sold pill, the Auto-renew filter, the Archive
   Status filter (Sold, Deleted, Expired, Removed), and trimmed row, bulk and
   Activity menus (`RowActionsMenu.tsx`, `BulkBar.tsx`, `Activity.tsx`,
   `OwnershipDialogs.tsx`, `FolderMenuItems.tsx`).
3. **Delete.** Gate it on "no connected account holds it", add the bulk
   count.
4. **Renewals.** Owned only, minus Sold; the two labeled halves.
5. **MCP, CSV, demo, docs.** The changes above; the demo seed
   (`src/renderer/api/demo.ts` marks a name dropped, which goes); the
   "Owned, Archive, and Hidden" and "Delete" sections of storage-model.md.

The Dynadot change shipped in registrar-client 0.10.1; this PR bumps it.

Tests: migration 5, the Owned-state and Archive-label derivation (held,
departed before and after expiry, lookup, sale pending, imported at and past
the 90-day mark), Renewals' totals, import status words, and the MCP changes.

## Future work

- **Expiry reminders** in the bell or by notification. Today the bell shows
  sync errors, departures, arrivals and app updates, nothing about expiry, so
  a name with auto-renew off can't nag anyone. Reminders are where "renewing
  by hand" and "letting it go" finally differ: they'd need a per-name "don't
  remind me", kept in DomBot.
- **Grace and redemption dates** from RDAP status, so an expired name can say
  "can still renew until …" (#105).
