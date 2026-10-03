// Reading and writing CSV (docs/domain-import-export.md). One module for both,
// so the export's quoting and formula guard and the import's reading of them
// can't drift apart. Pure: works in the renderer, the Worker, and Node.

/** The delimiters a spreadsheet export might use, in tie-break order. */
export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/**
 * Text from a file's bytes. A byte-order mark decides the encoding (UTF-8, or
 * UTF-16 LE/BE, which is what Excel's "Unicode text" saves). Without one, the
 * bytes are read as UTF-8, or as Windows-1252 when they aren't valid UTF-8 (an
 * older Excel on Windows). The mark itself is dropped.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Splits CSV text into rows of cells (RFC 4180): quoted cells may hold the
 * delimiter, doubled quotes, and line breaks; lines end in CRLF, LF, or CR. A
 * leading byte-order mark is dropped. Every row is kept, blank ones included,
 * so row numbers match the file's lines; a final line break adds no row.
 */
export function parseCsv(text: string, delimiter: string = ','): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      endRow();
      if (src[i + 1] === '\n') i++;
    } else if (ch === '\n') {
      endRow();
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== '' || row.length > 0 || inQuotes) endRow();
  return rows;
}

/**
 * The delimiter that splits the start of a file most consistently: the most
 * lines with the same number of cells (more than one), counted outside
 * quotes. Comma when nothing splits.
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 20_000);
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const lines = parseCsv(sample, d)
      .slice(0, 20)
      .filter((r) => r.some((c) => c.trim() !== ''));
    const counts = new Map<number, number>();
    for (const r of lines)
      if (r.length > 1) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    // The most common width, weighted by how wide it is, so a sentence with
    // one comma in it doesn't outvote a real table.
    let score = 0;
    for (const [width, n] of counts) score = Math.max(score, n * 100 + width);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

// A cell a spreadsheet would read as a formula. CSV quoting doesn't stop
// Excel or Sheets from evaluating it, so the export prefixes it with `'`.
const FORMULA = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u;

/**
 * One cell for the file: guarded against formula injection (unless it's a
 * number column, where a leading minus is just a sign), then quoted per RFC
 * 4180 when it holds a comma, quote, or line break.
 */
export function csvField(value: string, numeric = false): string {
  if (!numeric && FORMULA.test(value)) value = "'" + value;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Undoes `csvField`'s formula guard on a cell read back from a file. */
export function unguardCell(value: string): string {
  return value.startsWith("'") && FORMULA.test(value.slice(1))
    ? value.slice(1)
    : value;
}

/**
 * Rows of cells as CSV text, CRLF line endings (RFC 4180, and what Excel
 * expects). `numeric` marks the column indexes that hold numbers.
 */
export function toCsv(
  rows: string[][],
  numeric: ReadonlySet<number> = new Set(),
): string {
  return rows
    .map((r) => r.map((cell, i) => csvField(cell, numeric.has(i))).join(','))
    .join('\r\n');
}
