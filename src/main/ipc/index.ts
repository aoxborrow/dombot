import { registerAppIpc } from './app';
import { registerRegistrarIpc } from './registrars';
import { registerMarketIpc } from './market';
import { registerPricingIpc } from './pricing';
import { registerMcpIpc } from './mcp';

/**
 * Registers every `ipcMain.handle` responder. Call once, after the app is ready.
 * Group new handlers into a feature module here rather than growing one file.
 */
export function registerIpcHandlers(): void {
  registerAppIpc();
  registerRegistrarIpc();
  registerMarketIpc();
  registerPricingIpc();
  registerMcpIpc();
}
