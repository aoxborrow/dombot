# Domain import and export

How DomBot imports domains from a spreadsheet, along with what you paid, what
you sold them for, your renewal price, and your BIN price, and the one CSV
format it exports. Importing a DomBot export gets you back to the same data.
Storage follows [storage-model.md](storage-model.md).

Sources include DomBot's own CSV and template, registrar exports (GoDaddy,
Dynadot, Namecheap, …), marketplace exports (Afternic, Sedo, Efty, …), the
exports of an earlier portfolio app, and a pasted list of names. A name no
connected account reports becomes an **imported domain**: it shows in Owned or
Archive, Renewals, and Activity, takes folders, notes, prices, and history
like a synced name, survives Clear cache, and travels in the Settings → Sync
backup. You match columns, then review every change before anything is
written; a bad row is reported and skipped, never stopping the rest.

What it doesn't do:

- **Registrar actions on imported names.** Renew, nameservers, DNS, lock, and
  auto-renew need a connected account.
- **Remove names that are missing from the file.** Import only adds and
  updates.
- **A sale's net amount and fees.** They come with venues and fees (#109).
- **Landing-page fields** from other apps (headline, description, contact
  email, buy and contact links, analytics tag, redirect URL, "show in
  portfolio", listing installment terms). DomBot has no landing pages, so
  these columns are ignored.
- **Excel files.** CSV, TSV, and plain text only.
- **Full history in the CSV.** Earlier holdings, sync events, and alert
  state stay in the JSON backup.
- **Currency conversion.** Amounts keep their currency, as everywhere else.

## Design

### One row per name

The export has to be one line per name, for spreadsheets, other tools, and
marketplace uploads, and that same file has to import back. A row
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
- **History beyond the latest holding** (a name bought, sold, and bought
  back) stays in the JSON backup.
- **Full history** needs a ledger format (one row per event), kept apart from
  the domain list.

### BIN price is a core feature

The price you'd sell a name for is the **BIN price** in the app (its editor is
titled "Pricing"), `ListPrice` / `listPrices` in code, and the `Price`,
`Min offer`, `Floor price`, and `Price currency` columns in the CSV.

- **Every name can have one**, synced or imported. You set it from the Domains
  table, the row menu, or in bulk, and an import can set it too.
- **The record:**
  - a BIN price;
  - an optional minimum offer, the lowest offer you'll consider;
  - an optional floor, the lowest price you'd accept, never shown to buyers;
  - one currency for all three.
- **Whole amounts.** The editor rejects cents; an import rounds them, with a
  warning on the row.
- **It's keyed by name** in its own namespace (`domain-list-prices`), like
  notes, folders, and renewal prices. So it follows a name between accounts,
  survives Clear cache, and travels in the backup. Delete removes it.
- **It isn't a listing.** Setting a price doesn't list the name anywhere.
- **It isn't an event.** Changing a price rewrites the record; there's no
  price history.

### Every price has a currency

- **BIN prices, renewal prices, purchases, and sales** each carry their own
  currency: any code in `CURRENCIES`.
