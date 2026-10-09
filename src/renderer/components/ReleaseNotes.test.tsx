import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReleaseNotes from './ReleaseNotes';

const html = (markdown: string) =>
  renderToStaticMarkup(<ReleaseNotes markdown={markdown} />);

describe('ReleaseNotes', () => {
  it('renders GitHub-flavored markdown', () => {
    const out = html(
      [
        '## Theme',
        '- **Bold** and `code` and ~~gone~~',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
      ].join('\n'),
    );
    expect(out).toContain('<h4');
    expect(out).toContain('<strong');
    expect(out).toContain('<code');
    expect(out).toContain('<del>gone</del>');
    expect(out).toContain('<table');
  });

  it('never renders raw HTML, unsafe links or images', () => {
    const out = html(
      [
        '<script>alert(1)</script>',
        '<b onclick="x()">raw</b>',
        '[bad](javascript:alert(1)) [good](https://dombot.ai)',
        '![tracker](https://example.com/pixel.png)',
      ].join('\n\n'),
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<img');
    expect(out).toContain('href="https://dombot.ai"');
  });

  it('says so when a release has no notes', () => {
    expect(html('  ')).toContain('No release notes.');
  });
});
