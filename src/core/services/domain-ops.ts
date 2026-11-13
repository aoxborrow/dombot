import {
  AbortError,
  Feature,
  NotImplementedError,
  OutcomeUnknownError,
  RateLimitError,
  type OperationResult,
  type RequestOptions,
} from '@aoxborrow/registrar-client';
import type {
  Domain,
  DomainOp,
  DomainOpResult,
  DomainOpStatus,
  DomainTarget,
  DomainTransferOut,
} from '../../shared/ipc';
import {
  expandTemplate,
  isRegistrarDefaultSet,
  missingFeatureReason,
  opSummary,
  unsupportedReason,
} from '../../shared/domain-ops';
import {
  dnsRecordLine,
  opChange,
  type KnownSettings,
  type SettingChange,
} from '../../shared/domain-changes';
import {
  DomainEventSource,
  DomainSetting,
  type DomainEvent,
  type UserSource,
} from '../../shared/domain-events';
import { registrarHostsDns } from '../../shared/market-verification';
import {
  normalizeNameserver,
  normalizeNameservers,
} from '../../shared/domain-name';
import { toCurrencyCode } from '../../shared/currencies';
import { parseCanonicalAmount } from '../../shared/money';
import { broadcastPortfolioChanged } from '../events';
import { changeEvent } from './domain-changes';
import { putEvents } from './domain-events';
import { recordRenewals, type ConfirmedRenewal } from './domain-history';
import {
  resolveDomainAccount,
  getCachedDomainDetail,
  getCachedPortfolio,
  getDomainDetail,
  getRegistrarClient,
  getDomainFeatures,
  patchCachedDomain,
  renewDomainCached,
  setAutoRenewCached,
  setLockCached,
  setNameserversCached,
  resetNameserversCached,
  setPrivacyCached,
} from './registrars';

// The single dispatcher for per-domain writes. Every caller — the `domain:apply`
// IPC handler behind a row control, the bulk-job runner, and the MCP `domain_*`
// tools — comes through here, so capability gating, cache patching, the
// portfolioChanged broadcast, error classification, and the history (a
// `renewed` or `changed` event) happen in one place. See docs/domain-editing.md.

export interface ApplyOptions {
  /** Abort in-flight requests (bulk cancel). */
  signal?: AbortSignal;
  /**
   * Skip the per-op `portfolioChanged` broadcast. The bulk runner sets this and
   * broadcasts once at the end; the inline and MCP paths leave it off so an
   * open table reflects the change immediately.
   */
  silent?: boolean;
  /**
   * Collect confirmed renewals here instead of recording each one: the bulk
   * runner writes a slice's `renewed` events in one batch.
   */
  renewals?: ConfirmedRenewal[];
  /**
   * Collect `changed` events here instead of saving each one: the bulk runner
   * writes a slice's in one batch.
   */
  changes?: DomainEvent[];
  /** Who asked, for the history: you (the default), a bulk job, or an agent. */
  source?: UserSource | typeof DomainEventSource.Bulk;
}

/**
 * Applies `op` to `target` at its registrar. Never throws for a registrar-side
 * outcome: the result's `status` carries it (`unsupported` / `failed` /
 * `rate-limited` / `cancelled` / `skipped`), with the provider's own message
 * where there is one. Only a programming error escapes.
 */
