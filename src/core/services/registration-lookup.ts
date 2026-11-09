import { rdapAuthorities, readRdapJson } from './rdap-authority';
import { qualifyCreationDate } from '../../shared/creation-date';
import type { Domain, RegistrationLookup } from '../../shared/ipc';
import { assertDomainName, toAscii } from '../../shared/domain-name';
import { userAgentHeaders } from '../app-info';
import { Namespace } from '../storage/namespace';
import { resolveRegistrar } from '../../shared/registrar-mapping';

// Public registration data for names that have left your accounts. Archive
// uses it so created and expires keep moving after you no longer hold the
// name. A cache: Clear cache drops it, and the next Archive visit refetches
// anything older than a day. All RDAP should move to one central module
// (issue #105).

const store = new Namespace<RegistrationLookup>('rdap-lookups', {
  cache: true,
});
const creationEvidence = new Namespace<RegistrationLookup>(
  'registry-creation-dates',
  { cache: true },
);
const FRESH_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;
const TIMEOUT_MS = 10_000;
const REDIRECTOR = 'rdap.org';

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  publicIds?: { type?: string; identifier?: string }[];
  vcardArray?: [string, unknown[][]];
  entities?: RdapEntity[];
}
interface RdapDoc {
  ldhName?: string;
  events?: RdapEvent[];
  entities?: RdapEntity[];
}

function fresh(row: RegistrationLookup | undefined, now: number): boolean {
  if (!row) return false;
  const checked = Date.parse(row.checkedAt);
  return Number.isFinite(checked) && now - checked < FRESH_MS;
}

function eventDate(doc: RdapDoc, action: string): string | null {
  const date = doc.events?.find(
    (event) => event?.eventAction === action,
  )?.eventDate;
  if (typeof date !== 'string' || !date || Number.isNaN(Date.parse(date)))
    return null;
  return date;
}

interface RdapRegistrar {
  name: string | null;
  ianaId: number | null;
  reseller: string | null;
}

function nameOf(entity: RdapEntity): string | null {
  const card = entity.vcardArray?.[1] ?? [];
  const fn = card.find((item) => item[0] === 'fn');
  return typeof fn?.[3] === 'string' && fn[3].trim() ? fn[3].trim() : null;
}

/** The first entity with a role, at the top level or nested (RFC 9083). */
function entityWithRole(
  entities: RdapEntity[] | undefined,
  role: string,
): RdapEntity | null {
  for (const entity of entities ?? []) {
    if (entity.roles?.includes(role)) return entity;
    const nested = entityWithRole(entity.entities, role);
    if (nested) return nested;
  }
  return null;
}

function registrarOf(doc: RdapDoc): RdapRegistrar {
  // A reseller the registrar sold the name through (iwantmyname at
  // Key-Systems, Hover at Tucows). Only some responses carry one.
  const resellerEntity = entityWithRole(doc.entities, 'reseller');
  const reseller = resellerEntity ? nameOf(resellerEntity) : null;
  for (const entity of doc.entities ?? []) {
    if (!entity.roles?.includes('registrar')) continue;
    const name = nameOf(entity);
    const id = entity.publicIds?.find(
      (pid) => pid.type?.toLowerCase() === 'iana registrar id',
    )?.identifier;
    const ianaId = id && /^\d+$/.test(id.trim()) ? Number(id.trim()) : null;
    if (name || ianaId != null) return { name, ianaId, reseller };
  }
  return { name: null, ianaId: null, reseller };
}

/** The row as returned: the stored lookup plus its mapped registrar (#123). */
function withMappedRegistrar(row: RegistrationLookup): RegistrationLookup {
  const mapped = row.registered
    ? resolveRegistrar({
        ianaId: row.registrarIanaId,
        name: row.registrar,
        reseller: row.reseller,
      })
    : null;
  return {
    ...row,
    registrarLabel: mapped?.label ?? null,
    mappedRegistrar: mapped?.registrar ?? null,
  };
}

/**
 * Whether a response came from the rdap.org redirector itself rather than the
 * registry it sends each TLD to. It answers 404 when it has no RDAP server for
 * the TLD, which says nothing about the name.
 */
function fromRedirector(response: Response): boolean {
  if (response.redirected) return false;
  try {
    return new URL(response.url).hostname === REDIRECTOR;
  } catch {
    return true;
  }
}

