import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Globe } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { StatCard } from './StatCard';

const card = (value: ComponentProps<typeof StatCard>['value']) =>
  renderToStaticMarkup(
    createElement(StatCard, {
      icon: Globe,
      accentClass: 'text-sky-400',
      label: 'Total',
      size: 'sm',
      value,
    }),
  );

// The currency symbol's own span: smaller, quieter and raised.
const symbol = (s: string) =>
  new RegExp(`<span class="[^"]*text-muted-foreground"[^>]*>${s}</span>`);

describe('StatCard currency symbols', () => {
  it('sets a leading symbol apart from the number', () => {
    const html = card('$10,486,750');
    expect(html).toMatch(symbol('\\$'));
    expect(html).toContain('</span>10,486,750</span>');
  });

  it('leaves a loss’s minus sign at full size, before the symbol', () => {
    expect(card('−$39,431')).toMatch(/−<span[^>]*>\$<\/span>39,431/);
  });

  it('takes letters and the space after them as the symbol', () => {
    // Swiss grouping, an apostrophe (which React escapes).
    const html = card("CHF 1'234");
    expect(html).toMatch(symbol('CHF '));
    expect(html).toContain('</span>1&#x27;234</span>');
  });

  it('keeps a code after the number with the number', () => {
    expect(card('¥1,234 JPY')).toContain('</span>1,234 JPY</span>');
  });

  it('leaves plain numbers, percentages and a dash alone', () => {
    for (const value of ['10,251', '59%', '—'])
      expect(card(value)).not.toMatch(symbol('[^<]*'));
  });
});

describe('StatCard number fitting', () => {
  const ems = (value: string) => card(value).match(/--ems:([\d.]+)/)?.[1];

  it('estimates the first number’s width from its characters', () => {
    // Eight digits (0.63), two commas (0.3), and the symbol at 80% (0.75).
    expect(ems('$10,486,750')).toBe('6.24');
    expect(ems('10,251')).toBe('3.45');
  });

  it('counts the apostrophe of 1’234 as narrow, like a comma', () => {
    expect(ems("1'234")).toBe(ems('1,234'));
  });

  it('fits only the first slot’s number', () => {
    const html = card([
      { value: '215', unit: '/30d' },
      { value: '480', unit: '/60d' },
    ]);
    expect(html.match(/--ems:/g)).toHaveLength(1);
  });
});

describe('StatCard secondary words', () => {
  it('makes each word of a list its own piece, its "·" with it', () => {
    const html = card([{ value: '12', words: ['3 rejected', '9 inactive'] }]);
    expect(html).toMatch(/>3 rejected<\/span><span[^>]*>· 9 inactive<\/span>/);
  });

  it('puts a "/" unit against the number, words after it', () => {
    const html = card([{ value: '140', unit: '/251', words: '56% listed' }]);
    expect(html).toMatch(
      />140<\/span><span[^>]*>\/251<\/span><span[^>]*>56% listed</,
    );
  });
});
