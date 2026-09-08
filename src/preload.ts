// Preload script: the only bridge between the sandboxed renderer and the main
// process. With contextIsolation enabled, nothing here leaks into the page
// except the explicitly exposed `window.api` object.
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  IpcEvents,
  type BulkJob,
  type BulkProgress,
  type DombotApi,
} from './shared/ipc';

const api: DombotApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
  saveTextFile: (content, suggestedName) =>
    ipcRenderer.invoke(IpcChannels.saveTextFile, content, suggestedName),
  exportData: () => ipcRenderer.invoke(IpcChannels.exportData),
  importData: (text) => ipcRenderer.invoke(IpcChannels.importData, text),
  hydrateFromCache: () => ipcRenderer.invoke(IpcChannels.hydrateFromCache),
  clearAllCaches: () => ipcRenderer.invoke(IpcChannels.clearAllCaches),
  getPortfolioPricing: () =>
    ipcRenderer.invoke(IpcChannels.getPortfolioPricing),
  setManualPrice: (registrar, domain, price, accountId) =>
    ipcRenderer.invoke(
      IpcChannels.setManualPrice,
      registrar,
      domain,
      price,
      accountId,
    ),

  // Registrars
  listDynadotDomains: () => ipcRenderer.invoke(IpcChannels.listDynadotDomains),
  getDomainDetail: (registrar, domainName, refresh, accountId) =>
    ipcRenderer.invoke(
      IpcChannels.getDomainDetail,
      registrar,
      domainName,
      refresh,
      accountId,
    ),
  applyDomainOp: (target, op) =>
    ipcRenderer.invoke(IpcChannels.applyDomainOp, target, op),
  getUrlForwarding: (target) =>
    ipcRenderer.invoke(IpcChannels.getUrlForwarding, target),
  getEmailForwarding: (target) =>
    ipcRenderer.invoke(IpcChannels.getEmailForwarding, target),
  startBulk: (targets, op) =>
    ipcRenderer.invoke(IpcChannels.startBulk, targets, op),
  cancelBulk: (jobId) => ipcRenderer.invoke(IpcChannels.cancelBulk, jobId),
  getBulkJob: () => ipcRenderer.invoke(IpcChannels.getBulkJob),
  stepBulk: (jobId) => ipcRenderer.invoke(IpcChannels.stepBulk, jobId),
  onBulkProgress: (callback) => {
    const listener = (_e: unknown, p: BulkProgress) => callback(p);
    ipcRenderer.on(IpcEvents.bulkProgress, listener);
    return () => ipcRenderer.removeListener(IpcEvents.bulkProgress, listener);
  },
  onBulkFinished: (callback) => {
    const listener = (_e: unknown, job: BulkJob) => callback(job);
    ipcRenderer.on(IpcEvents.bulkFinished, listener);
    return () => ipcRenderer.removeListener(IpcEvents.bulkFinished, listener);
  },
  listPortfolio: (refresh) =>
    ipcRenderer.invoke(IpcChannels.listPortfolio, refresh),
  syncRegistrar: (name, accountId) =>
    ipcRenderer.invoke(IpcChannels.syncRegistrar, name, accountId),
  getRegistrarCatalog: () =>
    ipcRenderer.invoke(IpcChannels.getRegistrarCatalog),
  connectRegistrarAccount: (...args) =>
    ipcRenderer.invoke(IpcChannels.connectRegistrarAccount, ...args),
  createRegistrarAccount: (...args) =>
    ipcRenderer.invoke(IpcChannels.createRegistrarAccount, ...args),
  renameRegistrarAccount: (...args) =>
    ipcRenderer.invoke(IpcChannels.renameRegistrarAccount, ...args),
  removeRegistrarAccount: (...args) =>
    ipcRenderer.invoke(IpcChannels.removeRegistrarAccount, ...args),
  testRegistrarAccount: (...args) =>
    ipcRenderer.invoke(IpcChannels.testRegistrarAccount, ...args),
  getRegistrarMetadata: () =>
    ipcRenderer.invoke(IpcChannels.getRegistrarMetadata),
  getRegistrarCredentials: (name, accountId) =>
    ipcRenderer.invoke(IpcChannels.getRegistrarCredentials, name, accountId),
  saveRegistrarCredentials: (name, creds, accountId) =>
    ipcRenderer.invoke(
      IpcChannels.saveRegistrarCredentials,
      name,
      creds,
      accountId,
    ),
  setRegistrarEnabled: (name, enabled, accountId) =>
    ipcRenderer.invoke(
      IpcChannels.setRegistrarEnabled,
      name,
      enabled,
      accountId,
    ),

  // MCP server
  getMcpInfo: () => ipcRenderer.invoke(IpcChannels.getMcpInfo),
  listPendingApprovals: () =>
    ipcRenderer.invoke(IpcChannels.listPendingApprovals),
  resolveApproval: (id, approve) =>
    ipcRenderer.invoke(IpcChannels.resolveApproval, id, approve),
  listMcpClients: () => ipcRenderer.invoke(IpcChannels.listMcpClients),
  revokeMcpClient: (clientId) =>
    ipcRenderer.invoke(IpcChannels.revokeMcpClient, clientId),
  onApprovalsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IpcEvents.approvalsChanged, listener);
    return () =>
      ipcRenderer.removeListener(IpcEvents.approvalsChanged, listener);
  },
  onPortfolioChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IpcEvents.portfolioChanged, listener);
    return () =>
      ipcRenderer.removeListener(IpcEvents.portfolioChanged, listener);
  },

  // Folders
  getFolders: () => ipcRenderer.invoke(IpcChannels.getFolders),
  createFolder: (input) => ipcRenderer.invoke(IpcChannels.createFolder, input),
  updateFolder: (id, patch) =>
    ipcRenderer.invoke(IpcChannels.updateFolder, id, patch),
  deleteFolder: (id) => ipcRenderer.invoke(IpcChannels.deleteFolder, id),
  assignFolder: (domainKey, folderId) =>
    ipcRenderer.invoke(IpcChannels.assignFolder, domainKey, folderId),

  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.getSettings),
  updateSettings: (patch) =>
    ipcRenderer.invoke(IpcChannels.updateSettings, patch),

  // Events (polling)
  getRevisions: () => ipcRenderer.invoke(IpcChannels.getRevisions),
};

contextBridge.exposeInMainWorld('api', api);
