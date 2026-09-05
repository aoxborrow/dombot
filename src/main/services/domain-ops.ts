import {
  AbortError,
  NotImplementedError,
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
  getRegistrarClient,
  getRegistrarFeatures,
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
    const result = await dispatch(target, op, request, done);
    if (result.status === 'ok' && !opts.silent) broadcastPortfolioChanged();
    return result;
  } catch (err) {
    return done(classify(err), messageOf(err));
  }
}

type Done = (
  status: DomainOpStatus,
  message: string,
  extra?: Pick<DomainOpResult, 'patch' | 'data'>,
) => DomainOpResult;

async function dispatch(
  { registrar, domainName }: DomainTarget,
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
      : done('failed', r.message || `${opSummary(op)} failed`);

  switch (op.kind) {
    case 'autoRenew':
      return fromResult(
        await setAutoRenewCached(registrar, domainName, op.enabled, request),
        { autoRenew: op.enabled },
      );
    case 'privacy':
      return fromResult(
        await setPrivacyCached(registrar, domainName, op.enabled, request),
        { privacy: op.enabled },
      );
    case 'lock':
      return fromResult(
        await setLockCached(registrar, domainName, op.locked, request),
        { locked: op.locked },
      );
    case 'nameservers':
      return fromResult(
        await setNameserversCached(
          registrar,
          domainName,
          op.nameservers,
          request,
        ),
        { nameservers: op.nameservers },
      );
    case 'renew': {
      // Money: never retry blind — a timed-out renew may already have gone
      // through. The client's retry loop is off for this call.
      const { result, patch } = await renewDomainCached(
        registrar,
        domainName,
        op.years,
        { ...request, retries: 0 },
      );
      return fromResult(result, patch);
    }
    case 'urlForwarding': {
      const client = getRegistrarClient(registrar);
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
      const client = getRegistrarClient(registrar);
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
      const authCode = await getRegistrarClient(registrar).provider.getAuthCode(
        domainName,
        request,
      );
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
