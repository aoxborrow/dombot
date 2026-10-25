import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './password-input';

describe('password reveal accessibility', () => {
  it('identifies the field and stays in the keyboard tab order', () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, {
        id: 'gandi-api-key',
        revealLabel: 'Gandi work account API key',
        value: 'synthetic-key',
        readOnly: true,
      }),
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Show Gandi work account API key"');
    expect(html).toContain('aria-controls="gandi-api-key"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('tabindex="-1"');
  });

  it('generates distinct input associations when callers omit ids', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(PasswordInput, {
          revealLabel: 'export passphrase',
          value: 'synthetic-one',
          readOnly: true,
        }),
        createElement(PasswordInput, {
          revealLabel: 'import passphrase',
          value: 'synthetic-two',
          readOnly: true,
        }),
      ),
    );
    const ids = [...html.matchAll(/<input[^>]* id="([^"]+)"/g)].map(
      (m) => m[1],
    );
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(controls).toEqual(ids);
  });

  it('does not offer reveal for an empty field', () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, {
        revealLabel: 'export passphrase',
        value: '',
        readOnly: true,
      }),
    );
    expect(html).not.toContain('<button');
  });

  it('keeps reveal available when the stored value cannot be edited', () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, {
        revealLabel: 'stored API key',
        value: 'synthetic-key',
        disabled: true,
      }),
    );
    expect(html).toMatch(/<input[^>]* disabled=""/);
    expect(html).toContain('aria-label="Show stored API key"');
    expect(html).not.toMatch(/<button[^>]* disabled/);
  });
});
