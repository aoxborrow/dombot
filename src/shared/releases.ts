// The release feed: every published DomBot release with its notes, served as
// a static file from the website (site/public/releases.json, written by the
// release workflow). Both hosts read it to tell the user a newer version
// exists and to show release notes. Pure helpers here; fetching lives in
// src/core/services/releases.ts.

/** Where the hosts fetch the feed from. */
export const RELEASES_URL = 'https://dombot.ai/releases.json';

export interface Release {
  /** `1.5.0` — the tag without its `v`. */
  version: string;
  tag: string;
  name: string;
  /** ISO timestamp. */
  publishedAt: string;
  /** The GitHub release body, markdown. */
  notes: string;
  /** The release page on GitHub. */
  url: string;
}

export interface ReleaseFeed {
  /** Newest first. Empty when the feed hasn't been fetched successfully. */
  releases: Release[];
  /** When the feed was last fetched successfully; null if never. */
  checkedAt: string | null;
  /** The last fetch's failure, if it failed. Earlier releases are kept. */
  error: string | null;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Orders two `x.y.z` versions (a leading `v` allowed); a pre-release sorts
 *  before its release. Unparseable versions sort below every real one. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION.exec(a.trim());
  const pb = VERSION.exec(b.trim());
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  if (pa[4] === pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Reads a fetched feed, dropping entries it can't use rather than failing
 *  the whole thing, and sorts newest first. */
export function parseReleaseFeed(json: unknown): Release[] {
  const list = (json as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(list)) return [];
  const out: Release[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const tag = str(r.tag);
    const version = str(r.version) || tag.replace(/^v/, '');
    if (!VERSION.test(version)) continue;
    const url = str(r.url);
    out.push({
      version,
      tag: tag || `v${version}`,
      name: str(r.name) || `DomBot ${version}`,
      publishedAt: str(r.publishedAt),
      notes: str(r.notes),
      url: /^https:\/\//.test(url)
        ? url
        : `https://github.com/aoxborrow/dombot/releases/tag/v${version}`,
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** Releases newer than `version`, newest first. */
export function releasesNewerThan(
  releases: Release[],
  version: string,
): Release[] {
  return releases.filter((r) => compareVersions(r.version, version) > 0);
}

// ── release notes ───────────────────────────────────────────────────────────
// Release bodies are markdown. The feed comes from the network, so it is never
// rendered as HTML: this reads the small subset the release notes use into
// plain blocks that the renderer draws as React elements.

export type NotesInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

export type NotesBlock =
  | { type: 'heading'; content: NotesInline[] }
  | { type: 'paragraph'; content: NotesInline[] }
  | { type: 'list'; items: NotesInline[][] }
  | { type: 'rule' };

const INLINE =
  /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Bold, inline code and http(s) links; everything else is plain text. */
export function parseInline(text: string): NotesInline[] {
  const out: NotesInline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last)
      out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'strong', text: m[1] });
    else if (m[2] !== undefined) out.push({ type: 'code', text: m[2] });
    else out.push({ type: 'link', text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Headings, `-`/`*` bullet lists, `---` rules and paragraphs. */
export function parseNotes(markdown: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length)
      blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
    para = [];
    if (list) blocks.push({ type: 'list', items: list.map(parseInline) });
    list = null;
  };
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
    } else if (heading) {
      flush();
      blocks.push({ type: 'heading', content: parseInline(heading[1]) });
    } else if (bullet) {
      if (para.length) flush();
      (list ??= []).push(bullet[1]);
    } else if (list && /^\s/.test(raw)) {
      // A wrapped bullet continues the previous item.
      list[list.length - 1] += ` ${line}`;
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}