export async function applyDomainOp(
  target: DomainTarget,
  op: DomainOp,
  opts: ApplyOptions = {},
): Promise<DomainOpResult> {
  const done = (
    status: DomainOpStatus,
    message: string,
    extra: Pick<DomainOpResult, 'patch' | 'data'> = {},
  ): DomainOpResult => ({ target, status, message, ...extra });

  // Nameservers go to the registrar, the caches and the history in one
  // spelling (some registrars refuse capitals), whoever asked.
  if (op.kind === 'nameservers')
    op = { ...op, nameservers: normalizeNameservers(op.nameservers) };
  // A registrar's own default hosts go back as a reset, so the registrar
  // hosts the DNS again rather than seeing them as custom nameservers.
  if (
    op.kind === 'nameservers' &&
    !op.registrarDefault &&
    isRegistrarDefaultSet(target.registrar, op.nameservers) &&
    getDomainFeatures(target).includes(Feature.ResetNameservers)
  )
    op = { ...op, registrarDefault: true };

  // Gate up front so a known-unsupported op never makes a network call.
  const reason = unsupportedReason(
    target.registrar,
    getDomainFeatures(target),
    op,
  );
  if (reason) return done('unsupported', reason);

  const request: RequestOptions = { signal: opts.signal };
  try {
    const account = resolveDomainAccount(
      target.registrar,
      target.domainName,
      target.accountId,
    );
    target = { ...target, accountId: account.id };
    // What the domain looked like going in, to tell afterwards whether a write
    // of unknown outcome took effect, and what a setting was before.
    const before = cachedDomain(target);
    const known = knownSettings(before, account.id, target.domainName);
    const seen: Seen = { known };
    let result: DomainOpResult;
    try {
      result = await dispatch(target, op, request, done, seen);
    } catch (err) {
      if (!(err instanceof OutcomeUnknownError)) throw err;
      result = done('unknown', err.message);
    }
    if (result.status === 'unknown') {
      result = await settleUnknown(target, op, before, request, done);
      // A reset confirmed by re-reading: the history gets the hosts read.
      if (
        op.kind === 'nameservers' &&
        op.registrarDefault &&
        result.status === 'ok' &&
        result.patch?.nameservers
      )
        seen.change = opChange(
          { kind: 'nameservers', nameservers: result.patch.nameservers },
          target.domainName,
          known,
        );
    }
    if (op.kind === 'renew' && result.status === 'ok')
      noteRenewal(
        {
          domainName: target.domainName,
          accountId: account.id,
          years: op.years,
          charge: seen.charge ?? null,
        },
        opts,
      );
    if (result.status === 'ok') {
      const change =
        seen.change !== undefined
          ? seen.change
          : opChange(op, target.domainName, known);
      if (change) noteChange(target.domainName, account.id, change, opts);
    }
    if (result.status === 'ok' && !opts.silent) broadcastPortfolioChanged();
    return result;
  } catch (err) {
    return done(classify(err), messageOf(err));
  }
}

/**
 * What a dispatch saw beyond its result: the charge a renewal reported, and
 * the change a write worked out itself (a TXT record: the records before and
 * after), in place of the one the op implies.
 */
interface Seen {
  charge?: ConfirmedRenewal['charge'];
  change?: SettingChange | null;
  /** What DomBot knew going in, for a write that works out its own change. */
  known?: KnownSettings;
}

/**
 * A confirmed renewal becomes a `renewed` event (an `unknown` one writes
 * nothing; sync records it once the expiry moves). Recording never fails the
 * op: the renewal happened either way.
 */
function noteRenewal(renewal: ConfirmedRenewal, opts: ApplyOptions): void {
  if (opts.renewals) {
    opts.renewals.push(renewal);
    return;
  }
  try {
    recordRenewals([renewal], opts.source ?? DomainEventSource.User);
  } catch (err) {
    console.error('[domain-history] recording the renewal failed', err);
  }
}

/**
 * A setting the registrar confirmed changing becomes a `changed` event. Like
 * a renewal, recording never fails the op: the change happened either way.
 */
function noteChange(
  domainName: string,
  accountId: string,
  change: SettingChange,
  opts: ApplyOptions,
): void {
  try {
    const event = changeEvent(
      domainName,
      change,
      opts.source ?? DomainEventSource.User,
      { accountId },
    );
    if (opts.changes) opts.changes.push(event);
    else putEvents([event]);
  } catch (err) {
    console.error('[domain-history] recording the change failed', err);
  }
}

