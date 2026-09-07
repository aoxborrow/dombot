import type { RegistrarName } from '@aoxborrow/registrar-client';
import { Namespace } from '../storage/namespace';

// Per-registrar enable/disable state, persisted (`registrar-state` namespace)
// separately from credentials. A registrar is enabled by default (the moment its credentials are added); the
// user can disable it in Settings to stop future syncs and drop its cached data
// without clearing the credentials. We store only the DISABLED set — absence
// means enabled — so a fresh install and every newly-configured registrar are on
// by default with no migration.

const store = new Namespace<RegistrarName[]>('registrar-state');

function load(): Set<RegistrarName> {
  return new Set(store.get('disabled') ?? []);
}

function persist(set: Set<RegistrarName>): void {
  void store.set('disabled', [...set]);
}

/** Whether a registrar is enabled (the default). Disabled registrars don't sync. */
export function isRegistrarEnabled(name: RegistrarName): boolean {
  return !load().has(name);
}

/** Enable or disable a registrar; enabling simply removes it from the disabled set. */
export function setRegistrarEnabled(
  name: RegistrarName,
  enabled: boolean,
): void {
  const set = new Set(load());
  if (enabled) set.delete(name);
  else set.add(name);
  persist(set);
}
