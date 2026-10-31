# Needs review — getting names on the books

Built in [#224](https://github.com/aoxborrow/dombot/pull/224). Agreed in
conversation on 2026-10-30 and 2026-10-31.

When a name arrives in or leaves one of your accounts, DomBot asks about the
money: what you paid for a name that arrived, what you got for one that left.
Today that's "Needs review" with red and yellow priorities, which reads like
an alarm, and dismissing an alert loses it. It's really a list of names missing their financials, with a small
security angle for names that leave early.

This plan makes that list calm, keeps it findable after you dismiss things,
and puts the answers on the row:

- **Two views on Activity: All and Needs review.** Needs review is every
  arrival or departure still missing its money, dismissed or not.
- **New rows are highlighted, like unread mail.** The bell and the Activity
  tab count them. Dismiss marks one read; it stays in Needs review.
- **The answers sit in the row's Details,** the one-click one first:
  Record registration, Record purchase…, Mark dropped, Record sale…, Dismiss.
- **Registration and purchase are recorded separately,** in one dialog with
  a Registration | Purchase toggle.

The bell's redesign (icons instead of pills, red only for sync errors) is on
the same branch and comes first; see [The bell](#the-bell).

## Why

- **Needs review looks urgent.** Red and yellow priority dots and tinted
  rows make a busy account's departures look like errors. Most are sales or
  drops you know about.
- **Dismissing loses things.** A dismissed alert leaves Needs review for good,
  with its money still unrecorded, and nothing finds it again.
- **The answers are hidden.** Recording a purchase or sale means opening the
  row's ⋯ menu, and the menu's words ("Purchase details…", "Mark as Sold…")
  don't say they answer the alert.
- **The purchase dialog does two jobs.** Its "Just Registered" button fills
  the registration date and fee and quietly saves a `registered` event
  instead of a `purchased` one (`src/renderer/components/domains/PurchaseDialog.tsx`).
- **There's no answer for "it left and no money came back".** A departure's
  answers are Sold or Dismiss; a drop can only be dismissed, which isn't a
  record.

## Activity: All and Needs review

The switch at the top of Activity stays **All | Needs review**, and keeps
its URL (`/activity?review=1`). The name stays for now; "Unrecorded" was the
other candidate, if Needs review still reads as an alarm in use.

- **Needs review** lists every arrival and departure still missing its
  money, including ones you dismissed. New ones are highlighted; dismissed
  ones aren't. The switch shows the count: "Needs review 14".
- **All** is every event, as today, with new rows highlighted too.
- **The Priority filter goes,** and so does the Status column: the highlight
  and the row's actions say everything it said. The Type filter already
  separates arrivals from departures.
- **Empty Needs review:** "Every name that came or went is on the books."

### New and needs review

Both are worked out from the events, as today; nothing new is stored except
Mark dropped.

- **New** is today's open alert (`isOpenAlert` in `src/shared/sync-diff.ts`):
  an `added` or `removed` event that isn't dismissed and that no later event
  resolves. Unchanged, and it's what the bell and the Activity tab count.
- **Needs review** is every new alert, and every `added` or `removed` event
  still missing its money, dismissed or not, less what sync or an import
  already closed on its own. An `added` or `removed` event is missing its
  money when:
  - no event resolves it (a sale, a purchase, a move, the name coming back);
  - it doesn't itself resolve another event (sync's "came back" and an
    import's closing record carry `resolves`; they answer, they don't ask);
  - it wasn't written already dismissed (`dismissed` with no `updatedAt`):
    that's the writer's answer, an import of a name already past expiry,
    say, where Dismiss always stamps `updatedAt`;
  - for a departure: it isn't a lapse (`expires` set: left after its expiry,
    Archive's Expired), isn't marked dropped, and the name has no sale on
    record for that holding (sync's own `disposed` rule: a `sold` not
    followed by the name coming back);
  - for an arrival: the name has no registration or purchase on record since
    it last left (a purchase recorded from the Domains page counts, not only
    one that resolves the alert).

  So sync's automatic closes (lapses, sales a connected market reported,
  names that came back, moves) never show in Needs review, and alerts you
  dismissed yourself before this change come back there, without the
  highlight.

- **One function for each,** in `src/shared/` beside `isOpenAlert`, used by
  Activity, the bell, the tab count, Archive and MCP.

### The highlight

A new row gets the brand-green tint and a 3px brand bar down its left edge
(`REVIEW_ROW_TINT` in `src/renderer/lib/severity.ts` becomes one style, not
two priorities). A selected row shows the selection instead, as now.

