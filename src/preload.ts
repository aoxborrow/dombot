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
  hydrateFromCache: () => ipcRenderer.invoke(IpcChannels.hydrateFromCache),
  clearAllCaches: () => ipcRenderer.invoke(IpcChannels.clearAllCaches),
  getAftermarket: (domain, refresh) =>
    ipcRenderer.invoke(IpcChannels.getAftermarket, domain, refresh),
  getRenewalPrice: (registrar, domain) =>
    ipcRenderer.invoke(IpcChannels.getRenewalPrice, registrar, domain),
  setManualPrice: (registrar, domain, price) =>
    ipcRenderer.invoke(IpcChannels.setManualPrice, registrar, domain, price),
  clearPricingCache: () => ipcRenderer.invoke(IpcChannels.clearPricingCache),

  // Registrars
  listDynadotDomains: () => ipcRenderer.invoke(IpcChannels.listDynadotDomains),
  getDomainDetail: (registrar, domainName, refresh) =>
    ipcRenderer.invoke(
      IpcChannels.getDomainDetail,
      registrar,
      domainName,
      refresh,
    ),
  listPortfolio: (refresh) =>
    ipcRenderer.invoke(IpcChannels.listPortfolio, refresh),
  getRegistrarMetadata: () =>
    ipcRenderer.invoke(IpcChannels.getRegistrarMetadata),
  getRegistrarCredentials: (name) =>
    ipcRenderer.invoke(IpcChannels.getRegistrarCredentials, name),
  saveRegistrarCredentials: (name, creds) =>
    ipcRenderer.invoke(IpcChannels.saveRegistrarCredentials, name, creds),
  testRegistrar: (name) => ipcRenderer.invoke(IpcChannels.testRegistrar, name),

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
};

contextBridge.exposeInMainWorld('api', api);
