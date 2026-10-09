import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  parseInline,
  parseNotes,
  parseReleaseFeed,
  releasesNewerThan,
} from './releases';

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('1.4.0', '1.5.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
  });

  it('puts a pre-release before its release', () => {
    expect(compareVersions('1.5.0-beta.1', '1.5.0')).toBe(-1);
    expect(compareVersions('1.5.0', '1.5.0-beta.1')).toBe(1);
  });

  it('sorts unparseable versions lowest', () => {
    expect(compareVersions('junk', '0.0.1')).toBe(-1);
    expect(compareVersions('0.0.1', 'junk')).toBe(1);
  });
});

describe('parseReleaseFeed', () => {
  it('keeps valid entries newest first and fills defaults', () => {
    const releases = parseReleaseFeed({
      releases: [
        { tag: 'v1.4.0', notes: 'old', url: 'https://example.com/a' },
        { version: '1.5.0', tag: 'v1.5.0', name: 'Five', notes: 'new' },
        { tag: 'nightly' },
        null,
      ],
    });
    expect(releases.map((r) => r.version)).toEqual(['1.5.0', '1.4.0']);
    expect(releases[0]).toMatchObject({
      name: 'Five',
      url: 'https://github.com/aoxborrow/dombot/releases/tag/v1.5.0',
    });
    expect(releases[1]).toMatchObject({
      name: 'DomBot 1.4.0',
      url: 'https://example.com/a',
    });
  });

  it('tolerates a malformed feed', () => {
    expect(parseReleaseFeed(null)).toEqual([]);
    expect(parseReleaseFeed({ releases: 'x' })).toEqual([]);
  });

  it('never keeps a non-https link', () => {
    const [r] = parseReleaseFeed({
      releases: [{ tag: 'v1.0.0', url: 'javascript:alert(1)' }],
    });
    expect(r.url).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('releasesNewerThan', () => {
  it('lists only later versions', () => {
    const releases = parseReleaseFeed({
      releases: [{ tag: 'v1.3.0' }, { tag: 'v1.4.0' }, { tag: 'v1.5.0' }],
    });
    expect(releasesNewerThan(releases, '1.4.0').map((r) => r.version)).toEqual([
      '1.5.0',
    ]);
  });
});

describe('release notes', () => {
  it('reads bold, code and http(s) links, leaving other markup as text', () => {
    expect(
      parseInline(
        '**New** `x` [docs](https://dombot.ai) [bad](javascript:alert(1))',
      ),
    ).toEqual([
      { type: 'strong', text: 'New' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'x' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'docs', href: 'https://dombot.ai' },
      { type: 'text', text: ' [bad](javascript:alert(1))' },
    ]);
  });

  it('splits headings, lists, rules and paragraphs', () => {
    const blocks = parseNotes(
      [
        '## Theme',
        '',
        '- one',
        '- two',
        '  wrapped',
        'After the list.',
        '',
        '---',
        '',
        'Footer',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'list',
      'paragraph',
      'rule',
      'paragraph',
    ]);
    expect(blocks[1]).toEqual({
      type: 'list',
      items: [
        [{ type: 'text', text: 'one' }],
        [{ type: 'text', text: 'two wrapped' }],
      ],
    });
  });
});
