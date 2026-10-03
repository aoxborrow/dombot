import { describe, expect, it } from 'vitest';
import {
  csvField,
  decodeText,
  detectDelimiter,
  parseCsv,
  toCsv,
  unguardCell,
} from './csv';

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, delimiters and line breaks in cells', () => {
    expect(
      parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nd,e,,f\r\n'),
    ).toEqual([
      ['a', 'b, c', 'say "hi"', 'two\nlines'],
      ['d', 'e', '', 'f'],
    ]);
  });

  it('keeps blank lines so row numbers match the file, and handles CR', () => {
    expect(parseCsv('a\r\rb\rc')).toEqual([['a'], [''], ['b'], ['c']]);
  });

  it('drops a byte-order mark and reads a quote mid-cell as text', () => {
    expect(parseCsv('\uFEFFDomain,5" disk')).toEqual([['Domain', '5" disk']]);
  });

  it('splits on the given delimiter', () => {
    expect(parseCsv('"a;b";c', ';')).toEqual([['a;b', 'c']]);
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['Domain,Price\na.com,1\nb.com,2', ','],
    ['Domain name;Currency;Price\n"a.com";"USD";1850', ';'],
    ['Domain\tExpires\na.com\t2027-01-01', '\t'],
    ['domain|price\na.com|5', '|'],
    ['example.com\nexample.net', ','],
  ])('%j → %j', (text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it('is not fooled by commas inside a quoted cell', () => {
    expect(
      detectDelimiter('Domain;Notes\na.com;"one, two, three"\nb.com;x'),
    ).toBe(';');
  });
});

describe('decodeText', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it('reads UTF-8 with and without a BOM', () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x61, 0xc3, 0xa9))).toBe('aé');
    expect(decodeText(bytes(0x61, 0xc3, 0xa9))).toBe('aé');
  });
  it('reads UTF-16 by its BOM', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x61, 0x00, 0x62, 0x00))).toBe('ab');
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x61, 0x00, 0x62))).toBe('ab');
  });
  it('falls back to Windows-1252 for bytes that are not UTF-8', () => {
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9))).toBe('café');
  });
});

describe('writing', () => {
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(1)', '  =1+1', '\t=1+1'])(
    'guards a cell that a spreadsheet would run as a formula: %j',
    (value) => {
      const field = csvField(value);
      expect(field.replace(/^"|"$/g, '').startsWith("'")).toBe(true);
      expect(unguardCell(parseCsv(field)[0][0])).toBe(value);
    },
  );

  it('leaves numbers and plain text alone', () => {
    expect(csvField('-12', true)).toBe('-12');
    expect(unguardCell("it's fine")).toBe("it's fine");
    expect(unguardCell("'plain")).toBe("'plain");
  });

  it('round trips through toCsv and parseCsv', () => {
    const rows = [
      ['Domain', 'Notes', 'Days'],
      ['a.com', 'Line one\nline "two", three', '-3'],
    ];
    expect(parseCsv(toCsv(rows, new Set([2])))).toEqual(rows);
  });
});
