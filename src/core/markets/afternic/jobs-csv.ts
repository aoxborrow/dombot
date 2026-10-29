import { toAscii } from '../../../shared/domain-name';
import { parseCsv, toCsv } from '../../../shared/csv';
import { toWireFields } from './convert';
import type { JobRowResult, ListingInput } from './types';

// The bulk jobs CSV (docs/afternic-api.md, "Bulk: `$each` calls and jobs").
// It's Afternic's bulk upload template, not the JSON API's format: plain
// dollars, Y/N, landers by name. A blank cell leaves that setting alone, so
// a listing field the caller didn't set is written blank.

/** The template's columns, in its order. A header row is required. */
export const JOB_COLUMNS = [
  'Domain',
  'Buy Now Price',
  'Floor Price',
  'Min Offer',
  'Lease to Own',
  'Max Lease Period',
  'Sale Lander',
  'Show Buy Now Option',
  'Show Lease to Own Option',
  'Show Make Offer Option',
  'Hidden',
] as const;

const yn = (value: boolean | undefined) =>
  value === undefined ? '' : value ? 'Y' : 'N';

const num = (value: number | null | undefined) =>
  value === undefined ? '' : String(value ?? 0);

/**
 * The template's one "Sale Lander" column covers both `landingPage` and
 * `intakeStyle`: a parking page, or a sales lander of one style.
 */
function saleLander(input: ListingInput): string {
  if (input.landingPage === 'PARKING_TYPE') {
    if (input.intakeStyle) {
      throw new Error(
        `${input.name}: a parking page has no sales lander style.`,
      );
    }
    return 'Cashparking';
  }
  switch (input.intakeStyle) {
    case undefined:
      if (input.landingPage === 'SALES_TYPE') {
        throw new Error(
          `${input.name}: a bulk job needs the lander style with a sales lander.`,
        );
      }
      return '';
    case 'BUYNOW':
      return 'Buy It Now';
    case 'PRICE_FORM':
      return 'Request Price';
    case 'CUSTOM_LANDER':
      return 'Custom Lander';
  }
}

/**
 * The Domain cell. Afternic takes its spelling as the lander's display name,
 * so a mixed-case `DOMANIO.com` there renames the display. Use `displayName`
 * only when it was asked for, and the plain name otherwise.
 */
function domainCell(input: ListingInput, name: string): string {
  const display = input.displayName;
  if (display === undefined || display === '') return name;
  if (toAscii(display) !== name) {
    throw new Error(`${name}: the display name must spell the same name.`);
  }
  return display;
}

/**
 * Listings as a bulk job file. Checks every row the way the JSON calls do,
 * and rejects settings the template can't carry. Names must already be
 * canonical and unique: a name twice in one file loses a result.
 */
export function toJobCsv(inputs: readonly ListingInput[]): string {
  const rows: string[][] = [[...JOB_COLUMNS]];
  for (const input of inputs) {
    const name = input.name;
    if (input.featured !== undefined) {
      throw new Error(`${name}: a bulk job can't set "featured".`);
    }
    toWireFields(input); // same price and range checks as the JSON calls
    rows.push([
      domainCell(input, name),
      num(input.buyNow),
      num(input.floor),
      num(input.minOffer),
      yn(input.leasingEnabled),
      num(input.maxLeasePeriod),
      saleLander(input),
      yn(input.showLanderBuynowOption),
      yn(input.showLanderLeaseToOwnOption),
      yn(input.showLanderMakeOfferOption),
      yn(input.hidden),
    ]);
  }
  return toCsv(rows, new Set([1, 2, 3, 5])) + '\r\n';
}

/**
 * A job's results file: `operation,domain,result,errorMessage`, one row per
 * name. The live API puts a byte-order mark before the first data row (not
 * the header), so marks are stripped from every cell.
 */
export function parseJobResults(text: string): JobRowResult[] {
  const rows = parseCsv(text.replace(/\uFEFF/g, ''));
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const [op, domain, result, message] = [
    col('operation'),
    col('domain'),
    col('result'),
    col('errorMessage'),
  ];
  if (domain < 0 || result < 0) {
    throw new Error('Afternic sent a job results file without its columns.');
  }
  return rows
    .filter((r) => r.some((cell) => cell.trim()))
    .map((r) => {
      const error = (message >= 0 ? r[message] : '')?.trim() || null;
      const outcome = r[result]?.trim() ?? '';
      return {
        name: toAscii(r[domain]),
        operation: op >= 0 ? (r[op]?.trim() ?? '') : '',
        result: outcome,
        ok: !error && outcome !== '' && !/FAIL|ERROR/i.test(outcome),
        error,
      };
    });
}
