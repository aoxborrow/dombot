import { ipcMain } from 'electron';
import {
  IpcChannels,
  type BulkJob,
  type DomainForward,
  type DomainOp,
  type DomainOpResult,
  type DomainTarget,
  type EmailForward,
} from '../../shared/ipc';
import { applyDomainOp } from '../services/domain-ops';
import { cancelBulk, getBulkJob, startBulk } from '../services/bulk-jobs';
import {
  getRegistrarClient,
  getRegistrarFeatures,
} from '../services/registrars';

/** Throws a plain message when the registrar lacks an extended read feature. */
function requireFeature(target: DomainTarget, feature: string, what: string) {
  if (!getRegistrarFeatures(target.registrar).includes(feature)) {
    throw new Error(`This registrar doesn’t offer ${what} through its API.`);
  }
}

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

  // Forwarding reads back the per-row dialogs. Live — forwarding isn't part of
  // the portfolio/detail cache.
  ipcMain.handle(
    IpcChannels.getUrlForwarding,
    async (_e, target: DomainTarget): Promise<DomainForward[]> => {
      requireFeature(target, 'getDomainForwarding', 'URL forwarding');
      return getRegistrarClient(target.registrar).getDomainForwarding(
        target.domainName,
      );
    },
  );

  ipcMain.handle(
    IpcChannels.getEmailForwarding,
    async (_e, target: DomainTarget): Promise<EmailForward[]> => {
      requireFeature(target, 'getEmailForwarding', 'email forwarding');
      return getRegistrarClient(target.registrar).getEmailForwarding(
        target.domainName,
      );
    },
  );

  // Bulk jobs (services/bulk-jobs.ts). Progress streams back as events.
  ipcMain.handle(
    IpcChannels.bulkStart,
    async (_e, targets: DomainTarget[], op: DomainOp): Promise<BulkJob> =>
      startBulk(targets, op),
  );
  ipcMain.handle(
    IpcChannels.bulkCancel,
    async (_e, jobId: string): Promise<void> => {
      cancelBulk(jobId);
    },
  );
  ipcMain.handle(IpcChannels.bulkGet, async (): Promise<BulkJob | null> =>
    getBulkJob(),
  );
}
