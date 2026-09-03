// Renderer-side helpers around domain operations: capability lookup against the
// loaded registrar metadata, and one toast per outcome so every control reports
// results the same way.

import { toast } from 'sonner';
import type {
  Domain,
  DomainOp,
  DomainOpResult,
  DomainTarget,
  RegistrarMeta,
  RegistrarName,
} from '../../shared/ipc';
import {
  OP_LABEL,
  opSummary,
  unsupportedReason,
} from '../../shared/domain-ops';
import { useAppStore } from '../store/app';

/** The IPC target for a row. */
export function targetOf(d: Domain): DomainTarget {
  return { registrar: d.registrar as RegistrarName, domainName: d.domainName };
}

/**
 * Why `registrar` can't run `op`, or null when it can (or when the registrar
 * metadata hasn't loaded yet — main gates again, so an unknown list errs on
 * the side of offering the control).
 */
export function opUnsupportedReason(
  registrars: RegistrarMeta[] | null,
  registrar: string,
  op: DomainOp,
): string | null {
  const meta = registrars?.find((r) => r.name === registrar);
  if (!meta) return null;
  return unsupportedReason(meta.name, meta.features, op);
}

/** Hook form of `opUnsupportedReason` over the store's registrar metadata. */
export function useOpUnsupportedReason(
  registrar: string,
  op: DomainOp,
): string | null {
  const registrars = useAppStore((s) => s.registrars);
  return opUnsupportedReason(registrars, registrar, op);
}

/** One toast per outcome. Returns true when the op succeeded. */
export function reportOpResult(op: DomainOp, result: DomainOpResult): boolean {
  const { domainName } = result.target;
  switch (result.status) {
    case 'ok':
      toast.success(`${opSummary(op)} for ${domainName}`);
      return true;
    case 'skipped':
      toast.info(`Skipped ${domainName}`, { description: result.message });
      return false;
    case 'unsupported':
      toast.warning(`Can’t change ${OP_LABEL[op.kind]} for ${domainName}`, {
        description: result.message,
      });
      return false;
    default:
      toast.error(`Couldn’t update ${OP_LABEL[op.kind]} for ${domainName}`, {
        description: result.message,
      });
      return false;
  }
}
