import { ipcMain } from 'electron';
import {
  IpcChannels,
  type DomainOp,
  type DomainOpResult,
  type DomainTarget,
} from '../../shared/ipc';
import { applyDomainOp } from '../services/domain-ops';

/**
 * Domain-operation IPC: one channel for every per-domain write the table can
 * make (see shared/ipc `DomainOp`). The handler never rejects for a
 * registrar-side outcome — `DomainOpResult.status` carries it — so the
 * renderer has a single result shape to render.
 */
export function registerDomainsIpc(): void {
  ipcMain.handle(
    IpcChannels.applyDomainOp,
    async (_e, target: DomainTarget, op: DomainOp): Promise<DomainOpResult> =>
      applyDomainOp(target, op),
  );
}
