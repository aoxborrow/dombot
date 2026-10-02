import type { RegistrarName } from '@aoxborrow/registrar-client';
import { setStoredCredentials } from '../services/credentials';
import { assignFolder, createFolder, getFolders } from '../services/folders';
import { setManualPrice } from '../services/pricing';
import {
  configureRegistrarFactory,
  resetRegistrarClients,
} from '../services/registrars';
import { flushWrites } from '../storage/namespace';
import { DemoRegistrar, DemoWorld } from './registrar';
import {
  DEFAULT_DEMO_SEED,
  DEFAULT_DEMO_SIZE,
  generateDemoSeed,
  type DemoSeed,
} from './seed';

export { DemoRegistrar, DemoWorld, type DemoDomainRecord } from './registrar';
export {
  generateDemoSeed,
  DEFAULT_DEMO_SEED,
  DEFAULT_DEMO_SIZE,
  type DemoAccount,
  type DemoFolder,
  type DemoSeed,
} from './seed';

// Wires the demo into a core that's already been given a store (a
// MemoryDocStore, typically) and hydrated. After this, every registrar call
// the app makes lands in the in-memory world, the configured accounts carry
// fake credentials so they show as connected, and the folders and manual
// prices are in place. The host then runs a sync to fill the portfolio cache
// exactly as a real instance would on first launch.
//
// This is host-neutral: the demo web build, the desktop's "try with sample
// data" mode, and tests all call it.

export interface InstallDemoOptions {
  seed?: number;
  size?: number;
  /** Simulated per-call latency for the fake registrar (ms). */
  latencyMs?: number;
  /** Fixed "now" for the generated dates (tests). */
  now?: Date;
}

export interface DemoInstallation {
  seed: DemoSeed;
  world: DemoWorld;
  /** Changes the fake registrar's per-call latency from now on. */
  setLatency(ms: number): void;
}

/** Installs the demo registrar factory and seeds the store. */
export async function installDemo(
  options: InstallDemoOptions = {},
): Promise<DemoInstallation> {
  const seed = generateDemoSeed(
    options.seed ?? DEFAULT_DEMO_SEED,
    options.size ?? DEFAULT_DEMO_SIZE,
    options.now,
  );
  const world = new DemoWorld(seed.records);
  let latencyMs = options.latencyMs ?? 0;

  configureRegistrarFactory((name: RegistrarName, _credentials, accountId) => {
    return new DemoRegistrar(name, accountId, world, {
      latencyMs: () => latencyMs,
    });
  });
  resetRegistrarClients();

  for (const account of seed.accounts) {
    await setStoredCredentials(account.id, account.credentials);
  }

  const existing = new Map(getFolders().folders.map((f) => [f.name, f.id]));
  for (const folder of seed.folders) {
    const id =
      existing.get(folder.name) ??
      createFolder({
        name: folder.name,
        color: folder.color,
        description: folder.description,
      }).id;
    for (const domainName of folder.domains) {
      const record = world.get(domainName);
      if (record) assignFolder(domainName, id);
    }
  }

  for (const [key, price] of Object.entries(seed.manualPrices)) {
    const domainName = key.slice(key.indexOf(':') + 1);
    if (world.get(domainName)) setManualPrice(domainName, price);
  }

  await flushWrites();
  return {
    seed,
    world,
    setLatency: (ms) => {
      latencyMs = ms;
    },
  };
}

/** Puts the real provider factory back (tests; leaving demo mode). */
export function uninstallDemo(): void {
  configureRegistrarFactory(null);
  resetRegistrarClients();
}
