import {
  AbortError,
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
} from '../../shared/ipc';
import {
  expandTemplate,
  opSummary,
  unsupportedReason,
} from '../../shared/domain-ops';
import { broadcastPortfolioChanged } from '../events';
import {
  resolveDomainAccount,
  getCachedPortfolio,
  getDomainDetail,
  getRegistrarClient,
  getRegistrarFeatures,
  patchCachedDomain,
  renewDomainCached,
  setAutoRenewCached,
  setLockCached,
  setNameserversCached,
  setPrivacyCached,
} from './registrars';

// The single dispatcher for per-domain writes. Every caller — the `domain:apply`
// IPC handler behind a row control, the bulk-job runner, and the MCP `domain_*`
// tools — comes through here, so capability gating, cache patching, the
// portfolioChanged broadcast, and error classification happen in one place.
// See docs/domain-editing.md.

export interface ApplyOptions {
  /** Abort in-flight requests (bulk cancel). */
  signal?: AbortSignal;
  /**
   * Skip the per-op `portfolioChanged` broadcast. The bulk runner sets this and
   * broadcasts once at the end; the inline and MCP paths leave it off so an
   * open table reflects the change immediately.
   */
  silent?: boolean;
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

  // Gate up front so a known-unsupported op never makes a network call.
  const reason = unsupportedReason(
    target.registrar,
    getRegistrarFeatures(target.registrar),
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
    // of unknown outcome took effect.
    const before = cachedDomain(target);
    let result: DomainOpResult;
    try {
      result = await dispatch(target, op, request, done);
    } catch (err) {
      if (!(err instanceof OutcomeUnknownError)) throw err;
      result = done('unknown', err.message);
    }
    if (result.status === 'unknown')
      result = await settleUnknown(target, op, before, request, done);
    if (result.status === 'ok' && !opts.silent) broadcastPortfolioChanged();
    return result;
  } catch (err) {
    return done(classify(err), messageOf(err));
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
  if (op.kind === 'urlForwarding' || op.kind === 'emailForwarding')
    return done('unknown', UNCONFIRMED);
  if (request.signal?.aborted) return done('unknown', UNCONFIRMED);

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
      const set = (list: string[]) =>
        [...new Set(list.map((n) => n.trim().toLowerCase().replace(/\.$/, '')))]
          .sort()
          .join(' ');
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
): Promise<DomainOpResult> {
  // A provider `OperationResult` → ours. Soft failures (`success: false`) keep
  // the provider's message; successes fall back to a generic summary when the
  // provider's message is empty.
  const fromResult = (r: OperationResult, patch?: Partial<Domain>) =>
    r.success
      ? done('ok', r.message || opSummary(op), patch ? { patch } : {})
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
    case 'nameservers':
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
  }
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
