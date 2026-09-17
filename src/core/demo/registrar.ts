import {
  NotFoundError,
  NotImplementedError,
  createDomain,
  registrars,
  type ConnectionResult,
  type Contact,
  type ContactSet,
  type DnsRecord,
  type DnssecStatus,
  type Domain,
  type DomainAvailability,
  type DomainForward,
  type EmailForward,
  type ListDomainsOptions,
  type OperationResult,
  type RegisterDomainInput,
  type Registrar,
  type RegistrarFeature,
  type RegistrarName,
  type RequestOptions,
  type TldPricing,
  type TransferDomainInput,
} from '@aoxborrow/registrar-client';
import { getBaseRenewal } from '../services/base-pricing';

// A registrar that lives entirely in memory. It's what the product demo runs
// against: every read is served from a `DemoWorld` of invented domains, every
// write mutates that world and reports success, and nothing ever leaves the
// process. The app above it doesn't know the difference — it goes through the
// same `Registrar` interface and `RegistrarClient` as a real provider — so
// bulk jobs, detail panels, MCP tools and pricing all behave as they would
// against real accounts.
//
// One `DemoRegistrar` instance impersonates one (registrar, account) pair and
// advertises the *real* provider's feature list, so the UI gates ops exactly
// as it would for that registrar (Cloudflare still can't change nameservers,
// NameBright still has no DNSSEC, and so on). An op the real provider lacks
// throws the library's NotImplementedError, like the real one would.

/** Everything the demo knows about one domain, across every feature. */
export interface DemoDomainRecord {
  domainName: string;
  registrar: RegistrarName;
  accountId: string;
  status: string;
  createdDate: Date;
  expirationDate: Date;
  autoRenew: boolean;
  locked: boolean;
  privacy: boolean;
  nameservers: string[];
  contacts: ContactSet;
  dnsRecords: DnsRecord[];
  emailForwards: EmailForward[];
  domainForwards: DomainForward[];
  dnssec: DnssecStatus;
  authCode: string;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** The shared dataset every DemoRegistrar reads and writes. */
export class DemoWorld {
  private readonly records = new Map<string, DemoDomainRecord>();

  constructor(records: Iterable<DemoDomainRecord> = []) {
    for (const r of records) this.records.set(key(r.domainName), r);
  }

  get(domainName: string): DemoDomainRecord | undefined {
    return this.records.get(key(domainName));
  }

  add(record: DemoDomainRecord): void {
    this.records.set(key(record.domainName), record);
  }

  remove(domainName: string): void {
    this.records.delete(key(domainName));
  }

  /** Records belonging to one account, in insertion order. */
  list(registrar: RegistrarName, accountId: string): DemoDomainRecord[] {
    return [...this.records.values()].filter(
      (r) => r.registrar === registrar && r.accountId === accountId,
    );
  }

  all(): DemoDomainRecord[] {
    return [...this.records.values()];
  }

  get size(): number {
    return this.records.size;
  }
}

function key(domainName: string): string {
  return domainName.trim().toLowerCase();
}

export interface DemoRegistrarOptions {
  /** Simulated round-trip time per call, ms (0 in tests; a hundred or so in
   *  the demo so progress is visible). A function is read on every call, so
   *  a host can boot fast and then turn the pacing on. */
  latencyMs?: number | (() => number);
}

export class DemoRegistrar implements Registrar {
  readonly environment = 'production' as const;
  readonly requiresNameserversFetch = false;
  readonly features: readonly RegistrarFeature[];
  private readonly latency: () => number;

  constructor(
    readonly name: RegistrarName,
    readonly accountId: string,
    private readonly world: DemoWorld,
    options: DemoRegistrarOptions = {},
  ) {
    this.features = registrars[name].features;
    const l = options.latencyMs ?? 0;
    this.latency = typeof l === 'function' ? l : () => l;
  }

