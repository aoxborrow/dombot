import type {
  BinPrice,
  BinPriceInput,
  ImportChange,
  ImportOutcome,
  ImportPlan,
  ImportRow,
  ManualDomain,
} from '../../shared/ipc';
import { HIDDEN_FOLDER_ID, builtInFolderName } from '../../shared/ipc';
import { sameBinPrice, toBinPrice } from '../../shared/bin-prices';
import { assertDomainName } from '../../shared/domain-name';
import {
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from '../../shared/domain-events';
import { ownershipByDomain } from '../../shared/ownership';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import type { RenewalPrice } from '../../shared/renewal-prices';
import { toCurrencyCode, type CurrencyCode } from '../../shared/currencies';
import { broadcastPortfolioChanged } from '../events';
import { getBinPrices, setBinPrices } from './bin-prices';
import {
  deleteDomainEvents,
  listEvents,
  nameNotes,
  newEvent,
  putEvents,
  setNameNotes,
} from './domain-events';
import { lastSyncedNames } from './domain-history';
import { assignFolders, createFolder, getFolders } from './folders';
import {
  cleanFields,
  getManualDomains,
  isKnownRegistrar,
  putManualDomains,
} from './manual-domains';
import { getManualPrices, setManualPrices } from './pricing';
import { holdings } from './purchases';
import { getCachedPortfolio } from './registrars';
import { listAccounts } from './accounts';

// The import planner (docs/domain-import-export.md, "Planning" and
// "Applying"). `planImport` is the preview: what each row would change, with
// nothing written. `importDomains` plans again against the current data and
// writes it, one write per namespace. The rules:
//
// - a blank (absent) field keeps what's stored, and a zero amount clears it;
// - names missing from the file are left alone, and nothing is deleted, but
//   a sale replaces your Dropped or Archived label, as Mark as Sold does;
// - a new manual name waits for review like a sync arrival, even with a
//   purchase in its row;
// - a value in the file replaces what DomBot has;
// - the row's Status decides Owned or Archive. With no Status a name stays
//   where it is; Owned on a name in Archive moves it back with an `added`.

const LABEL: Record<string, string> = {
  sold: 'Sold',
  dropped: 'Dropped',
  archived: 'Archived',
  removed: 'Removed',
};

/** A note, shortened for the preview. */
const clip = (text: string | undefined) =>
  text === undefined
    ? null
    : text.length > 60
      ? `${text.slice(0, 57).trimEnd()}…`
      : text;

/** A "0" in the file: clear the stored amount. */
const isZero = (amount?: string | null) => !!amount && Number(amount) === 0;

const money = (amount?: string | null, currency?: string | null) =>
  amount ? `${amount} ${currency ?? ''}`.trim() : null;

const binPriceText = (p: BinPrice | null | undefined) =>
  p
    ? [
        p.amount && `${p.amount} ${p.currency}`,
        p.minOffer && `min ${p.minOffer}`,
        p.floor && `floor ${p.floor}`,
      ]
        .filter(Boolean)
        .join(', ')
    : null;

/** What an apply writes, gathered while planning. */
interface Writes {
  manual: [string, ManualDomain][];
  events: DomainEvent[];
  deleteEvents: string[];
  notes: [string, string][];
  /** Folder name → the names to put in it (by name, created if missing). */
  folders: [string, string][];
  /** null clears the name's renewal price. */
  renewals: [string, RenewalPrice | null][];
  binPrice: BinPriceInput[];
}

function compute(
  rows: ImportRow[],
  importId: string | null,
  now: number,
): { plan: ImportPlan; writes: Writes } {
  const writes: Writes = {
    manual: [],
    events: [],
    deleteEvents: [],
    notes: [],
    folders: [],
    renewals: [],
    binPrice: [],
  };

  // The data as it stands.
  // Every account you have, enabled or not: a name one holds isn't manual.
  const accounts = listAccounts();
  const held = lastSyncedNames(accounts.map((a) => a.id));
  for (const d of getCachedPortfolio()?.domains ?? [])
    held.set(assertDomainName(d.domainName), d.accountId ?? d.registrar);
  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? a.label || a.registrar : id;
  };
  const manual = getManualDomains();
  const events = listEvents();
  const ownership = ownershipByDomain(events);
  const resolved = resolvedIds(events);
  const openRemoval = new Map<string, string>();
  for (const e of events)
    if (e.type === DomainEventType.Removed && isOpenAlert(e, resolved))
      openRemoval.set(e.domain, e.id);
  const owned = holdings();
  const notes = nameNotes();
  const { folders, assignments } = getFolders();
  const folderByName = new Map(
    folders.map((f) => [f.name.trim().toLowerCase(), f]),
  );
  const newFolders = new Map<string, string>();
  const renewals = getManualPrices();
  const binPrices = getBinPrices();

  const fresh = (fields: Omit<DomainEvent, 'id' | 'createdAt' | 'updatedAt'>) =>
    newEvent(
      {
        ...fields,
        source: DomainEventSource.Import,
        ...(importId ? { importId } : {}),
      },
      now,
    );

  const outcomes: ImportOutcome[] = [];
  for (const row of rows) {
    const key = assertDomainName(row.domain);
    const changes: ImportChange[] = [];
    const warnings: string[] = [];
    const change = (field: string, from: unknown, to: unknown) =>
      changes.push({
        field,
        from: from === null || from === undefined ? null : String(from),
        to: to === null || to === undefined ? null : String(to),
      });

    const account = held.get(key);
    const isManual = manual[key];
    const own = ownership.get(key);
    const label = own?.label ?? null;
    const userLabel = label && label !== 'removed' ? own!.event : null;
    const holding = owned.get(key);
    const rowSale = !!(
      row.sale?.date ||
      (row.sale?.amount && !isZero(row.sale.amount))
    );
    const buyBack = !!(
      row.purchase?.date &&
      holding?.sale?.date &&
      row.purchase.date > holding.sale.date
    );
    const toArchive =
      rowSale || (row.status !== undefined && row.status !== 'owned');
    // The row's Status decides Owned or Archive; with none, the name stays
    // where it is. A buy-back (a purchase after the sale) also brings it back.
    const moveBack =
      !!userLabel && !toArchive && (buyBack || row.status === 'owned');
    let created = false;

    // ── where the name lives ────────────────────────────────────────────────
    const fields = row.registration
      ? cleanFields({
          ...(row.registration.registrar !== undefined
            ? {
                registrar: isKnownRegistrar(row.registration.registrar)
                  ? row.registration.registrar
                  : null,
              }
            : {}),
          ...(row.registration.registrarLabel !== undefined
            ? { registrarLabel: row.registration.registrarLabel }
            : {}),
          ...(row.registration.createdDate !== undefined
            ? { createdDate: row.registration.createdDate }
            : {}),
          ...(row.registration.expirationDate !== undefined
            ? { expirationDate: row.registration.expirationDate }
            : {}),
          ...(row.registration.autoRenew !== undefined
            ? { autoRenew: row.registration.autoRenew }
            : {}),
        })
      : {};
    const regFields = Object.keys(fields) as (keyof typeof fields)[];
    if (account) {
      if (regFields.length > 0)
        warnings.push(
          `${accountName(account)} reports this name, so its registrar details come from there.`,
        );
    } else if (isManual) {
      const next: ManualDomain = { ...isManual };
      for (const f of regFields) {
        if (fields[f] === isManual[f]) continue;
        // A known registrar replaces a typed one, and the other way round.
        if (f === 'registrarLabel' && fields.registrar) continue;
        (next as unknown as Record<string, unknown>)[f] = fields[f];
        change(
          f === 'registrarLabel' ? 'Registrar' : FIELD_LABEL[f],
          isManual[f],
          fields[f],
        );
      }
      // A known registrar has no typed label.
      if (next.registrar) next.registrarLabel = null;
      if (changes.length > 0)
        writes.manual.push([key, { ...next, updatedAt: now }]);
    } else {
      const endsOwned = !toArchive && (!userLabel || moveBack);
      if (endsOwned) {
        created = true;
        writes.manual.push([
          key,
          {
            registrar: fields.registrar ?? null,
            registrarLabel: fields.registrar
              ? null
              : (fields.registrarLabel ?? null),
            createdDate: fields.createdDate ?? null,
            expirationDate: fields.expirationDate ?? null,
            autoRenew: fields.autoRenew ?? null,
            addedAt: now,
            updatedAt: null,
            ...(importId ? { importId } : {}),
          },
        ]);
        const removal = openRemoval.get(key);
        writes.events.push(
          fresh({
            domain: key,
            type: DomainEventType.Added,
            date: localDay(now),
            accountId: null,
            source: DomainEventSource.Import,
            // Coming back isn't new: close the departure, open nothing.
            ...(removal ? { resolves: removal, dismissed: true } : {}),
          }),
        );
        change('Status', userLabel ? LABEL[label!] : null, 'Owned');
      }
    }
    // A name you put in Archive goes back to Owned with an `added`, which
    // keeps its sale or label in the history (nothing is deleted).
    if (userLabel && !toArchive) {
      if (!moveBack)
        warnings.push(
          `It's in Archive as ${LABEL[label!]}, so it stays there. A Status of Owned moves it back.`,
        );
      else if (!created) {
        writes.events.push(
          fresh({
            domain: key,
            type: DomainEventType.Added,
            date: localDay(now),
            accountId: account ?? null,
            source: DomainEventSource.Import,
          }),
        );
        change('Status', LABEL[label!], 'Owned');
      }
    }

    // ── what you paid ───────────────────────────────────────────────────────
    const p = row.purchase;
    if (p) {
      const existing = buyBack ? undefined : holding?.acquisition;
      if (!existing) {
        const amount = isZero(p.amount) ? undefined : p.amount;
        if (p.date || amount) {
          writes.events.push(
            fresh({
              domain: key,
              type:
                p.type === 'registered'
                  ? DomainEventType.Registered
                  : DomainEventType.Purchased,
              source: DomainEventSource.Import,
              date: p.date ?? null,
              amount: amount ?? null,
              currency: (amount
                ? toCurrencyCode(p.currency ?? '')
                : null) as CurrencyCode | null,
              ...(p.years ? { years: p.years } : {}),
            }),
          );
          if (p.date) change('Purchase date', null, p.date);
          if (amount)
            change('Purchase amount', null, money(amount, p.currency));
        }
      } else {
        const next: DomainEvent = { ...existing };
        const type =
          p.type === 'registered'
            ? DomainEventType.Registered
            : p.type === 'purchased'
              ? DomainEventType.Purchased
              : undefined;
        if (type && type !== existing.type) {
          next.type = type;
          change('Purchase type', existing.type, type);
        }
        if (p.date && p.date !== existing.date) {
          next.date = p.date;
          change('Purchase date', existing.date, p.date);
        }
        if (isZero(p.amount)) {
          if (existing.amount) {
            next.amount = null;
            next.currency = null;
            change(
              'Purchase amount',
              money(existing.amount, existing.currency),
              null,
            );
          }
        } else if (
          p.amount &&
          (p.amount !== existing.amount || p.currency !== existing.currency)
        ) {
          next.amount = p.amount;
          next.currency = toCurrencyCode(p.currency ?? '') as CurrencyCode;
          change(
            'Purchase amount',
            money(existing.amount, existing.currency),
            money(p.amount, p.currency),
          );
        }
        if (p.years && p.years !== existing.years) {
          next.years = p.years;
          change('Purchase years', existing.years, p.years);
        }
        if (
          next !== existing &&
          changes.some((c) => c.field.startsWith('Purchase'))
        )
          writes.events.push({ ...next, updatedAt: now });
      }
    }

    // ── what it sold for, and its status ──────────────────────────────────
    /** A label event replacing your Dropped or Archived one (as Mark as Sold does). */
    const label_ = (
      type:
        | typeof DomainEventType.Sold
        | typeof DomainEventType.Dropped
        | typeof DomainEventType.Archived,
      extra: Partial<DomainEvent> = {},
    ) => {
      let resolves = openRemoval.get(key);
      if (userLabel && userLabel.type !== DomainEventType.Sold) {
        writes.deleteEvents.push(userLabel.id);
        resolves = userLabel.resolves ?? resolves;
      }
      writes.events.push(
        fresh({
          domain: key,
          type,
          source: DomainEventSource.Import,
          date: null,
          ...extra,
          ...(resolves ? { resolves } : {}),
        }),
      );
      change('Status', LABEL[label ?? ''] ?? 'Owned', LABEL[type]);
    };
    const s = row.sale;
    // A "0" sale amount alone clears the amount on a sale DomBot has.
    const clearsSale = !!s && isZero(s.amount) && !!holding?.sale && !buyBack;
    if (s && (rowSale || clearsSale)) {
      const existing = buyBack ? undefined : holding?.sale;
      if (existing) {
        const next: DomainEvent = { ...existing };
        let edited = false;
        if (s.date && s.date !== existing.date) {
          next.date = s.date;
          change('Sale date', existing.date, s.date);
          edited = true;
        }
        if (isZero(s.amount)) {
          if (existing.amount) {
            next.amount = null;
            next.currency = null;
            change(
              'Sale amount',
              money(existing.amount, existing.currency),
              null,
            );
            edited = true;
          }
        } else if (
          s.amount &&
          (s.amount !== existing.amount || s.currency !== existing.currency)
        ) {
          next.amount = s.amount;
          next.currency = toCurrencyCode(s.currency ?? '') as CurrencyCode;
          change(
            'Sale amount',
            money(existing.amount, existing.currency),
            money(s.amount, s.currency),
          );
          edited = true;
        }
        if (edited) writes.events.push({ ...next, updatedAt: now });
      } else if (label === 'sold' && !buyBack) {
        // Sold already, with no sale on this holding: nothing to add to.
      } else {
        const amount = isZero(s.amount) ? undefined : s.amount;
        label_(DomainEventType.Sold, {
          date: s.date ?? null,
          amount: amount ?? null,
          currency: (amount
            ? toCurrencyCode(s.currency ?? '')
            : null) as CurrencyCode | null,
        });
        if (s.date) change('Sale date', null, s.date);
        if (amount) change('Sale amount', null, money(amount, s.currency));
      }
    } else if (row.status && row.status !== 'owned') {
      const status = row.status;
      if (status === 'removed') {
        if (account)
          warnings.push(
            `${accountName(account)} still reports this name, so it isn't marked Removed.`,
          );
        else if (!label) {
          writes.events.push(
            fresh({
              domain: key,
              type: DomainEventType.Removed,
              source: DomainEventSource.Import,
              date: localDay(now),
              accountId: null,
            }),
          );
          change('Status', 'Owned', 'Removed');
        }
      } else if (label === status) {
        // Already labeled so.
      } else if (label === 'sold') {
        warnings.push(`It's Sold in DomBot, so it stays Sold.`);
      } else {
        label_(
          status === 'sold'
            ? DomainEventType.Sold
            : status === 'dropped'
              ? DomainEventType.Dropped
              : DomainEventType.Archived,
        );
      }
    }

    // ── your data about the name ──────────────────────────────────────────
    if (row.notes && row.notes !== notes[key]) {
      writes.notes.push([key, row.notes]);
      change('Notes', clip(notes[key]), clip(row.notes));
    }

    if (row.folder) {
      const name = row.folder.trim();
      const isHidden = name.toLowerCase() === 'hidden';
      const existing = folderByName.get(name.toLowerCase());
      const target = isHidden ? HIDDEN_FOLDER_ID : existing?.id;
      const current = assignments[key];
      const currentName = current
        ? (builtInFolderName(current) ??
          folders.find((f) => f.id === current)?.name ??
          null)
        : null;
      if ((target ?? `new:${name}`) !== current) {
        if (!target && !newFolders.has(name.toLowerCase()))
          newFolders.set(name.toLowerCase(), name);
        writes.folders.push([
          key,
          target ? (isHidden ? 'Hidden' : existing!.name) : name,
        ]);
        change(
          'Folder',
          currentName,
          target ? (isHidden ? 'Hidden' : existing!.name) : `${name} (new)`,
        );
      }
    }

    if (row.renewal && isZero(row.renewal.amount)) {
      const current = renewals[key];
      if (current) {
        writes.renewals.push([key, null]);
        change('Renewal price', money(current.amount, current.currency), null);
      }
    } else if (row.renewal) {
      const current = renewals[key];
      const next = {
        amount: row.renewal.amount,
        currency: toCurrencyCode(row.renewal.currency) as CurrencyCode,
      };
      if (
        current?.amount !== next.amount ||
        current?.currency !== next.currency
      ) {
        writes.renewals.push([key, next]);
        change(
          'Renewal price',
          money(current?.amount, current?.currency),
          money(next.amount, next.currency),
        );
      }
    }

    if (row.binPrice) {
      const current = binPrices[key];
      const sameCurrency = current?.currency === row.binPrice.currency;
      const merge = (field: 'amount' | 'minOffer' | 'floor') =>
        row.binPrice![field] ??
        (sameCurrency ? (current?.[field] ?? null) : null);
      const fields = {
        amount: merge('amount'),
        minOffer: merge('minOffer'),
        floor: merge('floor'),
      };
      if (fields) {
        try {
          const next = toBinPrice(
            { ...fields, currency: row.binPrice.currency },
            now,
          );
          if (!next && current) {
            writes.binPrice.push({
              domainName: key,
              amount: null,
              minOffer: null,
              floor: null,
              currency: current.currency,
            });
            change('BIN price', binPriceText(current), null);
          } else if (next && !sameBinPrice(current, next)) {
            writes.binPrice.push({
              domainName: key,
              amount: next.amount,
              minOffer: next.minOffer ?? null,
              floor: next.floor ?? null,
              currency: next.currency,
            });
            change('BIN price', binPriceText(current), binPriceText(next));
          }
        } catch (err) {
          warnings.push(
            `BIN price left as is: ${err instanceof Error ? err.message : 'not valid'}`,
          );
        }
      }
    }

    outcomes.push({
      line: row.line,
      domain: key,
      result: created
        ? 'new'
        : changes.length === 0
          ? 'unchanged'
          : !account && !isManual
            ? 'history'
            : 'update',
      changes,
      warnings,
    });
  }

  const counts = { new: 0, update: 0, unchanged: 0, history: 0 };
  for (const o of outcomes) counts[o.result]++;
  return {
    plan: { outcomes, counts, newFolders: [...newFolders.values()] },
    writes,
  };
}