/**
 * What DomBot knew of a name's settings before a write, for the `before` of
 * its `changed` event: the fetched detail first, then the list row. A list
 * row without nameservers came from a registrar whose list doesn't carry
 * them, and that list's privacy and lock aren't reliable either (the same
 * rule the table uses to decide what to look up). Never throws: a cache it
 * can't read means nothing known, not a write that doesn't happen.
 */
function knownSettings(
  row: Domain | undefined,
  accountId: string,
  domainName: string,
): KnownSettings {
  try {
    const detail = getCachedDomainDetail(accountId, domainName);
    const listed = !!row?.nameservers?.length;
    const nameservers = detail?.nameservers?.length
      ? detail.nameservers
      : listed
        ? row!.nameservers
        : undefined;
    return {
      autoRenew: detail?.autoRenew ?? row?.autoRenew,
      privacy: detail?.privacy ?? (listed ? row!.privacy : undefined),
      lock: detail?.locked ?? (listed ? row!.locked : undefined),
      nameservers,
    };
  } catch {
    return {};
  }
}

/**
 * What the registrar charged for a renewal, when its response says.
 * registrar-client's `OperationResult` may carry an optional
 * `charge: { amount, currency }`; anything malformed reads as no charge, so
 * an estimate is never stored as if it were paid.
 */
export function chargeOf(result: OperationResult): ConfirmedRenewal['charge'] {
  const charge = (result as { charge?: unknown }).charge;
  if (!charge || typeof charge !== 'object') return null;
  const { amount, currency } = charge as {
    amount?: unknown;
    currency?: unknown;
  };
  if (typeof currency !== 'string') return null;
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const code = toCurrencyCode(currency);
  if (!code) return null;
  try {
    const canonical = parseCanonicalAmount(String(amount), code, 'Charge');
    return canonical ? { amount: canonical, currency: code } : null;
  } catch {
    return null;
  }
}

function cachedDomain(target: DomainTarget): Domain | undefined {
  const name = target.domainName.toLowerCase();
  return getCachedPortfolio()?.domains.find(
    (d) =>
      d.registrar === target.registrar &&
      d.domainName.toLowerCase() === name &&
      (d.accountId ?? d.registrar) === (target.accountId ?? target.registrar),
  );
}

const UNCONFIRMED =
  'The registrar did not confirm this change, so it may or may not have been applied. Check the domain before trying again.';
const NOT_APPLIED =
  'The registrar did not receive this change. Nothing was changed, and it is safe to try again.';

/**
 * A write timed out, lost its connection, or got a 5xx, so registrar-client
 * refused to re-send it and reported the outcome as unknown. Rather than hand
 * that to the user, re-read the domain and look:
 *
 *  - the change is there → `ok`, with the caches patched as a success would;
 *  - it isn't, and repeating the op is harmless → `failed`, safe to try again;
 *  - it isn't, but the op costs money (a renewal may still be processing), or
 *    the domain can't be re-read, or the op has no field to check → `unknown`.
 */