The left bar is in the code today but no longer shows: "Table: column rules
even on a hovered row" (e8676e7f) draws the column rules as a box-shadow on
every cell, which replaces the bar's box-shadow on the first cell. The fix
draws both in one shadow on the first cell, or moves the bar to a
pseudo-element.

## Row actions

**Inline, in the Details column,** on every row needing review in either
view: the suggested answers as small buttons, styled like Sales' step
buttons. An arrival or a departure has no details of its own, so the column
is free for them. The columns read Domain, Date, Activity (the event's
type), Registrar, Details, Source; every column but Details is only as wide
as its widest cell, so Details takes the rest and the answers stay in view
in a narrow window. The row's ⋯ menu stays in the Domain cell with every
option.

| Row                     | Inline                                           |
| ----------------------- | ------------------------------------------------ |
| An arrival (`added`)    | Record registration · Record purchase… · Dismiss |
| A departure (`removed`) | Mark dropped · Record sale… · Dismiss            |

The one-click answer comes first, with no "…"; the one that opens a dialog
follows it. Dismiss is an outline with no fill and an ✕, so the answers stand
out from it.

- **Only rows still missing their money get answers.** A new arrival whose
  purchase is already on file (recorded on Domains, say) gets Dismiss alone,
  so Record registration never edits or doubles a record that's there.
- **Dismiss is last,** and only on new rows: a dismissed row has nothing to
  dismiss. It marks the row read (`dismissed: true`) with an Undo toast, as
  today.
- **Record registration is one click.** It saves a `registered` event that
  resolves the arrival: the date from the name's created date
  (`registrationDay`), the fee from the registrar's registration price for
  that name (`getRegistrationQuote`, a live pricing call to the registrar).
  An Undo toast follows. When there's no usable price (none reported,
  or in a currency DomBot can't convert), the click opens the Record
  registration dialog with that note instead of saving a blank amount.
- **Record purchase… and Record sale…** open their dialogs, filled in as
  today, and resolve the alert on save.