  supports(feature: RegistrarFeature): boolean {
    return this.features.includes(feature);
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  private async call<T>(
    feature: RegistrarFeature,
    opts: RequestOptions | undefined,
    fn: () => T,
  ): Promise<T> {
    if (!this.supports(feature)) {
      throw new NotImplementedError(
        `${registrars[this.name].displayName} does not support ${feature}`,
      );
    }
    const latencyMs = this.latency();
    if (latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, latencyMs);
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
    opts?.signal?.throwIfAborted();
    return fn();
  }

  private record(domainName: string): DemoDomainRecord {
    const r = this.world.get(domainName);
    if (!r || r.registrar !== this.name || r.accountId !== this.accountId) {
      throw new NotFoundError(`Domain ${domainName} not found in this account`);
    }
    return r;
  }

  private ok(message: string): OperationResult {
    return { success: true, message };
  }

  private toDomain(r: DemoDomainRecord): Domain {
    return createDomain({
      domainName: r.domainName,
      registrar: this.name,
      status: r.status,
      createdDate: r.createdDate,
      expirationDate: r.expirationDate,
      renewalDate: r.expirationDate,
      autoRenew: r.autoRenew,
      locked: r.locked,
      privacy: r.privacy,
      nameservers: r.nameservers,
      syncedAt: new Date(),
    });
  }

  // ── reads ────────────────────────────────────────────────────────────────

  testConnection(opts?: RequestOptions): Promise<ConnectionResult> {
    return this.call('testConnection', opts, () => ({
      success: true,
      message: 'Connected (demo)',
    }));
  }

  listDomains(opts?: ListDomainsOptions): Promise<Domain[]> {
    return this.call('listDomains', opts, () => {
      const q = opts?.search?.toLowerCase();
      return this.world
        .list(this.name, this.accountId)
        .filter((r) => !q || r.domainName.includes(q))
        .map((r) => this.toDomain(r));
    });
  }

  getDomain(domainName: string, opts?: RequestOptions): Promise<Domain> {
    return this.call('getDomain', opts, () =>
      this.toDomain(this.record(domainName)),
    );
  }

  getNameservers(domainName: string, opts?: RequestOptions): Promise<string[]> {
    return this.call('getNameservers', opts, () => [
      ...this.record(domainName).nameservers,
    ]);
  }

  checkAvailability(
    domainNames: string[],
    opts?: RequestOptions,
  ): Promise<DomainAvailability[]> {
    return this.call('checkAvailability', opts, () =>
      domainNames.map((domainName) => {
        const taken = this.world.get(domainName) !== undefined;
        // Deterministic but varied: names with an even hash are available.
        const available = !taken && hash(domainName) % 3 !== 0;
        const price = getBaseRenewal(this.name, tldOf(domainName));
        return {
          domainName,
          available,
          ...(available && price !== null
            ? { price, currency: 'USD', period: 1 }
            : {}),
        };
      }),
    );
  }

  getPricing(tldOrDomain: string, opts?: RequestOptions): Promise<TldPricing> {
    return this.call('getPricing', opts, () => {
      const tld = tldOrDomain.includes('.') ? tldOf(tldOrDomain) : tldOrDomain;
      const renewal = getBaseRenewal(this.name, tld);
      return {
        tld,
        currency: 'USD',
        ...(renewal !== null
          ? { registration: renewal, renewal, transfer: renewal }
          : {}),
      };
    });
  }

  getContacts(domainName: string, opts?: RequestOptions): Promise<ContactSet> {
    return this.call('getContacts', opts, () =>
      cloneContacts(this.record(domainName).contacts),
    );
  }

  getDnsRecords(
    domainName: string,
    opts?: RequestOptions,
  ): Promise<DnsRecord[]> {
    return this.call('getDnsRecords', opts, () =>
      this.record(domainName).dnsRecords.map((r) => ({ ...r })),
    );
  }

  getEmailForwarding(
    domainName: string,
    opts?: RequestOptions,
  ): Promise<EmailForward[]> {
    return this.call('getEmailForwarding', opts, () =>
      this.record(domainName).emailForwards.map((f) => ({ ...f })),
    );
  }

  getDomainForwarding(
    domainName: string,
    opts?: RequestOptions,
  ): Promise<DomainForward[]> {
    return this.call('getDomainForwarding', opts, () =>
      this.record(domainName).domainForwards.map((f) => ({ ...f })),
    );
  }

  getAuthCode(domainName: string, opts?: RequestOptions): Promise<string> {
    return this.call(
      'getAuthCode',
      opts,
      () => this.record(domainName).authCode,
    );
  }

  getDnssec(domainName: string, opts?: RequestOptions): Promise<DnssecStatus> {
    return this.call('getDnssec', opts, () => {
      const d = this.record(domainName).dnssec;
      return {
        enabled: d.enabled,
        dsRecords: d.dsRecords.map((r) => ({ ...r })),
      };
    });
  }

  // ── writes: mutate the world, report success ─────────────────────────────

  registerDomain(
    domainName: string,
    input: RegisterDomainInput,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('registerDomain', opts, () => {
      if (this.world.get(domainName)) {
        return {
          success: false,
          message: `${domainName} is already registered`,
        };
      }
      const now = new Date();
      this.world.add({
        domainName: key(domainName),
        registrar: this.name,
        accountId: this.accountId,
        status: 'active',
        createdDate: now,
        expirationDate: new Date(
          now.getTime() + (input.years ?? 1) * MS_PER_YEAR,
        ),
        autoRenew: input.autoRenew ?? true,
        locked: true,
        privacy: input.privacy ?? true,
        nameservers: input.nameservers?.length
          ? [...input.nameservers]
          : defaultNameservers(this.name),
        contacts: cloneContacts(input.contacts),
        dnsRecords: [],
        emailForwards: [],
        domainForwards: [],
        dnssec: { enabled: false, dsRecords: [] },
        authCode: authCodeFor(domainName),
      });
      return this.ok(`Registered ${domainName}`);
    });
  }

  transferIn(
    domainName: string,
    input: TransferDomainInput,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('transferIn', opts, () => {
      const existing = this.world.get(domainName);
      const now = new Date();
      const base = existing?.expirationDate ?? now;
      this.world.add({
        domainName: key(domainName),
        registrar: this.name,
        accountId: this.accountId,
        status: 'active',
        createdDate: existing?.createdDate ?? now,
        expirationDate: new Date(
          base.getTime() + (input.years ?? 1) * MS_PER_YEAR,
        ),
        autoRenew: input.autoRenew ?? existing?.autoRenew ?? true,
        locked: true,
        privacy: input.privacy ?? existing?.privacy ?? true,
        nameservers: existing?.nameservers ?? defaultNameservers(this.name),
        contacts: cloneContacts(input.contacts ?? existing?.contacts ?? {}),
        dnsRecords: existing?.dnsRecords ?? [],
        emailForwards: existing?.emailForwards ?? [],
        domainForwards: existing?.domainForwards ?? [],
        dnssec: existing?.dnssec ?? { enabled: false, dsRecords: [] },
        authCode: authCodeFor(domainName),
      });
      return this.ok(`Transfer of ${domainName} started`);
    });
  }

  renewDomain(
    domainName: string,
    years = 1,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('renewDomain', opts, () => {
      const r = this.record(domainName);
      r.expirationDate = new Date(
        r.expirationDate.getTime() + years * MS_PER_YEAR,
      );
      r.status = 'active';
      return this.ok(
        `Renewed ${domainName} for ${years} year${years === 1 ? '' : 's'}`,
      );
    });
  }

  setAutoRenew(
    domainName: string,
    enabled: boolean,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('setAutoRenew', opts, () => {
      this.record(domainName).autoRenew = enabled;
      return this.ok(`Auto-renew ${enabled ? 'enabled' : 'disabled'}`);
    });
  }

  updateNameservers(
    domainName: string,
    nameservers: string[],
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('updateNameservers', opts, () => {
      this.record(domainName).nameservers = nameservers.map((ns) =>
        ns.trim().toLowerCase(),
      );
      return this.ok('Nameservers updated');
    });
  }

  lockDomain(
    domainName: string,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('lockDomain', opts, () => {
      this.record(domainName).locked = true;
      return this.ok('Transfer lock enabled');
    });
  }

  unlockDomain(
    domainName: string,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('unlockDomain', opts, () => {
      this.record(domainName).locked = false;
      return this.ok('Transfer lock disabled');
    });
  }

  setPrivacy(
    domainName: string,
    enabled: boolean,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('setPrivacy', opts, () => {
      this.record(domainName).privacy = enabled;
      return this.ok(`WHOIS privacy ${enabled ? 'enabled' : 'disabled'}`);
    });
  }

  updateContacts(
    domainName: string,
    contacts: ContactSet,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('updateContacts', opts, () => {
      const r = this.record(domainName);
      r.contacts = { ...r.contacts, ...cloneContacts(contacts) };
      return this.ok('Contacts updated');
    });
  }

  setDnsRecords(
    domainName: string,
    records: DnsRecord[],
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('setDnsRecords', opts, () => {
      this.record(domainName).dnsRecords = records.map((r) => ({ ...r }));
      return this.ok('DNS records updated');
    });
  }

  setEmailForwarding(
    domainName: string,
    forwards: EmailForward[],
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('setEmailForwarding', opts, () => {
      this.record(domainName).emailForwards = forwards.map((f) => ({ ...f }));
      return this.ok('Email forwarding updated');
    });
  }

  setDomainForwarding(
    domainName: string,
    forwards: DomainForward[],
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('setDomainForwarding', opts, () => {
      this.record(domainName).domainForwards = forwards.map((f) => ({ ...f }));
      return this.ok('URL forwarding updated');
    });
  }

  disableDnssec(
    domainName: string,
    opts?: RequestOptions,
  ): Promise<OperationResult> {
    return this.call('disableDnssec', opts, () => {
      this.record(domainName).dnssec = { enabled: false, dsRecords: [] };
      return this.ok('DNSSEC disabled');
    });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function tldOf(domainName: string): string {
  const dot = domainName.indexOf('.');
  return dot === -1 ? '' : domainName.slice(dot + 1).toLowerCase();
}

/** The nameservers a registrar hands out by default. */
export function defaultNameservers(registrar: RegistrarName): string[] {
  const table: Record<RegistrarName, string[]> = {
    cloudflare: ['ada.ns.cloudflare.com', 'rob.ns.cloudflare.com'],
    dynadot: ['ns1.dynadot.com', 'ns2.dynadot.com'],
    gandi: ['ns-1.gandi.net', 'ns-2.gandi.net', 'ns-3.gandi.net'],
    godaddy: ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'],
    namebright: ['ns1.namebrightdns.com', 'ns2.namebrightdns.com'],
    namecheap: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'],
    namecom: ['ns1.name.com', 'ns2.name.com', 'ns3.name.com', 'ns4.name.com'],
    namesilo: ['ns1.dnsowl.com', 'ns2.dnsowl.com', 'ns3.dnsowl.com'],
    porkbun: [
      'curitiba.ns.porkbun.com',
      'fortaleza.ns.porkbun.com',
      'maceio.ns.porkbun.com',
      'salvador.ns.porkbun.com',
    ],
    spaceship: ['launch1.spaceship.net', 'launch2.spaceship.net'],
  };
  return [...table[registrar]];
}

/** A stable, obviously-fake EPP code for a name. */
export function authCodeFor(domainName: string): string {
  const h = hash(domainName).toString(36).toUpperCase().padStart(8, 'X');
  return `DEMO-${h.slice(0, 4)}-${h.slice(4, 8)}`;
}

/** FNV-1a, 32-bit — deterministic across hosts, no crypto needed. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function cloneContacts(set: ContactSet): ContactSet {
  const out: ContactSet = {};
  for (const role of ['registrant', 'admin', 'tech', 'billing'] as const) {
    const c: Contact | undefined = set[role];
    if (c) out[role] = { ...c };
  }
  return out;
}
