# Domain import and export

A planning doc for importing domains from any spreadsheet, along with what
you paid, what you sold them for, your renewal price, and your asking price.

Two changes to DomBot's core come first:

- an asking price on every name, synced or manual;
- a currency on every price, renewal prices included.

It also defines one DomBot CSV format: it exports every name on one line, and
importing that file gets you back to the same data.

Status: plan (2026-10-02), reviewed the same day (see "Settled in review").
Phase 1 (asking price) is in progress. It takes over the CSV importer and the manual-domain storage
planned in #108. It replaces the purchase-only import in #122, which will be
closed. It leaves room for venues (#109), installments (#110), MCP (#111),
and the financial dashboard (#112). Storage follows `docs/storage-model.md`.

The previous app's importer and template were reviewed for this plan, along
with sample registrar and marketplace exports. Everything needed from them is
summarized here (see the appendices), so none of those files belong in the
repo.

## Goals

- **An asking price for every name.** It's a core feature, not just an import
  column. You set an asking price, a minimum offer, and a floor on any name,
  synced or manual, from the Domains table or in bulk.
- **Every price has a currency.** Asking prices, renewal prices, purchases,
  and sales.
- **Import from anywhere.** Sources include:
  - DomBot's own CSV;
  - the previous app's template and exports;
  - registrar exports (GoDaddy, Dynadot, Namecheap, …);
  - marketplace exports (Afternic, Sedo, Efty, …);
  - a pasted list of names.
- **Imported names are first-class.** A name no connected account reports
  becomes a manual domain. It shows in Owned or Archive, Renewals, Activity,
  and MCP. It takes folders, notes, prices, and history like a synced name. It
  survives Clear cache and travels in the Settings → Sync backup.
- **The money comes along:**
  - purchase type, date, amount, and currency;
  - sale date, amount, and currency;
  - your renewal price;
  - your asking price, minimum offer, and floor.
- **One canonical CSV.** One row per name. Whatever DomBot exports, it can
  import back to the same state.
- **See it before it's written.** You match columns, then review every
  change. A bad row is reported and skipped; it never stops the rest.
- **Safe to repeat.** Importing the same file twice changes nothing the
  second time.

## Non-goals

- **Exports for marketplace upload** (Afternic, Sedo, Dan). Later; see
  "Later" for the notes.
- **A for-sale flag or listing status.** An asking price is enough for now.
  Listing status comes with marketplace export.
- **A sale's net amount and fees.** They come with venues and fees (#109).
- **Registrar actions on manual names.** Renew, nameservers, DNS, lock, and
  auto-renew need a connected account.
- **Removing names that are missing from the file.** Import only adds and
  updates. A replace mode, for when DomBot isn't your master list, is a later
  option (see "Later").
- **The previous app's landing-page fields:**
  - headline and description;
  - contact email;
  - custom buy and contact links;
  - analytics tag;
  - redirect URL;
  - "show in portfolio" and "show seller".

  DomBot has no landing pages, so these columns are ignored. Its listing
  installment terms (allow installments, maximum months) wait for
  marketplace export.

- **Excel files in the first cut.** CSV, TSV, and plain text come first;
  XLSX is later.
- **Full history in the CSV.** Earlier holdings, sync events, and alert
  state stay in the JSON backup. A ledger CSV with one row per event comes
  later.
- **Currency conversion.** Amounts keep their currency, as everywhere else.

## Where things stand

### PR #122: purchase CSV (draft)

`src/shared/purchase-csv.ts` reads
`Domain, Purchase date, Purchase amount, Currency, Notes`. `importPurchases`
(`src/core/services/purchases.ts`) upserts each name's latest acquisition and
its note. Settings → Sync has the button and a sample download.

Worth keeping:

- A bad row is reported, and the rest still save.
- A blank cell keeps what's stored.
- Re-importing the same file changes nothing.
- It writes once per namespace (`putEvents`, `setNameNotes`), which keeps the
  Worker inside its subrequest limit.
- New events get `source: 'import'`.

Why it isn't enough:

- It covers purchases and notes only. There's no sale, renewal price,
  folder, ownership, or registration data.
- Headers must match exactly, only commas work as delimiters, and values
  are strict:
  - dates only as `YYYY-MM-DD`;
  - amounts only as a plain decimal with exactly the currency's decimal
    places.

  Almost no real export imports without hand editing.

- A name no connected account reports gets a purchase but no row; it shows
  only in Activity.

### The Domains CSV export

`domainsToCsv` (`src/renderer/lib/csv.ts`) is reached only from the bulk bar:
Export CSV on the selected rows. Its problems:

- One row per account copy, so a name mid-transfer appears twice.
- Mixed header casing (`Days Until Expiry` next to `Sale date`).
- `Status` is the registrar's status string. `Currency` is only the purchase
  currency.
- No ownership status, purchase type, or renewal price.
- `Domain` is spelled however the registrar reported it.

It gets the hard parts right, and these carry over:

- RFC 4180 quoting.
- The formula guard: a `'` before any cell that starts with `=`, `+`, `-`,
  or `@`.
- A UTF-8 BOM, so Excel shows accents correctly. Both hosts' `saveTextFile`
  add it.
- ISO dates.

### Renewal prices

Your renewal price (`domain-prices`) is a plain number, and DomBot treats it
as USD everywhere: `src/renderer/lib/renewals.ts` says "All money is USD",
and the Renewals editor is labeled "Annual price (USD)". Registrar quotes
already carry a currency, but the totals ignore it.

### Settings → Sync backup

The JSON data bundle (`src/core/storage/bundle.ts`, v5) is a lossless copy of
every exported namespace. Importing it replaces everything. It stays the way
to move a whole DomBot, with its full history. The CSV is for spreadsheets,
other apps, and names that come from outside DomBot. The new and changed
namespaces in this plan go in the bundle, with a version bump.

### The previous app

Its importer is the model for this one. What worked:

- An alias table guessed the column mapping, and you could change any of it
  before importing.
- One row per name, with the purchase and sale columns side by side.
- A downloadable template.
- An import updated only the columns it mapped.
- Repeated header rows were skipped.
- Unicode and punycode names both worked.

What didn't work, and what this plan does instead:

- **A mapped blank cell overwrote stored values.** An empty boolean became
  "no", and an empty currency became USD. Here a blank cell never changes
  anything.
- **Money parsing broke on European formats** (`1.250,00` became `1.25`) and
  dropped minus signs. Here both decimal marks parse, and a negative amount
  is an error.
- **One invalid domain aborted the whole file**, and there was no per-row
  report. Here bad rows are listed and skipped.
- **Ambiguous dates were read as US** (month first). Here the order is
  detected per column, and asked when it can't be.
- **The CSV writer quoted only a few columns.** DomBot's writer quotes per
  RFC 4180.
- **Only USD, EUR, and GBP worked.** Here every ISO 4217 code DomBot knows.
- **`amount` was an alias for the asking price**, but park.io's
  `Amount (USD)` is what you paid. Here ambiguous headers never match
  automatically.
- **Exports often write `0` to mean "not set"** (Efty's sold price,
  Afternic's floor price). Here a zero amount always counts as blank.

## The formats side by side

|               | PR #122                         | Domains export today                                            | Previous app                                                                  | DomBot CSV (this plan)                                                                            |
| ------------- | ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Rows          | one per name (a later row wins) | one per account copy                                            | one per name                                                                  | one per name; duplicates merged                                                                   |
| Headers       | sentence case, exact            | mixed case                                                      | Title Case                                                                    | sentence case; import ignores case and punctuation                                                |
| Domain        | `Domain` or `Domain name`       | as reported                                                     | punycode in `Domain`, Unicode in `IDN`                                        | ASCII in `Domain`, Unicode in `IDN`                                                               |
| Purchase      | date, amount                    | date, amount                                                    | `Purchase Date`, `Purchase Price`                                             | type, date, amount, currency, years                                                               |
| Currency      | `Currency` (purchase)           | `Currency` (purchase), `Sale currency`                          | one `Currency` for every amount; blank = USD                                  | one per price; `Currency` is read as the row's default                                            |
| Sale          | —                               | date, amount, currency                                          | `Sold Date`, `Sold Price`, `Sold Net`                                         | date, amount, currency (net comes later)                                                          |
| Renewal price | —                               | —                                                               | `Renewal Price`                                                               | `Renewal price` and `Renewal currency` (yours); `Renewal estimate` and its currency (export only) |
| Asking price  | —                               | —                                                               | `Price`, `Floor Price`, `Allow Offers`, `Min Offer`, installments, `For Sale` | `Asking price`, `Minimum offer`, `Floor price`, `Asking currency`                                 |
| Ownership     | —                               | — (`Status` is the registrar's)                                 | —                                                                             | `Status`: Owned, Sold, Dropped, Archived, Removed                                                 |
| Folder        | —                               | `Folder`, export only                                           | `Group`, export only                                                          | `Folder`, imported by name                                                                        |
| Registration  | —                               | `Registrar`, `Created`, `Expires`, `Auto Renew`, …, export only | `Registrar`, `Expiration Date`, export only                                   | imported for manual names; export only for synced names                                           |
| Notes         | `Notes`                         | `Notes`                                                         | `Notes`                                                                       | `Notes`                                                                                           |
| Amounts       | plain decimal, exact places     | as stored                                                       | symbols stripped; listing prices whole numbers                                | as stored on export; lenient on import                                                            |
| Dates         | `YYYY-MM-DD` only               | `YYYY-MM-DD`                                                    | `Y-m-d`; import parsed anything, US order                                     | `YYYY-MM-DD` on export; lenient on import                                                         |
| Blank cell    | keeps                           | —                                                               | overwrote booleans and currency                                               | keeps                                                                                             |

Every older header is an alias in the new importer, so all three kinds of
file still import.

## Decisions

### One row per name

The export has to be one line per name, for spreadsheets, other tools, and
later marketplace uploads, and that same file has to import back. A row
already holds a purchase and a sale side by side. That covers buying a name
and selling it once, which is the story of nearly every name.

Several rows per name raise questions a spreadsheet can't answer. Is a
second row a correction, or a second holding? Which purchase does a sale
belong to? And with no stable identity for a row, re-importing would count
things twice. So:

- **Rows for the same name are merged cell by cell**, and a later non-blank
  cell wins. A file with a purchase row and a separate sale row for one name
  still works, as long as the purchase is in the purchase columns and the
  sale in the sale columns. The preview lists the merged rows and any cells
  that disagreed.
- **History beyond the latest holding** stays in the JSON backup (a name
  bought, sold, and bought back).
- **A ledger CSV comes later**, as Activity export and import: one row per
  event, with a `Type` column, the shape tax software wants (#112). That's
  the multi-row format, kept apart from the domain list.

### Asking price is a core feature

- **Every name can have one**, synced or manual. You set it from the Domains
  table, the row menu, or in bulk, and an import can set it too.
- **The record:**
  - an asking price;
  - an optional minimum offer, the lowest offer you'll consider;
  - an optional floor, the lowest price you'd accept, never shown to buyers;
  - one currency for all three.
- **It's keyed by name** in its own namespace (`domain-asking-prices`), like
  notes, folders, and renewal prices. So it follows a name between accounts,
  survives Clear cache, and travels in the backup. Delete removes it.
- **It isn't a listing.** Setting a price doesn't list the name anywhere.
  Marketplace exports will read it later.
- **It isn't an event.** Changing a price rewrites the record; a price history
  is later work.

### Every price has a currency

- **Asking prices, renewal prices, purchases, and sales** each carry their
  own currency: any code in `CURRENCIES`.
- **Renewal prices are the change.** `domain-prices` holds a USD number
  today, so it gains a currency (see "Prices").
- **DomBot never converts.** Where it adds prices up (the Renewals page, and
  later the dashboard), it totals each currency separately until exchange
  rates exist (#112).

### Imported names are manual domains

- **A name a connected account reports** already has a row. The import adds
  your data to it: purchase, sale, notes, folder, renewal and asking prices.
  The file's registrar columns are ignored, since the registrar is the
  authority.
- **A name no account reports, and that ends up Owned,** becomes a
  `manual-domains` entry, with #108's namespace and record. It shows in Owned
  with a Manual badge, in Renewals when it has an expiry, and later in MCP
  (#111).
- **A name that ends up in Archive** (it has a sale, or a `Status` of Dropped,
  Archived, or Removed) gets no manual entry. Archive rows already come from
  events.
- **An option, "Names not in your accounts: Add to Owned | Record history
  only",** is for importing old purchases and sales without adding names you
  no longer hold.
- **When an account later reports a manual name**, sync removes the manual
  entry and writes `moved` from no account (#108). Events, notes, folders,
  and prices are keyed by name, so they carry across.

### Imported names wait for review, like arrivals

- **Every new manual name writes an open `added`:** the same low-priority
  review a sync arrival raises. That holds even when its row has a purchase.
  The purchase is recorded, and the review still waits.
- **A name coming back isn't new.** Say a name left one of your accounts, so
  it has an open "Removed" review, and now you import it. The import closes
  that review and opens no new one. Sync does the same when a name comes
  back.
- **Reviewing never records a second purchase.** If a name already has a
  purchase recorded since it arrived (from the import, or entered from the
  Domains row), reviewing the arrival opens that purchase, and saving it
  closes the review. Today `PurchaseDialog` and `setPurchase` always start a
  new purchase when answering an arrival; that changes in phase 5.
- **Big imports:** on Activity, filter to the import, select every row, and
  use the bulk Dismiss review. The import result links straight there.
- **Sources:** names from a file write `source: 'import'`, which Activity
  shows as "Imported". Pasted names write `source: 'user'`, shown as "Added
  manually".

### Lenient in, canonical out

Export writes exactly one spelling of everything: ASCII names, `YYYY-MM-DD`
dates, plain decimals with the currency's decimal places, ISO currency codes,
and Yes/No. Import accepts the many spellings real files use. Shared code
normalizes them before anything reaches the server.

### Import only adds and updates

- Names missing from the file are left alone.
- A blank cell never clears a stored value, and a zero amount counts as
  blank.
- Import never deletes a name, a purchase, a sale, or a note.
- It replaces your Dropped or Archived label with Sold, the way Mark as Sold
  does, but it never replaces a Sold.
- It doesn't move a name you labeled back to Owned. That's what Move back to
  Owned is for. The one exception is a buy-back: a purchase dated after the
  name's sale.
- Changes it won't make show as warnings in the preview.
- **Update policy:**
  - By default, a non-blank cell replaces DomBot's value.
  - "Only fill in what's missing" leaves every stored value alone.

### Parse on the client, plan and write on the server

- **The renderer** reads the file, matches the columns, and normalizes the
  values, with shared code in `src/shared/`. Matching and errors show
  instantly, and the raw file never leaves the device.
- **The server** gets only the normalized rows. It checks them against
  strict schemas, then plans against the stored data. That planner is one
  piece of code for desktop, Worker, and demo.
- **A later MCP tool** reuses the same planner.

## The DomBot CSV format

### Columns

In this order. "Manual names" means the column is imported only for names no
connected account reports.

| Column                      | Imported               | Notes                                                                          |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `Domain`                    | required               | ASCII (punycode). Import also takes Unicode, any case, and URL forms.          |
| `IDN`                       | when `Domain` is blank | the Unicode spelling, written only for internationalized names                 |
| `Status`                    | yes                    | `Owned`, `Sold`, `Dropped`, `Archived`, `Removed` (Archive's Status column)    |
| `Folder`                    | yes                    | a folder name, or `Hidden`; missing folders are created                        |
| `Registrar`                 | manual names           | DomBot's name for a known registrar, or free text (`Epik`)                     |
| `Account`                   | no                     | `Dynadot #2`, `Manual`, or both accounts when two hold the name                |
| `Created`                   | manual names           | the registration date                                                          |
| `Expires`                   | manual names           |                                                                                |
| `Auto-renew`                | manual names           | `Yes` or `No`                                                                  |
| `Renewal price`             | yes                    | the yearly price you set (`domain-prices`)                                     |
| `Renewal currency`          | yes                    |                                                                                |
| `Renewal estimate`          | no                     | the price DomBot uses: yours, a registrar quote, a TLD rate, or the base table |
| `Renewal estimate currency` | no                     |                                                                                |
| `Asking price`              | yes                    |                                                                                |
| `Minimum offer`             | yes                    | the lowest offer you'll consider                                               |
| `Floor price`               | yes                    | the lowest price you'd accept; never shown to buyers                           |
| `Asking currency`           | yes                    | one currency for all three                                                     |
| `Purchase type`             | yes                    | `Registered` or `Purchased`                                                    |
| `Purchase date`             | yes                    |                                                                                |
| `Purchase amount`           | yes                    |                                                                                |
| `Purchase currency`         | yes                    |                                                                                |
| `Purchase years`            | yes                    | the registration or purchase term (`years`; nothing records it yet)            |
| `Sale date`                 | yes                    |                                                                                |
| `Sale amount`               | yes                    | the price, before fees                                                         |
| `Sale currency`             | yes                    |                                                                                |
| `TLD`                       | no                     |                                                                                |
| `Days until expiry`         | no                     |                                                                                |
| `Renewal date`              | no                     | as the registrar reports it                                                    |
| `Locked`                    | no                     |                                                                                |
| `Privacy`                   | no                     |                                                                                |
| `Nameservers`               | no                     | separated by `; `                                                              |
| `Registrar status`          | no                     | the registrar's own status (today's `Status`)                                  |
| `Last synced`               | no                     |                                                                                |
| `Notes`                     | yes                    | the name's note; last, since it's long                                         |

- **The purchase and sale columns describe the latest holding:** the latest
  `registered` or `purchased` event, and the sale after it. That's the same
  summary the table shows (`getPurchases`).
- **`Currency` isn't written, but it's read.** It supplies the currency for
  any price in its row that has no currency of its own. That keeps PR #122's
  sample, today's export, and the previous app's files importing correctly.
- **`Removed` comes back as a review.** In Archive, Removed means the name
  left one of your accounts and you haven't labeled it Sold, Dropped, or
  Archived yet. Import recreates that: the name goes to Archive with a
  Removed review waiting for a label, as sync left it. These are the
  higher-priority reviews, so a file with many Removed names keeps the bell
  amber until they're labeled or dismissed.
- **The template** (`dombot-domains-template.csv`) has the importable columns
  and three rows:
  - a hand-registered `example.com` with a renewal price;
  - a purchased `example.net` with an asking price, a folder, and a note;
  - an `example.org` sold in EUR.

  It replaces `purchaseCsvSample()`.

### Values

| Type          | Export writes                                           | Import also accepts                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain        | lowercase ASCII                                         | Unicode or punycode, any case, with a scheme, a path, or a trailing dot. A subdomain such as `www.example.com` is an error that names the registrable domain (via `tldts`, already a dependency).                                                                                |
| Date          | `YYYY-MM-DD`                                            | date-times in any zone (the date as written, never shifted); `YYYY/MM/DD`; `MM/DD/YYYY` or `DD/MM/YYYY` (the order is detected per column); dashes or dots; month names (`Dec 13 2021`, `13 December 2021`); a column of epoch seconds or milliseconds. Years from 1985 to 2100. |
| Money         | digits and a period, with the currency's decimal places | a currency symbol or code before or after the number; `,`, `.`, space, or `'` as grouping; either decimal mark (when both appear, the last is the decimal; a single separator followed by exactly three digits is grouping); trailing zeros past the currency's places           |
| Currency      | ISO code                                                | any case; unambiguous symbols (`€`, `£`, `₹`, …); `$` means your preferred currency when that's a dollar, else USD; English names (`euro`, `pound`, `yen`)                                                                                                                       |
| Yes/No        | `Yes` or `No`                                           | `y`/`n`, `true`/`false`, `1`/`0`, `on`/`off`, `enabled`/`disabled`, `✓`; Dynadot's `Renewal Status` values                                                                                                                                                                       |
| Status        | `Owned` to `Removed`                                    | `active`, `portfolio`, `held`, `in account` → Owned; `deleted`, `expired`, `lapsed` → Dropped                                                                                                                                                                                    |
| Purchase type | `Registered` or `Purchased`                             | `registration`, `hand registered`, `hand-reg` → Registered; `bought`, `aftermarket`, `auction`, `backorder`, `drop catch` → Purchased                                                                                                                                            |
| Folder        | the name                                                | existing folders match by name, ignoring case; `(no folder)`, `none`, and `-` count as blank                                                                                                                                                                                     |
| Registrar     | display name                                            | an id (`namecom`), a display name, a website (`name.com`), or a legal name (`GoDaddy.com, LLC`, `Dynadot LLC`). Lowercase it, strip punctuation and company suffixes, then compare. Anything else is kept as free text. #123's IANA mapping improves this later.                 |
| Text          | as stored                                               | trimmed; the export's formula guard (a leading `'` before `=`, `+`, `-`, `@`, a tab, or a return) is removed, so notes survive a round trip                                                                                                                                      |

Money rules that keep bad data out:

- **A negative amount is an error.** So is an amount with more decimal places
  than its currency allows (`JPY 500.50`). Money is never rounded silently.
- **A zero amount is blank**, because exports use `0` to mean "not set".
- **A cell's own currency** (`€500`) must agree with its column's or row's
  currency. If it doesn't, that cell is an error.
- **A minimum offer or floor above the asking price** is an error for the
  asking group, as it is in the editor.
- **Ambiguous dates:** when a column has no day above 12, the matching step
  shows "Dates read as month/day", with a way to switch. The default follows
  your number format: US style reads month first, the others day first.

### What a round trip keeps

Export, then import into an empty DomBot:

| Kept                                                                           | Not kept (use the JSON backup)                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| every name                                                                     | account membership (it returns with the first sync)                         |
| ownership: Owned, Sold, Dropped, Archived, Removed                             | earlier holdings of a name bought more than once                            |
| the latest purchase and sale, with type, dates, amounts, currencies, and years | sync events (`added`, `removed`, `moved`) and which reviews you'd dismissed |
| the name's note                                                                | notes attached to events                                                    |
| the folder, by name, Hidden included                                           | folder colors and descriptions                                              |
| your renewal price and its currency                                            | registrar detail and quotes (sync fetches them again)                       |
| the asking price, minimum offer, floor, and their currency                     | settings, accounts, credentials                                             |
| registrar, created, expires, and auto-renew for manual names                   |                                                                             |

Names that were synced arrive as manual names. When you connect their
account, sync takes them over. Every Owned name arrives with a review
waiting, which an account's first sync doesn't do; bulk Dismiss clears them.
Importing the file back into the DomBot that exported it changes nothing.

## Storage

### `domain-asking-prices`

Keyed by `toAscii(name)`, exported, and not a cache. The storage model
anticipates it: a new per-name field such as an asking price gets its own
small namespace.

```ts
interface AskingPrice {
  amount: string | null; // canonical decimal; null when only offers are set
  minOffer?: string | null; // the lowest offer you'll consider
  floor?: string | null; // the lowest price you'd accept; never shown
  currency: CurrencyCode; // for all three
  updatedAt: number; // ms epoch
}
```

- **At least one amount is set.** Clearing all three deletes the record.
- **A minimum offer or floor** can't be above the asking price.
- **"Allow offers" and "for sale" aren't stored.** A name with an asking
  price is for sale, and a minimum offer (or no asking price) means offers
  are welcome. Marketplace exports will derive their selling options from
  that later.
- **Bundle checks.** `cleanAskingPrice` re-checks entries read from a bundle,
  the way `cleanEvent` does for events.

### `domain-prices` gains a currency

Keyed by `toAscii(name)` as today. The value changes from a USD number to an
amount and a currency:

```ts
interface RenewalPrice {
  amount: string; // canonical decimal, e.g. "18.99"
  currency: CurrencyCode;
}
```

- **Migration 3** turns each stored number into `{ amount, currency: 'USD' }`,
  with the amount in canonical form, and sets `schemaVersion = 3`. A bundle
  from before the change gets the same step on import.
- **Bundle checks.** `cleanRenewalPrice` re-checks entries read from a
  bundle.

### `manual-domains`

#108's record, keyed by `toAscii(name)`. It's exported, and it isn't a cache.
There's one new field:

```ts
interface ManualDomain {
  registrar: RegistrarName | null; // a registrar DomBot knows, or null
  registrarLabel?: string | null; // free text otherwise, e.g. "Epik"
  expirationDate?: string | null; // YYYY-MM-DD
  createdDate?: string | null; // YYYY-MM-DD
  autoRenew?: boolean | null;
  addedAt: number; // ms epoch
  updatedAt: number | null; // ms epoch
  importId?: string | null; // new: the import that added it
}
```

- **Bundle checks.** `cleanManualDomain` re-checks entries read from a
  bundle.
- **No accounts configured.** `hydrateFromCache` drops the registrar cache
  when no account is configured. Manual names don't live in that cache, so
  Domains still shows them. The "No registrars configured" empty state
  appears only when there are no manual names either, and it offers Import
  domains beside Configure registrars.
- **Which names an account holds** comes from `registrar-last-sync` for
  active accounts, not from the cache. It's exported and survives Clear
  cache, so an import right after Clear cache doesn't mistake synced names
  for manual ones.

### `importId` on events

`importId?: string` goes on every event an import writes. Activity can then
filter to one import, and Undo import becomes possible later. It's additive:
`cleanEvent` keeps unknown fields, so an older build carries it through a
bundle.

### Bundle

- **Each storage change bumps `BUNDLE_VERSION`** when it ships, in whatever
  order they land:
  - `domain-asking-prices` (new);
  - `domain-prices` (new shape);
  - `manual-domains` (new).

  #108 planned v6 for manual domains; whichever change ships first takes the
  next number.

- **Older files still import.** A v5 or older file's renewal prices become
  USD amounts.
- **Remote sync** carries all three unchanged (`docs/remote-sync.md`).
- **Update `docs/storage-model.md`** (the namespace table, migrations, and
  bundle versions) as each one lands.

## Prices

### Asking price

- **Service:** `src/core/services/asking-prices.ts`.
  - `getAskingPrices()` returns every record.
  - `setAskingPrices(entries)` sets or clears prices for one name, a bulk
    edit, or an import, in one write.
  - Validation lives here: amounts with the currency's decimal places, and a
    minimum offer and floor no higher than the price.
- **API:** `getAskingPrices` and `setAskingPrices`, through the method table,
  IPC, preload, the HTTP client, and the demo.
- **Domains table (Owned):**
  - An Asking column beside Paid, right-aligned and sortable.
  - Clicking the cell opens the editor, as the Paid cell does.
  - Hidden in Archive. The record is kept.
- **Editor dialog,** titled "Asking price":
  - asking price, minimum offer, and floor price (marked "never shown to
    buyers");
  - currency, your preferred currency by default;
  - Clear.

  Amounts are typed in your number format, as in Purchase details.

- **Row menu:** "Asking price…" beside Purchase details.
- **Bulk bar:** "Set asking price…" applies one price to the selected names.
  "Clear asking prices" removes them.
- **Filter:** "Asking price: Set | Not set", to find names that still need
  one.
- **Demo:** the seed gives some names asking prices.
- **MCP** (#111): `portfolio_query` rows carry the asking price, and a tool
  sets it.

### Renewal prices in any currency

- **Pricing:** `resolvePricing` returns your price in its own currency.
  Registrar quotes keep theirs. TLD rates and the base table stay USD.
- **Editor:** the renewal price editor (today "Annual price (USD)") gets a
  currency picker. It defaults to the current estimate's currency, which is
  usually what the registrar bills in.
- **Display:** the Domains Renewal column and the Renewals page show each
  price in its own currency (`formatMoney`).
- **Totals:** `renewals.ts` sums each currency separately. The Renewals cards
  and charts show the currency most names renew in, and list any others
  beside it ("+ €45"). Converting waits for exchange rates (#112).
- **API:** `setManualPrice` takes `{ amount, currency }`, or null to clear.
- **MCP:** `domain_renewal_price` reports the currency.

## Import engine

### Reading the file

- **Formats:** `.csv`, `.tsv`, `.txt`, or pasted text. Up to 10,000 data rows
  (PR #122's limit) and 10 MB.
- **Encoding:** a BOM decides: UTF-8, or UTF-16 LE or BE (Excel's "Unicode
  text" export is UTF-16 TSV). Without a BOM, strict UTF-8, falling back to
  Windows-1252.
- **Delimiter:** comma, semicolon, tab, or pipe, whichever splits the first
  lines most consistently outside quotes. Sedo exports use semicolons.
- **CSV rules:**
  - RFC 4180 quotes and doubled quotes;
  - line breaks inside quotes;
  - CRLF, LF, or CR line endings;
  - trailing empty columns dropped (Afternic's template ends every line with
    a comma).
- **Header row:** the first of the first ten rows with a cell that matches a
  Domain alias. Rows above it (a sheet title, instructions) are skipped.
- **No header:** if the first row's first cell is a domain name, the file is
  a plain list of names.
- **Skipped rows:** blank rows, repeated header rows, and rows with nothing
  that looks like a domain (instructions, totals). They're counted as
  skipped, not as errors. A row whose domain cell fails validation is an
  error.

One module, `src/shared/csv.ts`, both reads and writes, so they share one set
of quoting rules. It takes over `csvField` from `src/renderer/lib/csv.ts` and
the parser from PR #122.

### Matching columns

- **Headers are normalized:**
  - lowercased;
  - `*`, `required`, and bracketed currency hints dropped (`Amount (USD)`
    remembers USD for that column);
  - spaces and punctuation stripped.

  So `Buy-Now Price`, `buy now price`, `BuyNowPrice`, and `buy_now_price` all
  match.

- **The alias table is data** (`src/shared/import-columns.ts`; see
  Appendix A). An exact normalized match wins.
- **One column per field, and one field per column.** The `IDN`, `Punycode`,
  and `Domain Name (ACE)` columns only fill in a blank `Domain`.
- **Ambiguous headers never match automatically:** `Amount`, `Value`,
  `Estimated Value`, `Date`, `Description`, `Category`, and Sedo's
  `Price Option`. You can still map them by hand.
- **Personal data and secrets never match automatically:** registrant,
  admin, tech, and billing contacts; email, phone, and address; auth codes.
  Unmapped columns are dropped in the renderer and never sent.
- **Known formats are recognized by their headers** (Appendix B). Each brings
  its own mapping, its value quirks, and a fixed Registrar ("Looks like a
  GoDaddy export"). DomBot's own export and template skip the matching step.
- **Values for every row:** Registrar, default currency, Folder, Status, and
  Purchase type can each be set once for the whole file. Every name in a
  park.io file is Purchased; every name in a GoDaddy export is at GoDaddy.
- **Mappings are remembered** for each header set, on this device, so the
  same export imports in one click next time.

### Normalized rows

This is what crosses to the server. A field that's absent was blank, which
means "keep".

```ts
interface ImportRow {
  line: number; // first file line, for messages
  domain: string; // toAscii
  status?: 'owned' | 'sold' | 'dropped' | 'archived' | 'removed';
  folder?: string; // folder name; 'Hidden' is the built-in
  notes?: string;
  registration?: {
    registrar?: RegistrarName | null;
    registrarLabel?: string;
    createdDate?: string;
    expirationDate?: string;
    autoRenew?: boolean;
  };
  renewal?: { amount?: string; currency?: CurrencyCode };
  asking?: {
    amount?: string;
    minOffer?: string;
    floor?: string;
    currency?: CurrencyCode;
  };
  purchase?: {
    type?: 'registered' | 'purchased';
    date?: string;
    amount?: string;
    currency?: CurrencyCode;
    years?: number;
  };
  sale?: { date?: string; amount?: string; currency?: CurrencyCode };
}
```

- **Duplicate rows** for a name merge into one `ImportRow`, cell by cell, and
  the later non-blank value wins. Each disagreement is a warning that names
  both lines.
- **Row checks:**
  - An amount needs a currency: from its cell, its column, its row, or the
    file's default.
  - A sale dated before its purchase is a warning.
  - A date in the future is a warning, except an expiry.

### Planning

`planImport` (`src/core/services/domain-import.ts`) is a dry run. It reads
the stored data into a snapshot, and the rules are a pure function over that
snapshot, so they test without a store.

For each name it returns one outcome: new (a manual name), update, unchanged,
history only (events for a name that isn't in Owned), or error. Each outcome
lists its changes (field, before, after) and its warnings.

**Where each name ends up:**

- **Archive (Sold):** the row has a sale, or `Status` is Sold.
- **Archive (Dropped or Archived):** `Status` says so.
- **Archive (Removed, waiting for a label):** `Status` is Removed, and no
  account holds the name.
- **Unchanged:** the name is held by an account.
- **Owned, as a manual name:** the name is in no account, and you haven't
  labeled it Sold, Dropped, or Archived. A buy-back also lands here. If the
  option says "Record history only", the name gets events only.
- **Unchanged, with a warning:** you labeled the name, and the row isn't a
  buy-back.

**What gets written:**

| Data          | Rule                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manual entry  | Created for a new Owned name. Its registration fields update, under the update policy. A name an account holds ignores those fields, and an info note says which account.                                                                                                                                                                                                            |
| `added`       | Written for each new manual name, with the `importId` and no account. It's an open, low-priority review, like a sync arrival, even when the row has a purchase. If the name has an open `removed` review (it left one of your accounts), the `added` closes it and is written already dismissed, the way sync handles a name that comes back.                                        |
| Purchase      | **No acquisition in the latest holding:** a new `purchased` or `registered`. It doesn't close any review. **Same values:** nothing. **Different values:** edited in place, or only the blanks are filled under "Only fill in what's missing". A purchase dated after the holding's sale is a buy-back, and it starts a new holding.                                                  |
| Sale          | **The latest holding has a sale:** edited in place, by the same rules. **Otherwise:** a new `sold`. It closes an open `removed` review and replaces your Dropped or Archived label (`replaceLabel`), the way Mark as Sold does.                                                                                                                                                      |
| Status        | **`Dropped` or `Archived`:** writes that label, closing an open `removed` review, unless it's already the label. **`Removed`:** an open `removed` review with no account, unless the name already has a label or a removal. **A name labeled Sold** keeps it, with a warning. **A name an account holds** ignores `Removed`, with a warning. **`Owned`:** writes nothing of its own. |
| Notes         | The name's note (`eventId: null`). It's replaced, or only set when there isn't one.                                                                                                                                                                                                                                                                                                  |
| Folder        | Assigned by name. Missing folders are created, and the preview lists them.                                                                                                                                                                                                                                                                                                           |
| Renewal price | Set in `domain-prices`, with its currency.                                                                                                                                                                                                                                                                                                                                           |
| Asking price  | Set in `domain-asking-prices`, for any name, synced or manual.                                                                                                                                                                                                                                                                                                                       |

**Event order.** A name's events are written in this order: added,
acquisition, sale, label. Ids are monotonic, and `ownershipByDomain` reads
events in id order, so each name lands where its row says.

### Applying

- **Re-plan first.** `importDomains` plans again against the current data,
  since the preview may be stale.
- **One write per namespace:**
  - `putEvents` for events;
  - `setNameNotes` (from PR #122) for notes;
  - the folder list, written once;
  - `setMany` for folder assignments, renewal prices, asking prices, and
    manual domains.

  Then it calls `broadcastPortfolioChanged()`.

- **Chunks.** The client sends rows in chunks of 2,000, all under one
  `importId`. That keeps each request well inside the Worker's per-request
  subrequest budget, since `d1-doc-store.ts` writes 100 rows per D1 batch.
- **A failed chunk** reports which rows were written. Running the import
  again is safe: rows already applied come back unchanged.
- **Large portfolios.** `namespace.ts` assumes every namespace fits in
  memory, and 10,000 manual names with history stretch that. It's fine at
  that size, but measure the Worker's per-isolate hydrate.

### API

```ts
previewDomainImport(
  rows: ImportRow[],
  options: ImportOptions,
): Promise<ImportPlan>;
importDomains(
  rows: ImportRow[],
  options: ImportOptions & { importId: string },
): Promise<ImportResult>;

interface ImportOptions {
  policy: 'update' | 'fill';
  notInAccounts: 'manual' | 'history';
}
```

- **Method table.** Both go through `src/core/api/index.ts`, with zod
  schemas in `schemas.ts`.
- **Strict schemas.** They accept canonical values only, since the lenient
  parsing already happened in the renderer.
- **They replace** `importPurchases` and its schema.

## UI

### Where it starts

- **Domains page:** an Import button and an Export menu ("Export this view",
  "Export everything") beside the Owned / Archive switch. On phones, they
  fold into one menu. The bulk bar's Export CSV stays, for selections.
- **Domains empty state:** Import domains beside Configure registrars, so
  DomBot is useful before any API key is added.
- **Settings → Sync:** a Spreadsheet card with Import domains, Export all
  domains, and Download template. It replaces PR #122's "Import purchase
  data" block. The backup card's copy mentions manual domains and asking
  prices.
- **Activity:** an import filter, reached from the import's result.

### The Import domains dialog

Wide on desktop, full screen on phones, in three steps.

1. **Choose a file.**
   - A drop zone, a file picker, or "Paste names" (one per line). Pasting is
     #108's Add domains: the "every row" values in the next step supply the
     registrar, folder, and purchase details.
   - A link to the template, and the limits.
2. **Match columns.**
   - One line per column in the file: its header, a few sample values, and
     "Import as" (a DomBot field, or Don't import), prefilled from the
     aliases.
   - A side panel for values that apply to every row: Registrar, default
     currency (your preferred currency), Folder, Status, and Purchase type.
   - Date order, shown only when it's ambiguous.
   - A banner when a known format is recognized.
   - Domain is the only required field.
3. **Review.**
   - Counts as filter chips: New, Updated, Unchanged, History only, Skipped,
     Errors.
   - A table of names, using the shared `DataTable`. Each row has a status
     badge and a short summary of its changes ("Paid $10 → $12 · Asking
     $2,500 · Folder Premium (new)"). Expand a row to see every field before
     and after, and its warnings.
   - The options:
     - "When DomBot already has a value: Replace | Keep";
     - "Names not in your accounts: Add to Owned | Record history only".

     Changing an option re-runs the preview.

   - "Download issues" saves a CSV with the row, the domain, and the
     problem.
   - The button says what it will do: "Import 460 names". Rows with errors
     are skipped; they never block the rest.

While the chunks apply, a progress bar shows. Then the result appears:
"Added 120 names, updated 340. The 120 new names wait for review." It has
two links:

- **View in Activity** opens everything the import wrote.
- **Review new names** opens Activity filtered to this import's open
  reviews, where you can select them all and dismiss them in one go.

The Domains table refreshes.

Copy follows the app's style: short, plain sentences, in sentence case.

### Export

- **One row per name.** `domainsToCsv` moves to the canonical column model:
  - "Export this view" writes the current filter and sort, Owned or
    Archive.
  - "Export everything" writes Owned and Archive together.
- **Shared row assembly.** Building the rows (synced, manual, and Archive)
  moves out of `Domains.tsx` into a shared helper. Settings, and later MCP
  (#111), then build exactly the same rows.
- The filename stays `dombot-domains-YYYY-MM-DD.csv`.

## Phases

1. **Asking price.**
   - `domain-asking-prices`, `cleanAskingPrice`, a bundle bump, the service,
     and the API.
   - The Domains column, the editor, the row menu item, the bulk actions,
     and the filter. Delete removes the record.
2. **Renewal prices in any currency.**
   - `domain-prices` values with a currency, migration 3, `cleanRenewalPrice`,
     and a bundle bump.
   - `resolvePricing`, the editor's currency picker, the Domains Renewal
     column, and Renewals totals per currency.
3. **Canonical export.**
   - `src/shared/csv.ts` (read and write) and the column model.
   - The new export: Status, the renewal and asking columns with their
     currencies, Purchase type, `IDN`, one row per name, and the Export menu.
   - No storage change, so you get the better export before import depends
     on the format.
4. **Manual domains** (#108's storage and display).
   - `manual-domains`, `cleanManualDomain`, and a bundle bump.
   - Rows in Domains and Renewals, with a Manual badge. Registrar-only
     actions are disabled, with the reason shown. An Edit details item in the
     row menu edits the registration fields.
   - The Domains subtitle and the tab counts include manual names.
   - Sync takeover with `moved`, including on an account's first sync.
     Delete removes the entry.
   - The zero-registrar empty state.
5. **Import engine.**
   - Lenient value parsers, header matching and known formats,
     normalization, and duplicate merging.
   - `planImport`, `importDomains`, and `importId`.
   - Reviewing an arrival opens the purchase recorded since it arrived,
     instead of starting a second one (`setPurchase`, `PurchaseDialog`).
   - Carries over `setNameNotes` and PR #122's tests.
6. **Import UI.**
   - The dialog, the entry points, the template, the Settings card, and
     Activity's import filter.

Phases 1 and 2 are independent of each other and of the rest. PR #122 is
closed, not merged: its button would be replaced in phase 6. Close it when
the phase 5 PR opens. Its branch can be that PR's base.

## Testing

- **Asking price:**
  - validation: decimal places, and a minimum offer or floor above the price;
  - clearing all three amounts deletes the record;
  - a bulk set is one write;
  - Delete removes the record;
  - a bundle round trip.
- **Renewal prices:**
  - migration 3 turns numbers into USD amounts, in the store and in an older
    bundle;
  - a price in another currency resolves, displays, and totals in its own
    currency;
  - Renewals totals each currency separately.
- **Value parsers** (`import-values.test.ts`): tables of input and expected
  output for:
  - money in every number format;
  - dates, including the order detection;
  - booleans, currencies, statuses, registrars, and domains.
- **Reading files:**
  - BOMs and encodings, and each delimiter;
  - quoted line breaks;
  - finding the header below title rows, and files with no header;
  - the 10,000-row limit.
- **Known formats:** one synthetic fixture per source in Appendix B. Each has
  its format's real header row, with made-up `example.*` names and values.
  Never copy real exports into the repo. Each fixture should map the way its
  row in the appendix says.
- **Planner:**
  - one test per rule in the planning table;
  - blank keeps, and "Only fill in what's missing";
  - names missing from the file are untouched;
  - nothing is deleted, and Sold is never replaced;
  - every new manual name waits for review, even when its row has a
    purchase;
  - a name with an open removal comes back without a new review;
  - reviewing an imported arrival edits its purchase instead of adding one;
  - `Removed` rows recreate a removal review;
  - manual entries versus history only;
  - duplicate merging, and buy-backs.
- **Round trip:**
  1. Seed a store. The demo seed has synced, Archive, and sold names.
  2. Export it, import into an empty store, and export again. The importable
     columns match.
  3. Import the first file a second time. Every row comes back unchanged,
     and nothing is written.
- **Bundle:** export and import with asking prices, renewal currencies, and
  manual domains; a v5 file still imports.
- **Worker:** a 10,000-row import stays within the subrequest budget, checked
  with a counting fake D1.
- **PR #122's tests** carry over as planner and parser cases.
- **By hand** (`docs/testing.md`): the template, a GoDaddy-style file, and a
  DomBot export, on desktop, web, and the demo.

## Later

- **Replace mode.** For when DomBot isn't your master list: an import option
  that makes DomBot match the file.
  - Manual names missing from the file go to Archive, labeled Archived, so
    their history stays. Nothing is deleted.
  - The preview lists every name that would leave.
  - Synced names stay, since their registrar is the authority.
  - Blank cells could clear values in this mode.
- **A sale's net amount** comes with venues and fees (#109), along with
  `Purchase venue` and `Sale venue` columns, matched by id or name. The
  previous app's `Sold Net` column is ignored until then.
- **Installment columns** come with #110.
- **Excel files.** Read the first sheet, with the parser loaded only when
  needed. Choose the library then:
  - SheetJS's npm package is old and has published advisories; its current
    builds ship from its own CDN.
  - `read-excel-file` handles `.xlsx` only.
- **Ledger CSV.** Activity export and import, one row per event: date,
  domain, type, amount, currency, account, source, note. It holds full
  history, and it's the shape tax software wants (#112).
- **Asking price history:** an event when a price changes. The dashboard
  (#112) can also show the portfolio's value at asking prices.
- **Bulk Record purchase on Activity**, with shared values (#108), for names
  waiting for review.
- **MCP** (#111): `portfolio_import`, which previews and applies canonical
  rows or CSV text, and `portfolio_export`.
- **Undo import:** remove the names and events with that `importId`.
- **Manual names and RDAP:** refresh manual names from RDAP (#105), and match
  registrars by IANA id (#123).
- **Marketplace exports** (export only). Each format is data: its columns,
  and a transform for each field. Only names with an asking price that
  aren't sold go out, sorted by name, with an optional percentage added to
  the asking price per marketplace. Notes to keep:
  - **Afternic:**
    - USD only, so convert other currencies; never relabel them.
    - Every column in its template must be present.
    - Quoted fields have been rejected.
    - The minimum offer is required.
    - Never write `0` as a floor price.
    - Batches of 100 or fewer upload most reliably.
    - Its Reconcile option removes listings that are missing from the file.
    - Afternic is part of GoDaddy now, so check the current format first.
  - **Sedo's uploader:**
    - Columns: domain, selling option (`BUY_NOW` with a price, `MAKE_OFFER`
      without), for sale, price, minimum price, currency (USD, EUR, or GBP),
      and action type (`DELETE` removes a listing).
    - Its Import mode adds and updates. Its Sync mode also removes.
  - **Dan** (domain, buy now, starting offer, description) is historical:
    Dan merged into Afternic.

## Settled in review

Decided on 2026-10-02:

1. **One row per name.** Duplicate rows merge cell by cell, and a ledger CSV
   comes later for full history.
2. **Every imported name waits for review**, like a new name sync finds, even
   when its row has a purchase. Bulk Dismiss handles big imports.
3. **Asking price is a core feature** for every name, synced or manual, with
   an optional minimum offer and floor.
4. **Every price has a currency**, renewal prices included.
5. **No sale net for now.** It comes with venues and fees (#109).
6. **`Domain` is exported in ASCII**, with the Unicode spelling in `IDN`.
7. **A zero amount is the same as a blank cell.**
8. **PR #122 is closed, not merged.** The import engine replaces it.
9. **Import only adds and updates.** It never removes names; a replace mode
   is a later option.
10. **`Status: Removed` recreates the review.** The name goes to Archive and
    waits for you to label it Sold, Dropped, or Archived, the same review
    sync raises. It isn't recorded as Archived.

No questions are open.

## Appendix A: header aliases

Matched after normalization: lowercased; `*`, `required`, and bracketed hints
dropped; spaces and punctuation stripped.

| Field                | DomBot header       | Also matches                                                                                                                     |
| -------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Domain               | `Domain`            | domain name, name, `*Name (Required)`, `Domain Name REQUIRED`, domain_name                                                       |
| Domain (fallback)    | `IDN`               | international domain name, punycode, unicode, `Domain Name (ACE)`                                                                |
| Status               | `Status`            | ownership; only matched when most values are ownership words (Hexonet's `ACTIVE clientTransferProhibited` is a registry status)  |
| Folder               | `Folder`            | folder name, group, groupname, FolderMemberships (takes the first folder, with a warning when there are several)                 |
| Registrar            | `Registrar`         | registrar name, sponsoring registrar                                                                                             |
| Created              | `Created`           | create date, created date, creation date, registration date, date registered, registered on                                      |
| Expires              | `Expires`           | expiration date, expiry, expiry date, expires on, date_expiration, paid until; `Renewal Date` only when there's no expiry column |
| Auto-renew           | `Auto-renew`        | auto renew, autorenew, auto_renew_enabled, auto renewal, renewal status, domain auto-renew status                                |
| Renewal price        | `Renewal price`     | renewal, renewal fee, renewal cost, renew price, annual renewal price                                                            |
| Renewal currency     | `Renewal currency`  | `Currency`, as the row's default                                                                                                 |
| Asking price         | `Asking price`      | asking, ask, buy now price, buy now, BIN, BIN price, buy it now, list price, price                                               |
| Minimum offer        | `Minimum offer`     | min offer, minimum price, min price, starting offer                                                                              |
| Floor price          | `Floor price`       | floor                                                                                                                            |
| Asking currency      | `Asking currency`   | `Currency`, as the row's default                                                                                                 |
| Purchase type        | `Purchase type`     | acquisition, acquired via, purchase method                                                                                       |
| Purchase date        | `Purchase date`     | purchased, purchased at, purchased on, date purchased, acquired, acquired at, acquisition date, paid date                        |
| Purchase amount      | `Purchase amount`   | purchase price, purchase cost, purchased price, cost, paid, amount paid, acquired price, acquisition cost                        |
| Purchase currency    | `Purchase currency` | `Currency`, as the row's default                                                                                                 |
| Purchase years       | `Purchase years`    | years, term, registration years                                                                                                  |
| Sale date            | `Sale date`         | sold date, sold, sold at, sold on, date sold                                                                                     |
| Sale amount          | `Sale amount`       | sale price, sold price, sold amount, sold for, selling price                                                                     |
| Sale currency        | `Sale currency`     | sold currency; `Currency`, as the row's default                                                                                  |
| Notes                | `Notes`             | note, domain note, comments, comment, memo                                                                                       |
| Row default currency | `Currency`          | curr, ccy                                                                                                                        |

Some columns aren't read yet:

- `For sale`, `Listed`, and `Listing Status` belong to marketplace export.
- `Sold Net` and other net or fee columns wait for venues and fees (#109).

## Appendix B: known formats

Each format is recognized by its header row. The test fixtures copy only the
headers.

| Source                            | Imports                                                                                                   | Quirks                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DomBot export or template         | everything in the format                                                                                  | exact headers, so no matching step                                                                                                                                              |
| PR #122 sample                    | purchase, notes                                                                                           | `Currency` is the purchase currency                                                                                                                                             |
| Previous app export or template   | names, purchase, sale, renewal price, asking price (`Price`), minimum offer, floor, notes                 | one `Currency` for every amount; `Sold Net` isn't read yet; the landing-page, `For Sale`, `Allow Offers`, and installment columns are ignored                                   |
| GoDaddy                           | names, created, expires, auto-renew, folder, renewal price; Registrar is GoDaddy                          | renewal prices written as `$ 18.99`; the contact columns are personal data and are never read; `Estimated Value` isn't a price you set; `Ownership Date` is left for you to map |
| Dynadot                           | names, created, expires, auto-renew, folder, notes; Registrar is Dynadot                                  | a UTF-8 BOM; dates like `2021/11/24 11:43 PST` (take the date as written); `Registration Date` appears twice, the second time as an epoch; `(no folder)`                        |
| Namecheap                         | names, expires, auto-renew; Registrar is Namecheap                                                        | dates like `Dec 13 2021`; `ON` and `OFF`                                                                                                                                        |
| Network Solutions                 | names, expires, auto-renew; Registrar is free text                                                        | `MM/DD/YYYY`; `true` and `false`; contact columns                                                                                                                               |
| Hexonet                           | names, expires (from `Renewal Date`)                                                                      | `Status` is a registry status                                                                                                                                                   |
| Sav                               | names, created, expires, auto-renew, folder, purchase, sale, asking price (`buy_now_price`)               | `1` and `0`; date-times; an auth-code column that's never read                                                                                                                  |
| park.io                           | names, purchase date (`Paid Date`), purchase amount (`Amount (USD)`), expires; Purchase type is Purchased | `Amount` here is what you paid                                                                                                                                                  |
| Efty                              | names, purchase, renewal price, status, sale, asking price (`BIN Price`), minimum offer                   | `0.00` means not set; `MM-DD-YYYY`; `Status` is `portfolio` or `sold`                                                                                                           |
| Afternic, older listings export   | names, asking price (`Buy Now Price`), minimum offer, floor                                               | `0` means not set; `GROUPNAME`                                                                                                                                                  |
| Afternic 2.0 export               | names, asking price (`Buy Now Price`), minimum offer, floor                                               | `0` means not set; `Listing Status` isn't read yet                                                                                                                              |
| Sedo export                       | names, asking price (`Price`), minimum offer, currency; Registrar from its legal name                     | semicolons; `Currency` appears twice; `Price Option` is ignored                                                                                                                 |
| Dan export (historical)           | names, asking price (`buy now`), minimum offer (`starting offer`)                                         | a `.txt` extension                                                                                                                                                              |
| Uniregistry template (historical) | names, asking price (`price`)                                                                             | instruction lines before the data; `for_sale` isn't read yet                                                                                                                    |