- **DomBot never converts.** Where it adds prices up (the Renewals page), it
  totals each currency separately. Exchange rates come with the financial
  dashboard (#112).

### Imported domains

- **A name a connected account reports** already has a row. The import adds
  your data to it: purchase, sale, notes, folder, renewal and BIN prices.
  The file's registrar columns are ignored, since the registrar is the
  authority.
- **A name no account reports, and that ends up Owned,** becomes a
  `imported-domains` entry. It shows in Owned with an Imported badge, and in
  Renewals when it has an expiry.
- **A name that ends up in Archive** (it has a sale, or a `Status` of Dropped,
  Archived, or Removed) gets no imported entry. Archive rows already come from
  events.
- **Status decides Owned or Archive.** There are no import options: a name
  goes to Archive when its row says so (a sale, or a `Status` other than
  Owned), and otherwise it's Owned.
- **When an account later reports an imported name**, sync removes the imported
  entry and writes `moved` from no account. Events, notes, folders,
  and prices are keyed by name, so they carry across.

### Imported names wait for review, like arrivals

- **Every new imported name writes an open `added`:** the same low-priority
  review a sync arrival raises. That holds even when its row has a purchase.
  The purchase is recorded, and the review still waits.
- **A name coming back isn't new.** Say a name left one of your accounts, so
  it has an open "Removed" review, and now you import it. The import closes
  that review and opens no new one. Sync does the same when a name comes
  back.
- **Reviewing never records a second purchase.** If a name already has a
  purchase recorded since it arrived (from the import, or entered from the
  Domains row), reviewing the arrival opens that purchase, and saving it
  closes the review.
- **Big imports:** on Activity, filter to the import, select every row, and
  use the bulk Dismiss review. The import result links straight there.
- **Source:** every added name writes `source: 'import'`, whether it came
  from a file or the Enter names tab, and Activity shows it as "Imported".
  DomBot doesn't tell the two apart.

### Lenient in, canonical out

Export writes exactly one spelling of everything: ASCII names, `YYYY-MM-DD`
dates, plain decimals with the currency's decimal places, ISO currency codes,
and Yes/No. Import accepts the many spellings real files use. Shared code
normalizes them before anything reaches the server.

### Import only adds and updates

- Names missing from the file are left alone.
- A blank cell never clears a stored value. A `0` clears it (except in a
  recognized marketplace export, where `0` means "not set").
- Import never deletes a name, a purchase, a sale, or a note.
- It replaces your Dropped or Archived label with Sold, the way Mark as Sold
  does, but it never replaces a Sold.
- A name you labeled goes back to Owned when its row says `Status: Owned`,
  or on a buy-back (a purchase dated after the name's sale). It's an `added`
  event, so the old label and sale stay in the history. With no `Status`,
  the name stays in Archive, with a warning.
- Changes it won't make show as warnings in the preview.
- A non-blank cell always replaces DomBot's value.

### Parse on the client, plan and write on the server

- **The renderer** reads the file, matches the columns, and normalizes the
  values, with shared code in `src/shared/`. Matching and errors show
  instantly, and the raw file never leaves the device.
- **The server** gets only the normalized rows. It checks them against
  strict schemas, then plans against the stored data. That planner is one
  piece of code for desktop, Worker, and demo.

## The DomBot CSV format

### Columns

In this order. "Imported names" means the column is imported only for names no
connected account reports.

| Column                      | Imported               | Notes                                                                          |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `Domain`                    | required               | ASCII (punycode). Import also takes Unicode, any case, and URL forms.          |
| `IDN`                       | when `Domain` is blank | the Unicode spelling, written only for internationalized names                 |
| `Status`                    | yes                    | `Owned`, `Sold`, `Dropped`, `Archived`, `Removed` (Archive's Status column)    |
| `Folder`                    | yes                    | a folder name, or `Hidden`; missing folders are created                        |
| `Registrar`                 | imported names         | DomBot's name for a known registrar, or free text (`Epik`)                     |
| `Account`                   | no                     | `Dynadot #2`, `Imported`, or both accounts when two hold the name              |
| `Created`                   | imported names         | the registration date                                                          |
| `Expires`                   | imported names         |                                                                                |
| `Auto-renew`                | imported names         | `Yes` or `No`                                                                  |
| `Renewal price`             | yes                    | the yearly price you set (`domain-prices`)                                     |
| `Renewal currency`          | yes                    |                                                                                |
| `Renewal estimate`          | no                     | the price DomBot uses: yours, a registrar quote, a TLD rate, or the base table |
| `Renewal estimate currency` | no                     |                                                                                |
| `Price`                     | yes                    | the BIN price, a whole amount                                                  |
| `Min offer`                 | yes                    | the lowest offer you'll consider                                               |
| `Floor price`               | yes                    | the lowest price you'd accept; never shown to buyers                           |
| `Price currency`            | yes                    | one currency for all three                                                     |
| `Purchase type`             | yes                    | `Registered` or `Purchased`                                                    |
| `Purchase date`             | yes                    |                                                                                |
| `Purchase amount`           | yes                    |                                                                                |
| `Purchase currency`         | yes                    |                                                                                |
| `Purchase years`            | yes                    | the registration or purchase term (`years`)                                    |
| `Sale date`                 | yes                    |                                                                                |
| `Sale amount`               | yes                    | the price, before fees                                                         |
| `Sale currency`             | yes                    |                                                                                |
| `TLD`                       | no                     |                                                                                |
| `Days until expiry`         | no                     |                                                                                |
| `Renewal date`              | no                     | as the registrar reports it                                                    |
| `Locked`                    | no                     |                                                                                |
| `Privacy`                   | no                     |                                                                                |
| `Nameservers`               | no                     | separated by `; `                                                              |
| `Registrar status`          | no                     | the registrar's own status                                                     |
| `Last synced`               | no                     |                                                                                |
| `Notes`                     | yes                    | the name's note; last, since it's long                                         |

- **The purchase and sale columns describe the latest holding:** the latest
  `registered` or `purchased` event, and the sale after it. That's the same
  summary the table shows (`getPurchases`).
- **`Currency` isn't written, but it's read.** It supplies the currency for
  any price in its row that has no currency of its own, as many other apps'
  files expect.
- **`Removed` comes back as a review.** In Archive, Removed means the name
  left one of your accounts and you haven't labeled it Sold, Dropped, or
  Archived yet. Import recreates that: the name goes to Archive with a
  Removed review waiting for a label, as sync left it. These are the
  higher-priority reviews, so a file with many Removed names keeps the bell
  amber until they're labeled or dismissed.
- **The template** (`dombot-domains-template.csv`) has the importable columns
  and three rows:
  - a hand-registered `example.com` with a renewal price;
  - a purchased `example.net` with a BIN price, a folder, and a note;
  - an `example.org` sold in EUR.

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
| Registrar     | display name                                            | an id (`namecom`), a display name, a website (`name.com`), or a legal name (`GoDaddy.com, LLC`, `Dynadot LLC`). Lowercase it, strip punctuation and company suffixes, then compare. Anything else is kept as free text.                                                          |
| Text          | as stored                                               | trimmed; the export's formula guard (a leading `'` before `=`, `+`, `-`, `@`, a tab, or a return) is removed, so notes survive a round trip                                                                                                                                      |

Money rules that keep bad data out:

- **A negative amount is an error.** So is an amount with more decimal places
  than its currency allows (`JPY 500.50`). Money is never rounded silently.
- **A zero amount clears the stored amount.** In a recognized marketplace
  export it's blank instead, because those use `0` to mean "not set".
- **A cell's own currency** (`€500`) must agree with its column's or row's
  currency. If it doesn't, that cell is an error.
- **A minimum offer or floor above the BIN price** is an error for the
  pricing group, as it is in the editor.
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
| the BIN price, minimum offer, floor, and their currency                        | settings, accounts, credentials                                             |
| registrar, created, expires, and auto-renew for imported names                 |                                                                             |

Names that were synced arrive as imported names. When you connect their
account, sync takes them over. Every Owned name arrives with a review
waiting, which an account's first sync doesn't do; bulk Dismiss clears them.
Importing the file back into the DomBot that exported it changes nothing.

## Storage

### `domain-list-prices`

The BIN price. Keyed by `toAscii(name)`, exported, and not a cache: a
per-name field gets its own small namespace.

```ts
interface ListPrice {
  amount: string | null; // whole amount; null when only offers are set
  minOffer?: string | null; // the lowest offer you'll consider
  floor?: string | null; // the lowest price you'd accept; never shown
  currency: string; // a code in CURRENCIES, for all three
  updatedAt: number; // ms epoch
}
```

- **At least one amount is set.** Clearing all three deletes the record.
- **A minimum offer or floor** can't be above the BIN price. A zero reads as
  blank.
- **"Allow offers" and "for sale" aren't stored.** A name with a BIN price is
  for sale, and a minimum offer (or no BIN price) means offers are welcome.
- **Bundle checks.** `cleanListPrice` re-checks entries read from a bundle,
  the way `cleanEvent` does for events.

### `domain-prices`

Your renewal price, keyed by `toAscii(name)`. It used to be a bare USD
number; it's now an amount and a currency:

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

### `imported-domains`

Keyed by `toAscii(name)`. It's exported, and it isn't a cache (the record is
also in [storage-model.md](storage-model.md#imported-domains-and-notes)):

```ts
interface ImportedDomain {
  registrar: RegistrarName | null; // a registrar DomBot knows, or null
  registrarLabel?: string | null; // free text otherwise, e.g. "Epik"
  expirationDate?: string | null; // YYYY-MM-DD
  createdDate?: string | null; // YYYY-MM-DD
  autoRenew?: boolean | null;
  addedAt: number; // ms epoch
  updatedAt: number | null; // ms epoch
  importId?: string | null; // the import that added it
}
```

- **Bundle checks.** `cleanImportedDomain` re-checks entries read from a
  bundle.
- **No accounts configured.** `hydrateFromCache` drops the registrar cache
  when no account is configured. Imported names don't live in that cache, so
  Domains still shows them. The "No registrars configured" empty state
  appears only when there are no imported names either, and it offers Import
  domains beside Configure registrars.
- **Which names an account holds** comes from `registrar-last-sync` for
  active accounts, not from the cache. It's exported and survives Clear
  cache, so an import right after Clear cache doesn't mistake synced names
  for imported ones.

### `importId` on events

`importId?: string` goes on every event an import writes, so Activity can
filter to one import. It's additive:
`cleanEvent` keeps unknown fields, so an older build carries it through a
bundle.

### Bundle

`domain-list-prices` (bundle v6), the currency on `domain-prices` (v7), and
`imported-domains` (v8) each bumped `BUNDLE_VERSION`; see
[storage-model.md](storage-model.md#data-bundle-versions). An older file's
renewal prices import as USD amounts.

## Prices

### BIN price

- **Service:** `src/core/services/list-prices.ts`: `getListPrices()`,
  `setListPrices(inputs)` (one name, a bulk edit, or an import, in one
  write), and `deleteListPrices(domains)`. Validation is shared with the
  bundle import and the CSV import (`src/shared/list-prices.ts`).
- **API:** `getListPrices` and `setListPrices`, through the method table.
- **Domains table (Owned):** a BIN price column; clicking the cell opens the
  Pricing editor, as the Paid cell opens Purchase details. The row menu and
  the bulk bar open the same editor for one name or the selection. The
  Pricing filter narrows by price range.
- **Editor:** BIN price, minimum offer, and floor price (marked "never shown
  to buyers"), in one currency, your preferred currency by default. Amounts
  are typed in your number format. All three blank clears the price.

### Renewal prices in any currency

- **Pricing:** `resolvePricing` returns your price in its own currency.
  Registrar quotes keep theirs. TLD rates and the base table stay USD.
- **Editor:** the renewal price editor has a currency picker. It defaults to
  the current estimate's currency, which is usually what the registrar bills
  in.
- **Display:** the Domains Renewal column and the Renewals page show each
  price in its own currency (`formatMoney`).
- **Totals:** `renewals.ts` sums each currency separately. The Renewals cards
  and charts show the currency most names renew in, and list any others
  beside it ("+ €45"). Nothing is converted.
- **API:** `setManualPrice` takes `{ amount, currency }`, or null to clear.
- **MCP:** `domain_renewal_price` reports the currency.

## Import engine

### Reading the file

- **Formats:** `.csv`, `.tsv`, `.txt`, or pasted text. Up to 10,000 data rows
  and 10 MB.
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
of quoting rules: RFC 4180 quoting, a formula guard (a `'` before any cell that
starts with `=`, `+`, `-`, or `@`), and a UTF-8 BOM so Excel shows accents
correctly.

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
    registrar?: string; // a registrar id DomBot knows
    registrarLabel?: string; // free text otherwise
    createdDate?: string;
    expirationDate?: string;
    autoRenew?: boolean;
  };
  renewal?: { amount: string; currency: string };
  listPrice?: {
    amount?: string;
    minOffer?: string;
    floor?: string;
    currency: string;
  };
  purchase?: {
    type?: 'registered' | 'purchased';
    date?: string;
    amount?: string;
    currency?: string;
    years?: number;
  };
  sale?: { date?: string; amount?: string; currency?: string };
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

For each name it returns one outcome: `new` (an imported name), `update`,
`unchanged`, or `history` (events for a name that's only in Archive). Each
outcome lists its changes (field, before, after) and its warnings. Rows with
errors never reach the planner; the renderer reports them.

**Where each name ends up:**

- **Archive (Sold):** the row has a sale, or `Status` is Sold.
- **Archive (Dropped or Archived):** `Status` says so.
- **Archive (Removed, waiting for a label):** `Status` is Removed, and no
  account holds the name.
- **Unchanged:** the name is held by an account.
- **Owned, as an imported name:** the name is in no account, and you haven't
  labeled it Sold, Dropped, or Archived, or the row says `Status: Owned`, or
  it's a buy-back.
- **Unchanged, with a warning:** you labeled the name, the row has no
  `Status`, and it isn't a buy-back.

**What gets written:**

| Data           | Rule                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Imported entry | Created for a new Owned name. Its registration fields update. A name an account holds ignores those fields, and an info note says which account.                                                                                                                                                                                                                                     |
| `added`        | Written for each new imported name, with the `importId` and no account. It's an open, low-priority review, like a sync arrival, even when the row has a purchase. If the name has an open `removed` review (it left one of your accounts), the `added` closes it and is written already dismissed, the way sync handles a name that comes back.                                      |
| Purchase       | **No acquisition in the latest holding:** a new `purchased` or `registered`. It doesn't close any review. **Same values:** nothing. **Different values:** edited in place. A purchase dated after the holding's sale is a buy-back, and it starts a new holding.                                                                                                                     |
| Sale           | **The latest holding has a sale:** edited in place, by the same rules. **Otherwise:** a new `sold`. It closes an open `removed` review and replaces your Dropped or Archived label (`replaceLabel`), the way Mark as Sold does.                                                                                                                                                      |
| Status         | **`Dropped` or `Archived`:** writes that label, closing an open `removed` review, unless it's already the label. **`Removed`:** an open `removed` review with no account, unless the name already has a label or a removal. **A name labeled Sold** keeps it, with a warning. **A name an account holds** ignores `Removed`, with a warning. **`Owned`:** writes nothing of its own. |
| Notes          | The name's note (`eventId: null`). It's replaced.                                                                                                                                                                                                                                                                                                                                    |
| Folder         | Assigned by name. Missing folders are created, and the preview lists them.                                                                                                                                                                                                                                                                                                           |
| Renewal price  | Set in `domain-prices`, with its currency.                                                                                                                                                                                                                                                                                                                                           |
| BIN price      | Set in `domain-list-prices`, for any name, synced or imported.                                                                                                                                                                                                                                                                                                                       |

**Event order.** A name's events are written in this order: added,
acquisition, sale, label. Ids are monotonic, and `ownershipByDomain` reads
events in id order, so each name lands where its row says.

### Applying

- **Re-plan first.** `importDomains` plans again against the current data,
  since the preview may be stale.
- **One write per namespace:**
  - `putEvents` for events;
  - `setNameNotes` for notes;
  - the folder list, written once;
  - `setMany` for folder assignments, renewal prices, BIN prices, and imported
    domains.

  Then it calls `broadcastPortfolioChanged()`.

- **Chunks.** The client sends rows in chunks of 2,000, all under one
  `importId`. That keeps each request well inside the Worker's per-request
  subrequest budget, since `d1-doc-store.ts` writes 100 rows per D1 batch.
- **A failed chunk** reports which rows were written. Running the import
  again is safe: rows already applied come back unchanged.
- **Large portfolios.** `namespace.ts` keeps every namespace in memory, so
  10,000 imported names with history is a practical ceiling for the Worker's
  per-isolate hydrate.

### API

```ts
previewDomainImport(
  rows: ImportRow[],
): Promise<ImportPlan>;
importDomains(
  rows: ImportRow[],
  options: { importId: string },
): Promise<ImportResult>;
```

- **Method table.** Both go through `src/core/api/index.ts`, with zod
  schemas in `schemas.ts`.
- **Strict schemas.** They accept canonical values only, since the lenient
  parsing already happened in the renderer.

## UI

### Where it starts

- **Domains page:** the Sync button's menu has **Import domains…** and
  **Export CSV** (This view, or Everything: Owned and Archive together). The
  bulk bar exports the selection.
- **Domains empty state:** Import domains beside Configure registrars, so
  DomBot is useful before any API key is added.
- **Settings → Sync:** a card with Import domains, Export all domains, and
  Download template (`dombot-domains-template.csv`).
- **Activity:** an import filter (`/activity?import=<id>`), reached from the
  import's result.

### The Import domains dialog

Two tabs, then a review.

1. **Enter names:** typed or pasted names, one per line, with a BIN price and a
   folder for all of them. Pasted names write `source: 'user'`.
2. **CSV upload:** a file, then **match columns**:
   - one line per column in the file: its header, sample values, and the
     DomBot field it imports as (or Don't import), prefilled from the
     aliases;
   - values that apply to every row: Registrar, default currency, Folder,
     Status, and Purchase type;
   - date order, shown only when it's ambiguous;
   - a banner when a known format is recognized.

   Domain is the only required field.

3. **Review:** counts as filter chips (New, Updated, Unchanged, Archive), a
   table of names with each row's changes and warnings, and "Download issues"
   for the rows that won't import. Rows with errors are skipped; they never
   block the rest.

The rows apply in chunks with a progress bar. The result says what was added
and updated, and **View in Activity** opens everything the import wrote, where
the new names' reviews can be dismissed in bulk.

### Export

- **One row per name**, in the canonical columns. Building the rows (synced,
  imported, and Archive) is shared, so Settings and the Domains page write the
  same file.
- The filename is `dombot-domains-YYYY-MM-DD.csv`.

## Follow-ups

Tracked in issues: CSV import follow-ups such as Excel files, a replace mode,
a ledger CSV, Undo import and marketplace exports
([#149](https://github.com/aoxborrow/dombot/issues/149)); venues and sale fees
([#109](https://github.com/aoxborrow/dombot/issues/109)); installments
([#110](https://github.com/aoxborrow/dombot/issues/110)); the financial
dashboard and exchange rates
([#112](https://github.com/aoxborrow/dombot/issues/112)); MCP import and export
([#111](https://github.com/aoxborrow/dombot/issues/111)).

## Appendix A: header aliases

Matched after normalization: lowercased; `*`, `required`, and bracketed hints
dropped; spaces and punctuation stripped.

| Field                | DomBot header       | Also matches                                                                                                                    |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Domain               | `Domain`            | domain name, name, domains, `*Name (Required)`, `Domain Name REQUIRED`, domain_name                                             |
| Domain (fallback)    | `IDN`               | international domain name, punycode, unicode, `Domain Name (ACE)`                                                               |
| Status               | `Status`            | ownership; only matched when most values are ownership words (Hexonet's `ACTIVE clientTransferProhibited` is a registry status) |
| Folder               | `Folder`            | folder name, group, groupname, FolderMemberships (takes the first folder, with a warning when there are several)                |
| Registrar            | `Registrar`         | registrar name, sponsoring registrar                                                                                            |
| Created              | `Created`           | create date, created date, creation date, registration date, date registered, registered on                                     |
| Expires              | `Expires`           | expiration date, domain expiration date, expiry, expiry date, expires on, date_expiration, paid until                           |
| Auto-renew           | `Auto-renew`        | auto renew, autorenew, auto_renew_enabled, auto renewal, renewal status, domain auto-renew status                               |
| Renewal price        | `Renewal price`     | renewal, renewal fee, renewal cost, renew price, annual renewal price                                                           |
| Renewal currency     | `Renewal currency`  | `Currency`, as the row's default                                                                                                |
| BIN price            | `Price`             | asking, ask, buy now price, buy now, BIN, BIN price, buy it now, list price                                                     |
| Minimum offer        | `Min offer`         | minimum offer, minimum price, min price, `*Minimum Offer (Required)`                                                            |
| Floor price          | `Floor price`       | floor                                                                                                                           |
| BIN price currency   | `Price currency`    | BIN currency; `Currency`, as the row's default                                                                                  |
| Purchase type        | `Purchase type`     | acquisition, acquired via, purchase method                                                                                      |
| Purchase date        | `Purchase date`     | purchased, purchased at, purchased on, date purchased, acquired, acquired at, acquisition date, paid date                       |
| Purchase amount      | `Purchase amount`   | purchase price, purchase cost, purchased price, cost, paid, amount paid, acquired price, acquisition cost                       |
| Purchase currency    | `Purchase currency` | `Currency`, as the row's default                                                                                                |
| Purchase years       | `Purchase years`    | years, term, registration years                                                                                                 |
| Sale date            | `Sale date`         | sold date, sold, sold at, sold on, date sold                                                                                    |
| Sale amount          | `Sale amount`       | sale price, sold price, sold amount, sold for, selling price                                                                    |
| Sale currency        | `Sale currency`     | sold currency; `Currency`, as the row's default                                                                                 |
| Notes                | `Notes`             | note, domain note, comments, comment, memo                                                                                      |
| Row default currency | `Currency`          | curr, ccy                                                                                                                       |

Some columns aren't read yet:

- `For sale`, `Listed`, and `Listing Status`: there's no listing status.
- `Sold Net` and other net or fee columns wait for venues and fees (#109).

## Appendix B: known formats

Each format is recognized by its header row. The test fixtures copy only the
headers.

| Source                            | Imports                                                                                                   | Quirks                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DomBot export or template         | everything in the format                                                                                  | exact headers, so no matching step                                                                                                                                              |
| Previous app export or template   | names, purchase, sale, renewal price, BIN price (`Price`), minimum offer, floor, notes                    | one `Currency` for every amount; `Sold Net` isn't read yet; the landing-page, `For Sale`, `Allow Offers`, and installment columns are ignored                                   |
| GoDaddy                           | names, created, expires, auto-renew, folder, renewal price; Registrar is GoDaddy                          | renewal prices written as `$ 18.99`; the contact columns are personal data and are never read; `Estimated Value` isn't a price you set; `Ownership Date` is left for you to map |
| Dynadot                           | names, created, expires, auto-renew, folder, notes; Registrar is Dynadot                                  | a UTF-8 BOM; dates like `2021/11/24 11:43 PST` (take the date as written); `Registration Date` appears twice, the second time as an epoch; `(no folder)`                        |
| Namecheap                         | names, expires, auto-renew; Registrar is Namecheap                                                        | dates like `Dec 13 2021`; `ON` and `OFF`                                                                                                                                        |
| Network Solutions                 | names, expires, auto-renew; Registrar is free text                                                        | `MM/DD/YYYY`; `true` and `false`; contact columns                                                                                                                               |
| Hexonet                           | names, expires (from `Renewal Date`)                                                                      | `Status` is a registry status                                                                                                                                                   |
| Sav                               | names, created, expires, auto-renew, folder, purchase, sale, BIN price (`buy_now_price`)                  | `1` and `0`; date-times; an auth-code column that's never read                                                                                                                  |
| park.io                           | names, purchase date (`Paid Date`), purchase amount (`Amount (USD)`), expires; Purchase type is Purchased | `Amount` here is what you paid                                                                                                                                                  |
| Efty                              | names, purchase, renewal price, status, sale, BIN price (`BIN Price`), minimum offer                      | `0.00` means not set; `MM-DD-YYYY`; `Status` is `portfolio` or `sold`                                                                                                           |
| Afternic, older listings export   | names, BIN price (`Buy Now Price`), minimum offer, floor                                                  | `0` means not set; `GROUPNAME`                                                                                                                                                  |
| Afternic 2.0 export               | names, BIN price (`Buy Now Price`), minimum offer, floor                                                  | `0` means not set; `Listing Status` isn't read yet                                                                                                                              |
| Sedo export                       | names, BIN price (`Price`), minimum offer, currency; Registrar from its legal name                        | semicolons; `Currency` appears twice; `Price Option` is ignored                                                                                                                 |
| Uniregistry template (historical) | names, BIN price (`price`)                                                                                | instruction lines before the data; `for_sale` isn't read yet                                                                                                                    |
