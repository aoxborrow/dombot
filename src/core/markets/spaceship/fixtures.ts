// SellerHub's answers, shaped as its OpenAPI spec gives them (the listing
// list's shape seen live, 2026-11-07), with made-up names, prices and
// tokens.

export const VERIFICATION_TOKEN = '7e018923-c48d-4579-a111-1b9bb6952c96';

export function listing(
  name: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    unicodeName: name,
    status: 'onSale',
    binPrice: { amount: '2500.00', currency: 'USD' },
    binPriceEnabled: true,
    minPrice: { amount: '500', currency: 'USD' },
    minPriceEnabled: true,
    ...over,
  };
}

export const idnListing = listing('xn--spceship-9ya.com', {
  unicodeName: 'spáceship.com',
  displayName: 'SpáceShip.com',
  description: 'Premium domain for sale',
});

export function listingsPage(rows: Record<string, unknown>[], total: number) {
  return { items: rows, total };
}

export function sale(
  name: string,
  saleDateTime: string | null,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    unicodeName: name,
    saleDateTime,
    salePrice: { amount: '1000.00', currency: 'USD' },
    payout: { amount: '900.00', currency: 'USD' },
    source: 'forSalePage',
    ...over,
  };
}

export const verificationRecords = {
  options: [
    { records: [{ type: 'TXT', name: '@', value: VERIFICATION_TOKEN }] },
    {
      records: [
        { type: 'A', name: '_spaceship_verify', value: '192.0.2.1' },
        { type: 'AAAA', name: '_spaceship_verify', value: '2001:db8::1' },
      ],
    },
  ],
};

export function domainsPage(names: string[], total: number) {
  return {
    items: names.map((name) => ({ name, unicodeName: name })),
    total,
  };
}

export const validationError = {
  detail: 'The request is invalid.',
  data: [{ field: 'binPrice.amount', details: 'Must be a positive amount' }],
};