async function settleUnknown(
  target: DomainTarget,
  op: DomainOp,
  before: Domain | undefined,
  request: RequestOptions,
  done: Done,
): Promise<DomainOpResult> {
  // Asking for the code again is harmless, and there is nothing to re-read.
  if (op.kind === 'authCode')
    return done(
      'failed',
      'The registrar did not return the auth code. It is safe to try again.',
    );
  // Approving one that already went through is refused, nothing more.
  if (op.kind === 'approveTransfer')
    return done(
      'failed',
      'The registrar did not confirm the approval. It is safe to try again.',
    );
  if (op.kind === 'urlForwarding' || op.kind === 'emailForwarding')
    return done('unknown', UNCONFIRMED);
  if (request.signal?.aborted) return done('unknown', UNCONFIRMED);
  // The records are there or they aren't; adding them again skips any that
  // are.
  if (op.kind === 'txtRecords') {
    try {
      const records = await getRegistrarClient(
        target.registrar,
        target.accountId,
      ).getDnsRecords(target.domainName, request);
      return op.values.every((v) =>
        records.some((r) => isRootTxt(r, target.domainName, v)),
      )
        ? done(
            'ok',
            `${opSummary(op)} (the response was lost, so this was confirmed by re-reading the records)`,
          )
        : done('failed', NOT_APPLIED);
    } catch {
      return done('unknown', UNCONFIRMED);
    }
  }

  // A reset named no hosts, so a re-read has nothing to match.
  if (
    op.kind === 'nameservers' &&
    op.registrarDefault &&
    op.nameservers.length === 0
  )
    return done('unknown', UNCONFIRMED);

  let now: Partial<Domain> | null;
  try {
    now = await getDomainDetail(
      target.registrar,
      target.domainName,
      true,
      target.accountId,
    );
  } catch {
    return done('unknown', UNCONFIRMED);
  }
  if (!now) return done('unknown', UNCONFIRMED);

  const confirmed = (patch: Partial<Domain>) => {
    patchCachedDomain(
      target.registrar,
      target.domainName,
      patch,
      target.accountId,
    );
    return done(
      'ok',
      `${opSummary(op)} (the response was lost, so this was confirmed by re-reading the domain)`,
      { patch },
    );
  };

  switch (op.kind) {
    case 'autoRenew':
      if (now.autoRenew === undefined) return done('unknown', UNCONFIRMED);
      return now.autoRenew === op.enabled
        ? confirmed({ autoRenew: op.enabled })
        : done('failed', NOT_APPLIED);
    case 'privacy':
      if (now.privacy === undefined) return done('unknown', UNCONFIRMED);
      return now.privacy === op.enabled
        ? confirmed({ privacy: op.enabled })
        : done('failed', NOT_APPLIED);
    case 'lock':
      if (now.locked === undefined) return done('unknown', UNCONFIRMED);
      return now.locked === op.locked
        ? confirmed({ locked: op.locked })
        : done('failed', NOT_APPLIED);
    case 'nameservers': {
      if (!now.nameservers) return done('unknown', UNCONFIRMED);
      // A reset with hosts is a set of Gandi LiveDNS hosts written as one.
      // The registrar puts back its own hosts for the domain, not the ones
      // typed: a set of its defaults confirms it, but only when the domain
      // is known to have had other hosts before (it may already have had
      // them as custom nameservers). Anything else proves nothing either way.
      if (op.registrarDefault) {
        const hosts = normalizeNameservers(now.nameservers);
        const was = normalizeNameservers(before?.nameservers ?? []);
        const changed =
          was.length > 0 && !isRegistrarDefaultSet(target.registrar, was);
        return changed && isRegistrarDefaultSet(target.registrar, hosts)
          ? confirmed({ nameservers: hosts })
          : done('unknown', UNCONFIRMED);
      }
      const set = (list: string[]) =>
        [...new Set(list.map(normalizeNameserver))].sort().join(' ');
      return set(now.nameservers) === set(op.nameservers)
        ? confirmed({ nameservers: op.nameservers })
        : done('failed', NOT_APPLIED);
    }
    case 'renew': {
      const was = before?.expirationDate?.getTime();
      const is = now.expirationDate?.getTime();
      if (was !== undefined && is !== undefined && is > was) {
        const patch: Partial<Domain> = { expirationDate: now.expirationDate };
        if (now.renewalDate != null) patch.renewalDate = now.renewalDate;
        if (now.status != null) patch.status = now.status;
        return confirmed(patch);
      }
      // Never "safe to try again" here: registrars can take a while to show a
      // renewal, and a second one is charged.
      return done(
        'unknown',
        'The registrar did not confirm the renewal, and the expiry date has not moved yet. It may still be processing: check the domain at the registrar before renewing again.',
      );
    }
  }
}

type Done = (
  status: DomainOpStatus,
  message: string,
  extra?: Pick<DomainOpResult, 'patch' | 'data'>,
) => DomainOpResult;

