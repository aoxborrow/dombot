import type { RegistrationLookup } from '../../shared/ipc';
import { purchaseKey } from '../../shared/money';
import { Namespace } from '../storage/namespace';

// Public registration data for names that have left your accounts. History
// uses it so created and expires keep moving after you no longer hold the
// name. Not part of Clear cache: a day-old answer is still useful offline,
// and the next History visit refreshes anything older than a day.

const store = new Namespace<RegistrationLookup>('registration-lookups');
const FRESH_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, unknown[][]];
}
interface RdapDoc {
  events?: RdapEvent[];
  entities?: RdapEntity[];
}

function fresh(row: RegistrationLookup | undefined, now: number): boolean {
  if (!row) return false;
  const checked = Date.parse(row.checkedAt);
  return Number.isFinite(checked) && now - checked < FRESH_MS;
}

function eventDate(doc: RdapDoc, action: string): string | null {
  const date = doc.events?.find((event) => event.eventAction === action)
    ?.eventDate;
  if (!date || Number.isNaN(Date.parse(date))) return null;
  return date;
}

function registrarOf(doc: RdapDoc): string | null {
  for (const entity of doc.entities ?? []) {
    if (!entity.roles?.includes('registrar')) continue;
    const card = entity.vcardArray?.[1] ?? [];
    const fn = card.find((item) => item[0] === 'fn');
    if (typeof fn?.[3] === 'string' && fn[3].trim()) return fn[3].trim();
  }
  return null;
}

async function queryRdap(name: string): Promise<RegistrationLookup | null> {
  let response: Response;
  try {
    response = await fetch(`https://rdap.org/domain/${encodeURIComponent(name)}`, {
      redirect: 'follow',
      headers: { accept: 'application/rdap+json, application/json' },
    });
  } catch {
    return null;
  }
  const checkedAt = new Date().toISOString();
  if (response.status === 404) {
    return {
      registered: false,
      registrar: null,
      created: null,
      expires: null,
      checkedAt,
    };
  }
  if (!response.ok) return null;
  let doc: RdapDoc;
  try {
    doc = (await response.json()) as RdapDoc;
  } catch {
    return null;
  }
  return {
    registered: true,
    registrar: registrarOf(doc),
    created: eventDate(doc, 'registration'),
    expires: eventDate(doc, 'expiration'),
    checkedAt,
  };
}

async function pooled<T>(
  items: T[],
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await run(item);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Current public registration for each name. A hit younger than a day is
 * reused. A name left out of the result could not be reached.
 */
export async function lookupRegistrations(
  domainNames: string[],
): Promise<Record<string, RegistrationLookup>> {
  const now = Date.now();
  const keys = [
    ...new Set(
      domainNames.map((name) => purchaseKey(name)).filter((name) => name.includes('.')),
    ),
  ];
  const out: Record<string, RegistrationLookup> = {};
  const stale: string[] = [];
  for (const key of keys) {
    const cached = store.get(key);
    if (fresh(cached, now) && cached) out[key] = cached;
    else stale.push(key);
  }
  await pooled(stale, async (key) => {
    const row = await queryRdap(key);
    if (!row) return;
    void store.set(key, row);
    out[key] = row;
  });
  return out;
}