- **Mark dropped** is one click with an Undo toast: the name left and no money
  came back. See [Mark dropped](#mark-dropped).
- **A name that left after its expiry never asks.** Sync records the lapse
  (`expires` on the `removed`, Archive's Expired) and writes it already
  dismissed, so it isn't in Needs review. Its Details say "Expired
  2026-09-30", and a departure you marked says "Dropped", so the row shows
  why it has no answers.
- **On phones** the inline buttons don't fit; the ⋯ menu has them all.

### The ⋯ menu

Every option, in the words the inline buttons use:

- Notes…
- Record registration… (opens the dialog, unlike the one-click inline button)
- Record purchase… (Edit purchase… once there is one)
- Record sale… (Edit sale… once there is one)
- Mark dropped (departures; Undo dropped once marked)
- Dismiss (new rows)
- Show in Domains
- Delete… (names no connected account holds)

The Domains row menu takes the same words for the dialogs it shares:
"Purchase details…" becomes Record purchase… / Edit purchase…, "Mark as
Sold…" becomes Record sale… / Edit sale….

### Bulk

The selection bar on Activity gets the one-click answers, each with how many
of the selection it applies to:

- **Record registration** for the selected arrivals. Names without a usable
  price are skipped; the toast says how many, and Needs review still lists
  them. Each name is one pricing call to its registrar, so a large batch
  runs like the other bulk jobs, paced per account.
- **Mark dropped** for the selected departures.
- **Dismiss** (today's "Dismiss review") for the selected new rows.
- Record sale… and Notes… stay as they are.

## Recording a registration or a purchase

`registered` and `purchased` stay separate event types: a hand-registration
paid the registry fee; a purchase paid someone's price, and will grow its
own details (venue, broker, fees). Today one dialog writes both, and the
difference is a button.

**One dialog with a Registration | Purchase toggle at the top.** The title
follows it: "Record registration" or "Record purchase". The inline buttons
and menu items open it on their side; switching keeps nothing typed on the
other side.

| Side         | Date                    | Amount                           | Saves        |
| ------------ | ----------------------- | -------------------------------- | ------------ |
| Registration | The name's created date | The registrar's registration fee | `registered` |
| Purchase     | The day it arrived      | Empty: the price you paid        | `purchased`  |

- **Registration's fee note** is today's Just Registered note: shown when the
  registrar doesn't report a fee or quotes it in a currency DomBot can't
  convert, with the date still filled in.
- **A premium or promo registration** is Record registration with the fee
  changed, or Record purchase if it was bought from a registry auction.
- **Just Registered goes;** the toggle replaces it. Editing an existing
  record opens on its own side.
- The dialog is shared with the Domains page, so the change lands there too.

## Mark dropped

The answer to a departure that brought no money: you let it go early,
transferred it to a registrar DomBot doesn't sync, or it was pushed away.

- **Stored as `dropped: true` on the `removed` event,** beside `dismissed`.
  It counts as dismissed too, so a dropped row is neither new nor in Needs
  review. Undo clears it, and the row is as it was.
- **Archive gets a Dropped label** for it, between Expired and Removed:

  | Label   | When                                                         |
  | ------- | ------------------------------------------------------------ |
  | Sold    | You recorded a sale                                          |
  | Deleted | The registration lookup says nobody holds it                 |
  | Expired | It left after its last known expiry                          |
  | Dropped | It left before expiry and you marked it dropped              |
  | Removed | It left before expiry and you haven't said why: needs review |

  `needsReview` in `src/shared/ownership.ts` stays true only for Removed.

- **Not the old Mark as Dropped.** That marked a name you still held and moved
  it to Archive by hand; [owned-and-archive.md](owned-and-archive.md) removed
  it. This one only answers for a name that has already left.

## The bell

Built on this branch ahead of the rest: one row shape (an icon coloured by
how much it needs you, what happened, when), red only for sync errors, amber
for market sales waiting on you, the Activity Type colours for names (blue in,
plain out), and a count bubble that follows the same order.

With this plan:

- **The header says "N new"** (today "N need review").
- **View activity opens Needs review,** and a name's row opens it filtered
  to that name, as today.
- **It still only tells you.** Answers are on Activity, where the row has
  them inline.

## Storage and events

- `dropped?: boolean` on `DomainEvent`, meaningful on `removed`, with a
  service like `setAlertsDismissed` (`setDeparturesDropped(ids, dropped)`)
  and an API method, IPC and demo method to match. It ships in data bundles
  like any event field.
- No migration: New and Needs review are worked out from events already
  stored.
- The Needs review count is read wherever the views are; the stored data
  doesn't change when you dismiss or record, beyond the events those write.

## MCP

- **`portfolio_alerts`** lists new alerts by default, as now, worded as
  "new", and takes `needsReview: true` to list every arrival and departure
  Activity's Needs review shows, dismissed or not, each with `dismissed`.
- **Mark dropped** for agents: `portfolio_alert_dismiss` takes
  `dropped: true` (with `dismissed: false` undoing either). A separate tool
  isn't worth it for one flag.
- **Recording** already exists: `domain_purchase_set` with `kind`
  (`registered` or `purchased`) and `resolves`, and `domain_sale_set`.
- **`portfolio_query`**'s `archiveLabel` gains `dropped`.
- [mcp-tools.md](mcp-tools.md) follows.

## How it lands

One PR, stacked on the sync work (#223) because the bell changes there too,
in this order:

1. **The bell** (built): icons, colours, count bubble.
2. **New and Needs review** in `src/shared/` with tests, including sync's
   automatic closes and dismissed alerts coming back.
3. **Activity views and highlight:** All | Needs review, the green highlight
   with its left bar fixed, the Priority filter and Status column removed,
   the bell's header and links.
4. **Mark dropped:** the event field, service, API, Archive's Dropped label,
   MCP.
5. **Row actions:** the inline buttons, the one-click Record registration,
   the renamed ⋯ menu items (Activity and Domains), bulk actions.
6. **The Registration | Purchase dialog,** replacing Just Registered.
7. **Docs:** [storage-model.md](storage-model.md) ("Activity and alerts"),
   [owned-and-archive.md](owned-and-archive.md) (Archive labels),
   [mcp-tools.md](mcp-tools.md), and the demo's sample alerts (a dismissed
   departure that still needs review, a dropped one).

## Open questions

- **Which view Activity opens on.** Today the switch lives only in the URL,
  so the tab opens on All and the bell links to the review view. Keep that:
  the tab opens on All, the bell on Needs review.
- **Bulk pricing calls.** One registrar pricing call per name may be slow for
  hundreds of arrivals. Names at one registrar and TLD usually share a price
  (premiums don't), so a batch could ask once per TLD and fall back per name
  only for premiums, if the registrar reports them.
- **Inline buttons on a busy page.** Three buttons on every row needing review in
  a long list may be a lot; if so, they show on hover and on new rows only.
- **Sort in Needs review:** newest first like All, or new rows first.

## Future work

- **A setting to record new registrations automatically** at the
  registrar's price, if one click per name is still too many.
- **Purchase details:** venue, broker, fees, as the financial dashboard
  ([#112](https://github.com/aoxborrow/dombot/issues/112)) needs them.
- **Needs review on the Domains page:** a filter or column for names whose
  latest arrival or departure is missing its money.
