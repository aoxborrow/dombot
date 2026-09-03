import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { RegistrarName } from '@aoxborrow/registrar-client';

// Per-registrar enable/disable state, persisted separately from credentials. A
// registrar is enabled by default (the moment its credentials are added); the
// user can disable it in Settings to stop future syncs and drop its cached data
// without clearing the credentials. We store only the DISABLED set — absence
// means enabled — so a fresh install and every newly-configured registrar are on
// by default with no migration.

let disabled: Set<RegistrarName> | null = null;

function stateFile(): string {
  return path.join(app.getPath('userData'), 'registrar-state.json');
}

function load(): Set<RegistrarName> {
  if (disabled) return disabled;
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as {
      disabled?: RegistrarName[];
    };
    disabled = new Set(parsed.disabled ?? []);
  } catch {
    disabled = new Set();
  }
  return disabled;
}

function persist(set: Set<RegistrarName>): void {
  disabled = set;
  try {
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ disabled: [...set] }),
      'utf8',
    );
  } catch {
    // Non-fatal — the toggle just won't survive a restart.
  }
}

/** Whether a registrar is enabled (the default). Disabled registrars don't sync. */
export function isRegistrarEnabled(name: RegistrarName): boolean {
  return !load().has(name);
}

/** Enable or disable a registrar; enabling simply removes it from the disabled set. */
export function setRegistrarEnabled(name: RegistrarName, enabled: boolean): void {
  const set = new Set(load());
  if (enabled) set.delete(name);
  else set.add(name);
  persist(set);
}