const FIELD_LABEL: Record<string, string> = {
  registrar: 'Registrar',
  registrarLabel: 'Registrar',
  createdDate: 'Registered',
  expirationDate: 'Expires',
  autoRenew: 'Auto-renew',
};

/** What importing these rows would change. Writes nothing. */
export function planImport(rows: ImportRow[]): ImportPlan {
  return compute(rows, null, Date.now()).plan;
}

/**
 * Imports the rows: plans again against the current data (the preview may
 * be stale), then writes once per namespace. Returns what it did.
 */
export function importDomains(
  rows: ImportRow[],
  options: { importId: string },
): ImportPlan & { importId: string } {
  const { plan, writes } = compute(rows, options.importId, Date.now());

  putManualDomains(writes.manual);
  if (writes.deleteEvents.length > 0) deleteDomainEvents(writes.deleteEvents);
  if (writes.events.length > 0) putEvents(writes.events);
  setNameNotes(writes.notes);
  if (writes.folders.length > 0) {
    const ids = new Map(
      getFolders().folders.map((f) => [f.name.trim().toLowerCase(), f.id]),
    );
    ids.set('hidden', HIDDEN_FOLDER_ID);
    for (const name of plan.newFolders) {
      if (!ids.has(name.toLowerCase()))
        ids.set(
          name.toLowerCase(),
          createFolder({ name, description: '', color: 'gray' }).id,
        );
    }
    assignFolders(
      writes.folders.map(([domain, name]) => [
        domain,
        ids.get(name.trim().toLowerCase())!,
      ]),
    );
  }
  setManualPrices(writes.renewals);
  if (writes.binPrice.length > 0) setBinPrices(writes.binPrice);
  broadcastPortfolioChanged();
  return { ...plan, importId: options.importId };
}
