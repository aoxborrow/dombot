import fs from 'node:fs';
import path from 'node:path';
import type { DocStore } from '../../core/storage/doc-store';

// DocStore over the filesystem: one JSON file per namespace under the app's
// userData directory, holding `{ key: value }`. Files are small and
// human-inspectable. Every namespace file is written owner-only (0600) — the
// credentials namespace needs it, and there's no reason the others shouldn't
// have it too.
//
// The file names match the pre-DocStore layout (`cache-portfolio.json`,
// `folders.json`, `settings.json`, …) and so do their shapes, so an existing
// install reads its old files unchanged. Only credentials moved (see
// migrate.ts).

const FILE_MODE = 0o600;

export class FsDocStore implements DocStore {
  constructor(private readonly dir: string) {}

  fileFor(ns: string): string {
    return path.join(this.dir, `${ns}.json`);
  }

  private read(ns: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.fileFor(ns), 'utf8'),
      ) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      // Missing or corrupt file — start empty.
      return {};
    }
  }

  // Write to a sibling temp file and rename over the target, so a crash
  // mid-write can't leave a truncated namespace behind. Tighten perms even
  // when overwriting (writeFileSync's `mode` only applies on create).
  private write(ns: string, data: Record<string, unknown>): void {
    const file = this.fileFor(ns);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: FILE_MODE });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, FILE_MODE);
    } catch {
      // Best effort — e.g. filesystems without POSIX perms (Windows).
    }
  }

  async get(ns: string, key: string): Promise<unknown | null> {
    return this.read(ns)[key] ?? null;
  }

  async put(ns: string, key: string, value: unknown): Promise<void> {
    const data = this.read(ns);
    data[key] = value;
    this.write(ns, data);
  }

  async delete(ns: string, key: string): Promise<void> {
    const data = this.read(ns);
    if (!(key in data)) return;
    delete data[key];
    this.write(ns, data);
  }

  async list(ns: string): Promise<Record<string, unknown>> {
    return this.read(ns);
  }

  async clear(ns: string): Promise<void> {
    fs.rmSync(this.fileFor(ns), { force: true });
  }
}