async function queryRdap(
  name: string,
  authority?: string,
): Promise<RegistrationLookup | null> {
  let response: Response;
  try {
    response = await fetch(
      authority
        ? new URL('domain/' + encodeURIComponent(name), authority).href
        : `https://${REDIRECTOR}/domain/${encodeURIComponent(name)}`,
      {
        redirect: authority ? 'manual' : 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: 'application/rdap+json, application/json',
          ...userAgentHeaders(),
        },
      },
    );
  } catch {
    return null;
  }
  const checkedAt = new Date().toISOString();
  // Only the registry's own 404 means the name is free; the redirector's is
  // unknown.
  if (response.status === 404 && (authority || !fromRedirector(response))) {
    return {
      registered: false,
      ...(authority
        ? {
            domainName: name,
            rdapUrl: new URL('domain/' + encodeURIComponent(name), authority)
              .href,
          }
        : {}),
      registrar: null,
      registrarIanaId: null,
      reseller: null,
      created: null,
      expires: null,
      checkedAt,
    };
  }
  if (!response.ok) return null;
  let doc: RdapDoc;
  try {
    doc = (await readRdapJson(response)) as RdapDoc;
    if (
      authority &&
      (typeof doc.ldhName !== 'string' || toAscii(doc.ldhName) !== name)
    )
      return null;
  } catch {
    return null;
  }
  if (authority) {
    if (!Array.isArray(doc.events)) return null;
    const registrationDates = new Set(
      doc.events
        .filter((e) => e?.eventAction === 'registration')
        .map((e) => e.eventDate),
    );
    const created = eventDate(doc, 'registration'),
      expires = eventDate(doc, 'expiration');
    if (
      registrationDates.size !== 1 ||
      !created ||
      !qualifyCreationDate({
        createdDate: new Date(created),
        expirationDate: expires ? new Date(expires) : null,
      }).createdDate
    )
      return null;
  }
  const registrar = registrarOf(doc);
  return {
    registered: true,
    ...(authority
      ? {
          domainName: name,
          rdapUrl: new URL('domain/' + encodeURIComponent(name), authority)
            .href,
        }
      : {}),
    registrar: registrar.name,
    registrarIanaId: registrar.ianaId,
    reseller: registrar.reseller,
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
  options: { authoritative?: boolean; refresh?: boolean } = {},
): Promise<Record<string, RegistrationLookup>> {
  const now = Date.now();
  const keys = [
    ...new Set(
      domainNames
        .map((name) => toAscii(name))
        .filter((name) => name.includes('.')),
    ),
  ];
  const out: Record<string, RegistrationLookup> = {};
  const stale: string[] = [];
  for (const key of keys) {
    const cached = store.get(key);
    if (
      !options.refresh &&
      fresh(cached, now) &&
      cached &&
      (!options.authoritative || (cached.domainName === key && cached.rdapUrl))
    )
      out[key] = withMappedRegistrar(cached);
    else stale.push(key);
  }
  const authorities =
    options.authoritative && stale.length ? await rdapAuthorities() : null;
  await pooled(stale, async (key) => {
    let authority: string | undefined;
    if (options.authoritative) {
      try {
        assertDomainName(key);
      } catch {
        return;
      }
      authority = authorities?.get(key.split('.').at(-1)!);
      if (!authority) return;
    }
    const row = await queryRdap(key, authority);
    if (!row) return;
    await store.set(key, row);
    if (options.authoritative) await creationEvidence.set(key, row);
    out[key] = withMappedRegistrar(row);
  });
  return out;
}

/**
 * What the last lookup said about each name being registered, from the cache
 * alone (no network): `toAscii` name → registered. Archive's Deleted label
 * reads it outside the app (MCP, export).
 */
export function cachedRegistered(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const [key, row] of Object.entries(store.all()))
    if (row && typeof row.registered === 'boolean')
      out.set(key, row.registered);
  return out;
}

/** Store lookups as if just fetched (the demo, whose names aren't real). */
export function rememberRegistrationLookups(
  rows: Record<string, RegistrationLookup>,
): void {
  void store.setMany(
    Object.entries(rows).map(([name, row]) => [toAscii(name), row]),
  );
}

/** Previously verified registry creation, for synchronous cache projections.
 * Age stays explicit in provenance; a failed refresh never erases known truth. */
export function cachedRegistryCreation(
  domain: string,
): Pick<Domain, 'createdDate' | 'createdDateSource'> | null {
  if (!creationEvidence.loaded) return null;
  const key = toAscii(domain),
    row = creationEvidence.get(key);
  if (
    !row?.registered ||
    row.domainName !== key ||
    !row.rdapUrl ||
    !row.created ||
    !Number.isFinite(Date.parse(row.checkedAt)) ||
    Date.parse(row.checkedAt) > Date.now() + 86_400_000
  )
    return null;
  const qualified = qualifyCreationDate({
    createdDate: new Date(row.created),
    expirationDate: row.expires ? new Date(row.expires) : null,
  });
  if (!qualified.createdDate) return null;
  return {
    createdDate: qualified.createdDate,
    createdDateSource: {
      kind: 'registry-rdap',
      url: row.rdapUrl,
      checkedAt: row.checkedAt,
    },
  };
}

/** A registry's explicit negative result invalidates older registry evidence. */
export function registryCreationMissing(domain: string): boolean {
  if (!creationEvidence.loaded) return false;
  const key = toAscii(domain),
    row = creationEvidence.get(key);
  return row?.domainName === key && row.registered === false;
}
