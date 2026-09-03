// Preload script: the only bridge between the sandboxed renderer and the main
// process. With contextIsolation enabled, nothing here leaks into the page
// except the explicitly exposed `window.api` object.
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, IpcEvents, type DombotApi } from './shared/ipc';

const api: DombotApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
  saveCsv: (content, suggestedName) =>
    ipcRenderer.invoke(IpcChannels.saveCsv, content, suggestedName),
  hydrateFromCache: () => ipcRenderer.invoke(IpcChannels.hydrateFromCache),
  clearAllCaches: () => ipcRenderer.invoke(IpcChannels.clearAllCaches),
  getPortfolioPricing: () =>
    ipcRenderer.invoke(IpcChannels.getPortfolioPricing),
  setManualPrice: (registrar, domain, price) =>
    ipcRenderer.invoke(IpcChannels.setManualPrice, registrar, domain, price),

  // Registrars
  listDynadotDomains: () => ipcRenderer.invoke(IpcChannels.listDynadotDomains),
  getDomainDetail: (registrar, domainName, refresh) =>
    ipcRenderer.invoke(
      IpcChannels.getDomainDetail,
      registrar,
      domainName,
      refresh,
    ),
  applyDomainOp: (target, op) =>
    ipcRenderer.invoke(IpcChannels.applyDomainOp, target, op),
  listPortfolio: (refresh) =>
    ipcRenderer.invoke(IpcChannels.listPortfolio, refresh),
  syncRegistrar: (name) => ipcRenderer.invoke(IpcChannels.syncRegistrar, name),
  getRegistrarMetadata: () =>
    ipcRenderer.invoke(IpcChannels.getRegistrarMetadata),
  getRegistrarCredentials: (name) =>
    ipcRenderer.invoke(IpcChannels.getRegistrarCredentials, name),
  saveRegistrarCredentials: (name, creds) =>
    ipcRenderer.invoke(IpcChannels.saveRegistrarCredentials, name, creds),
  setRegistrarEnabled: (name, enabled) =>
    ipcRenderer.invoke(IpcChannels.setRegistrarEnabled, name, enabled),

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
  getFolders: () => ipcRenderer.invoke(IpcChannels.foldersList),
  createFolder: (input) => ipcRenderer.invoke(IpcChannels.foldersCreate, input),
  updateFolder: (id, patch) =>
    ipcRenderer.invoke(IpcChannels.foldersUpdate, id, patch),
  deleteFolder: (id) => ipcRenderer.invoke(IpcChannels.foldersDelete, id),
  assignFolder: (domainKey, folderId) =>
    ipcRenderer.invoke(IpcChannels.foldersAssign, domainKey, folderId),

  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.getSettings),
  updateSettings: (patch) =>
    ipcRenderer.invoke(IpcChannels.updateSettings, patch),
};

contextBridge.exposeInMainWorld('api', api);