async function dispatch(
  { registrar, domainName, accountId }: DomainTarget,
  op: DomainOp,
  request: RequestOptions,
  done: Done,
  seen: Seen,
): Promise<DomainOpResult> {
  // A provider `OperationResult` → ours. Soft failures (`success: false`) keep
  // the provider's message; successes fall back to a generic summary when the
  // provider's message is empty.
  const fromResult = (r: OperationResult, patch?: Partial<Domain>) =>
    r.success
      ? done(
          'ok',
          r.message || opSummary(op),
          patch && !r.pending ? { patch } : {},
        )
      : done(
          // Providers that fold errors into a result flag the unknown outcome
          // there; the ones that throw raise OutcomeUnknownError.
          r.outcome === 'unknown' ? 'unknown' : 'failed',
          r.message || `${opSummary(op)} failed`,
        );

  switch (op.kind) {
    case 'autoRenew':
      return fromResult(
        await setAutoRenewCached(
          registrar,
          domainName,
          op.enabled,
          request,
          accountId,
        ),
        { autoRenew: op.enabled },
      );
    case 'privacy':
      return fromResult(
        await setPrivacyCached(
          registrar,
          domainName,
          op.enabled,
          request,
          accountId,
        ),
        { privacy: op.enabled },
      );
    case 'lock':
      return fromResult(
        await setLockCached(
          registrar,
          domainName,
          op.locked,
          request,
          accountId,
        ),
        { locked: op.locked },
      );
    case 'nameservers': {
      if (op.registrarDefault) {
        const { result, nameservers } = await resetNameserversCached(
          registrar,
          domainName,
          request,
          accountId,
        );
        // The history records the hosts the registrar now reports; without
        // them there is no `after` to record.
        if (result.success && !result.pending)
          seen.change = nameservers
            ? opChange(
                { kind: 'nameservers', nameservers },
                domainName,
                seen.known ?? {},
              )
            : null;
        return fromResult(result, nameservers ? { nameservers } : undefined);
      }
      return fromResult(
        await setNameserversCached(
          registrar,
          domainName,
          op.nameservers,
          request,
          accountId,
        ),
        { nameservers: op.nameservers },
      );
    }
    case 'renew': {
      // Money: registrar-client never re-sends a write whose outcome is
      // unknown, so a timed-out renewal can't be charged twice. It does retry
      // one the registrar never received, which is safe.
      const { result, patch } = await renewDomainCached(
        registrar,
        domainName,
        op.years,
        request,
        accountId,
      );
      if (result.success) seen.charge = chargeOf(result);
      return fromResult(result, patch);
    }
    case 'urlForwarding': {
      const client = getRegistrarClient(registrar, accountId);
      if (op.skipIfExisting) {
        const current = await client.getDomainForwarding(domainName, request);
        if (current.length > 0) {
          return done(
            'skipped',
            `Already has ${current.length} URL forwarding rule${current.length === 1 ? '' : 's'}`,
          );
        }
      }
      // URL forwarding isn't a cached field, so there's no patch to return.
      // A bulk op carries one rule set for many targets: expand `{domain}`.
      const forwards = op.forwards.map((f) => ({
        ...f,
        url: expandTemplate(f.url, domainName),
      }));
      return fromResult(
        await client.setDomainForwarding(domainName, forwards, request),
      );
    }
    case 'emailForwarding': {
      const client = getRegistrarClient(registrar, accountId);
      if (op.skipIfExisting) {
        const current = await client.getEmailForwarding(domainName, request);
        if (current.length > 0) {
          return done(
            'skipped',
            `Already has ${current.length} email forwarding rule${current.length === 1 ? '' : 's'}`,
          );
        }
      }
      const forwards = op.forwards.map((f) => ({
        ...f,
        forwardTo: expandTemplate(f.forwardTo, domainName),
      }));
      return fromResult(
        await client.setEmailForwarding(domainName, forwards, request),
      );
    }
    case 'authCode': {
      // The RegistrarClient facade doesn't re-expose this extended method;
      // reach through to the provider (as the MCP tool always has).
      const authCode = await getRegistrarClient(
        registrar,
        accountId,
      ).provider.getAuthCode(domainName, request);
      return done('ok', opSummary(op), { data: { authCode } });
    }
    case 'approveTransfer':
      // Extended, like the auth code: reach through to the provider.
      return fromResult(
        await getRegistrarClient(
          registrar,
          accountId,
        ).provider.approveTransferOut(domainName, request),
      );
    case 'txtRecords': {
      const client = getRegistrarClient(registrar, accountId);
      // A record in the registrar's zone does nothing while the name's DNS
      // is elsewhere (another DNS host, or a market's nameservers).
      const nameservers = await client
        .getNameservers(domainName, request)
        .catch((err: unknown) => {
          if (err instanceof AbortError) throw err;
          return [] as string[];
        });
      if (!registrarHostsDns(registrar, nameservers)) {
        return done(
          'skipped',
          `Its DNS isn’t at the registrar (nameservers ${nameservers.join(', ')}). Add the TXT records where its DNS is hosted.`,
        );
      }
      // Registrars replace the whole record set: read, add, write back.
      const records = await client.getDnsRecords(domainName, request);
      const missing = [...new Set(op.values)].filter(
        (v) => !records.some((r) => isRootTxt(r, domainName, v)),
      );
      if (missing.length === 0) {
        return done(
          'skipped',
          op.values.length === 1
            ? 'Already has the TXT record'
            : 'Already has the TXT records',
        );
      }
      const next = [
        ...records,
        ...missing.map((value) => ({
          type: 'TXT',
          name: '@',
          value,
          ttl: 3600,
        })),
      ];
      seen.change = {
        setting: DomainSetting.Dns,
        before: records.map(dnsRecordLine),
        after: next.map(dnsRecordLine),
      };
      // Say what was added, not the registrar's "records updated".
      const r = await client.setDnsRecords(domainName, next, request);
      const there = op.values.length - missing.length;
      const added = `Added ${missing.length === 1 ? 'a TXT record' : `${missing.length} TXT records`}${there ? ` (${there} already there)` : ''}`;
      return fromResult(r.success ? { ...r, message: added } : r);
    }
  }
}

/** A TXT record at the name's root holding `value` (quotes aside). */
function isRootTxt(
  r: { type: string; name: string; value: string },
  domainName: string,
  value: string,
): boolean {
  const name = r.name.trim().toLowerCase().replace(/\.$/, '');
  const root = name === '' || name === '@' || name === domainName.toLowerCase();
  return (
    root &&
    r.type.toUpperCase() === 'TXT' &&
    r.value.trim().replace(/^"|"$/g, '') === value
  );
}

/**
 * A domain's latest outbound transfer, read live from the account that holds
 * it (never cached): the request the buyer's registrar made with the auth
 * code, behind the Sales page's Approve transfer. Null when the registrar has
 * none on record. Throws when the registrar can't report one.
 */
export async function getTransferOut(
  target: DomainTarget,
  request: RequestOptions = {},
): Promise<DomainTransferOut | null> {
  if (!getDomainFeatures(target).includes(Feature.GetTransferOut))
    throw new Error(
      missingFeatureReason(
        target.registrar,
        Feature.GetTransferOut,
        'transfer-out reports',
      ),
    );
  const account = resolveDomainAccount(
    target.registrar,
    target.domainName,
    target.accountId,
  );
  const transfer = await getRegistrarClient(
    target.registrar,
    account.id,
  ).provider.getTransferOut(target.domainName, request);
  if (!transfer) return null;
  return {
    status: transfer.status,
    rawStatus: transfer.rawStatus,
    requestedAt: transfer.requestedDate?.toISOString() ?? null,
    expiresAt: transfer.expirationDate?.toISOString() ?? null,
    completedAt: transfer.completedDate?.toISOString() ?? null,
  };
}

function classify(err: unknown): DomainOpStatus {
  if (err instanceof NotImplementedError) return 'unsupported';
  if (err instanceof RateLimitError) return 'rate-limited';
  if (err instanceof AbortError) return 'cancelled';
  return 'failed';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
