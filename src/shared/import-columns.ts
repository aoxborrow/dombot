// Which DomBot field each column of an imported file holds
// (docs/domain-import-export.md, "Matching columns" and the appendices). The
// alias table is data: a header matches when its normalized form equals the
// normalized form of a field's header or one of its aliases.

export type ImportField =
  | 'domain'
  | 'idn'
  | 'status'
  | 'folder'
  | 'registrar'
  | 'createdDate'
  | 'expirationDate'
  | 'autoRenew'
  | 'renewalPrice'
  | 'renewalCurrency'
  | 'binPrice'
  | 'minOffer'
  | 'floorPrice'
  | 'listCurrency'
  | 'purchaseType'
  | 'purchaseDate'
  | 'purchaseAmount'
  | 'purchaseCurrency'
  | 'purchaseYears'
  | 'saleDate'
  | 'saleAmount'
  | 'saleCurrency'
  | 'notes'
  | 'currency';

export type FieldKind =
  | 'domain'
  | 'text'
  | 'date'
  | 'money'
  | 'currency'
  | 'boolean'
  | 'status'
  | 'purchaseType'
  | 'registrar'
  | 'years';

export interface ImportFieldInfo {
  field: ImportField;
  /** The DomBot CSV header (`src/shared/domain-csv.ts`). */
  header: string;
  /** What the matching step calls it. */
  label: string;
  kind: FieldKind;
  /** Other headers that mean this field, as files write them. */
  aliases: string[];
}

/** Every field an import can fill, in the matching step's order. */
export const IMPORT_FIELDS: ImportFieldInfo[] = [
  {
    field: 'domain',
    header: 'Domain',
    label: 'Domain',
    kind: 'domain',
    aliases: [
      'domain name',
      'name',
      '*Name (Required)',
      'Domain Name REQUIRED',
      'domain_name',
      'domains',
    ],
  },
  {
    field: 'idn',
    header: 'IDN',
    label: 'Domain (other spelling)',
    kind: 'domain',
    aliases: [
      'international domain name',
      'punycode',
      'unicode',
      'Domain Name (ACE)',
    ],
  },
  {
    field: 'status',
    header: 'Status',
    label: 'Status',
    kind: 'status',
    aliases: ['ownership'],
  },
  {
    field: 'folder',
    header: 'Folder',
    label: 'Folder',
    kind: 'text',
    aliases: ['folder name', 'group', 'groupname', 'FolderMemberships'],
  },
  {
    field: 'registrar',
    header: 'Registrar',
    label: 'Registrar',
    kind: 'registrar',
    aliases: ['registrar name', 'sponsoring registrar'],
  },
  {
    field: 'createdDate',
    header: 'Created',
    label: 'Registration date',
    kind: 'date',
    aliases: [
      'create date',
      'created date',
      'creation date',
      'registration date',
      'date registered',
      'registered on',
    ],
  },
  {
    field: 'expirationDate',
    header: 'Expires',
    label: 'Expiration date',
    kind: 'date',
    aliases: [
      'expiration date',
      'expiry',
      'expiry date',
      'expires on',
      'date_expiration',
      'paid until',
      'domain expiration date',
    ],
  },
  {
    field: 'autoRenew',
    header: 'Auto-renew',
    label: 'Auto-renew',
    kind: 'boolean',
    aliases: [
      'auto renew',
      'autorenew',
      'auto_renew_enabled',
      'auto renewal',
      'renewal status',
      'domain auto-renew status',
    ],
  },
  {
    field: 'renewalPrice',
    header: 'Renewal price',
    label: 'Renewal price',
    kind: 'money',
    aliases: [
      'renewal',
      'renewal fee',
      'renewal cost',
      'renew price',
      'annual renewal price',
    ],
  },
  {
    field: 'renewalCurrency',
    header: 'Renewal currency',
    label: 'Renewal currency',
    kind: 'currency',
    aliases: [],
  },
  {
    field: 'binPrice',
    header: 'Price',
    label: 'BIN price',
    kind: 'money',
    aliases: [
      'asking',
      'ask',
      'buy now price',
      'buy now',
      'bin',
      'bin price',
      'buy it now',
      'list price',
    ],
  },
  {
    field: 'minOffer',
    header: 'Min offer',
    label: 'Minimum offer',
    kind: 'money',
    aliases: [
      'minimum offer',
      'minimum price',
      'min price',
      '*Minimum Offer (Required)',
      'Minimum Offer REQUIRED',
    ],
  },
  {
    field: 'floorPrice',
    header: 'Floor price',
    label: 'Floor price',
    kind: 'money',
    aliases: ['floor'],
  },
  {
    field: 'listCurrency',
    header: 'Price currency',
    label: 'BIN price currency',
    kind: 'currency',
    aliases: ['bin currency'],
  },
  {
    field: 'purchaseType',
    header: 'Purchase type',
    label: 'Purchase type',
    kind: 'purchaseType',
    aliases: ['acquisition', 'acquired via', 'purchase method'],
  },
  {
    field: 'purchaseDate',
    header: 'Purchase date',
    label: 'Purchase date',
    kind: 'date',
    aliases: [
      'purchased',
      'purchased at',
      'purchased on',
      'date purchased',
      'acquired',
      'acquired at',
      'acquisition date',
      'paid date',
    ],
  },
  {
    field: 'purchaseAmount',
    header: 'Purchase amount',
    label: 'Purchase amount',
    kind: 'money',
    aliases: [
      'purchase price',
      'purchase cost',
      'purchased price',
      'cost',
      'paid',
      'amount paid',
      'acquired price',
      'acquisition cost',
    ],
  },
  {
    field: 'purchaseCurrency',
    header: 'Purchase currency',
    label: 'Purchase currency',
    kind: 'currency',
    aliases: [],
  },
  {
    field: 'purchaseYears',
    header: 'Purchase years',
    label: 'Purchase years',
    kind: 'years',
    aliases: ['years', 'term', 'registration years'],
  },
  {
    field: 'saleDate',
    header: 'Sale date',
    label: 'Sale date',
    kind: 'date',
    aliases: ['sold date', 'sold', 'sold at', 'sold on', 'date sold'],
  },
  {
    field: 'saleAmount',
    header: 'Sale amount',
    label: 'Sale amount',
    kind: 'money',
    aliases: [
      'sale price',
      'sold price',
      'sold amount',
      'sold for',
      'selling price',
    ],
  },
  {
    field: 'saleCurrency',
    header: 'Sale currency',
    label: 'Sale currency',
    kind: 'currency',
    aliases: ['sold currency'],
  },
  {
    field: 'notes',
    header: 'Notes',
    label: 'Notes',
    kind: 'text',
    aliases: ['note', 'domain note', 'comments', 'comment', 'memo'],
  },
  {
    field: 'currency',
    header: 'Currency',
    label: 'Currency (every price in the row)',
    kind: 'currency',
    aliases: ['curr', 'ccy'],
  },
];

export const FIELD_INFO: Record<ImportField, ImportFieldInfo> =
  Object.fromEntries(IMPORT_FIELDS.map((f) => [f.field, f])) as Record<
    ImportField,
    ImportFieldInfo
  >;

/** A header without case, `*`, "required", a bracketed hint, spaces, or punctuation. */
export interface NormalizedHeader {
  key: string;
  /** A currency named in brackets, e.g. "Amount (USD)" → "USD". */
  currencyHint: string | null;
}

export function normalizeHeader(header: string): NormalizedHeader {
  let s = header.trim().toLowerCase();
  let currencyHint: string | null = null;
  // A bracketed currency is a hint ("Amount (USD)"); anything else in
  // brackets is part of the name ("Domain Name (ACE)").
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (_, inner: string) => {
    const code = inner.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && code !== 'ACE') {
      currencyHint = code;
      return ' ';
    }
    return ` ${inner} `;
  });
  s = s.replace(/\brequired\b/g, ' ').replace(/&/g, 'and');
  return { key: s.replace(/[^a-z0-9]+/g, ''), currencyHint };
}

const ALIAS_INDEX = new Map<string, ImportField>();
for (const f of IMPORT_FIELDS) {
  for (const name of [f.header, ...f.aliases]) {
    const { key } = normalizeHeader(name);
    if (!ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, f.field);
  }
}

// Headers that never match on their own: they mean different things in
// different files (park.io's "Amount" is what you paid; elsewhere it's a
// price), or they're values DomBot doesn't keep.
const AMBIGUOUS = new Set(
  [
    'amount',
    'value',
    'estimated value',
    'date',
    'description',
    'category',
    'price option',
  ].map((h) => normalizeHeader(h).key),
);

// Personal data and secrets: never matched on their own, so they're dropped
// in the renderer and never sent anywhere.
const SENSITIVE =
  /registrant|admin|administrative|technical|tech|billing|email|phone|fax|address|authcode|eppcode|password|whois|accountholder|accountno/;

/** True for a column that holds personal data or a secret. */
export function isSensitiveHeader(header: string): boolean {
  return SENSITIVE.test(normalizeHeader(header).key);
}

/** The field a header names on its own, or null. */
export function fieldForHeader(header: string): ImportField | null {
  const { key } = normalizeHeader(header);
  if (!key || AMBIGUOUS.has(key) || isSensitiveHeader(header)) return null;
  return ALIAS_INDEX.get(key) ?? null;
}

/** True when a cell reads like a header that names the Domain column. */
export function isDomainHeader(cell: string): boolean {
  return fieldForHeader(cell) === 'domain';
}

/** A file format DomBot recognizes by its header row (Appendix B). */
export interface KnownFormat {
  id: string;
  label: string;
  /** Normalized headers that must all be present. */
  requires: string[];
  /** Header (normalized) → field, beyond or instead of the aliases. */
  fields?: Record<string, ImportField | null>;
  /** The registrar every name in this file is at: an id, or free text. */
  registrar?: string;
  purchaseType?: 'registered' | 'purchased';
  /** DomBot's own export: the matching step can be skipped. */
  exact?: boolean;
}

const n = (h: string) => normalizeHeader(h).key;

export const KNOWN_FORMATS: KnownFormat[] = [
  {
    id: 'dombot',
    label: 'DomBot export',
    requires: [
      n('Domain'),
      n('Purchase type'),
      n('Price currency'),
      n('Sale amount'),
    ],
    exact: true,
  },
  {
    id: 'godaddy',
    label: 'GoDaddy export',
    requires: [
      n('Domain Name'),
      n('International Domain Name'),
      n('Ownership Date'),
      n('FolderMemberships'),
    ],
    // Its Status is the registration's ("Active", "Expired"), not ownership.
    fields: { [n('Status')]: null },
    registrar: 'godaddy',
  },
  {
    id: 'dynadot',
    label: 'Dynadot export',
    requires: [
      n('Renewal Status'),
      n('Punycode'),
      n('Expiration Date Timestamp'),
    ],
    fields: { [n('Domain Note')]: 'notes' },
    registrar: 'dynadot',
  },
  {
    id: 'namecheap',
    label: 'Namecheap export',
    requires: [n('Domain status at NC'), n('Domain auto-renew status')],
    registrar: 'namecheap',
  },
  {
    id: 'netsol',
    label: 'Network Solutions export',
    requires: [n('Account No'), n('Account Holder'), n('Auto Renew')],
    registrar: 'Network Solutions',
  },
  {
    id: 'hexonet',
    label: 'Hexonet export',
    requires: [n('Domain'), n('Status'), n('Renewal Date'), n('Nameserver')],
    fields: { [n('Status')]: null, [n('Renewal Date')]: 'expirationDate' },
    registrar: 'Hexonet',
  },
  {
    id: 'sav',
    label: 'Sav export',
    requires: [n('domain_id'), n('buy_now_price'), n('date_added_to_account')],
    fields: {
      [n('date_registered')]: 'createdDate',
      [n('folder_name')]: 'folder',
      [n('buy_now_price')]: 'binPrice',
      [n('status')]: null,
    },
    registrar: 'Sav',
  },
  {
    id: 'parkio',
    label: 'park.io order export',
    requires: [n('Order ID'), n('Paid Date'), n('On park.io')],
    // Created Date is when the order was placed, not the registration.
    fields: {
      [n('Amount (USD)')]: 'purchaseAmount',
      [n('Created Date')]: null,
    },
    purchaseType: 'purchased',
  },
  {
    id: 'efty',
    label: 'Efty export',
    requires: [n('Landing Page theme'), n('BIN Price'), n('Efty market')],
  },
  {
    id: 'afternic-listings',
    label: 'Afternic listings export',
    requires: [n('*Name (Required)'), n('*Minimum Offer (Required)')],
  },
  {
    id: 'afternic-2',
    label: 'Afternic export',
    requires: [n('Fast Transfer'), n('Listing Status'), n('Buy Now Price')],
    fields: { [n('Listing Status')]: null, [n('Date Added')]: null },
  },
  {
    id: 'sedo',
    label: 'Sedo export',
    requires: [n('Domain Name (ACE)'), n('SedoMLS Status'), n('Price Option')],
    fields: { [n('Domain Name (ACE)')]: null, [n('Inserted')]: null },
  },
];

/** The known format a header row matches, or null. */
export function detectFormat(headers: string[]): KnownFormat | null {
  const keys = new Set(headers.map((h) => normalizeHeader(h).key));
  return (
    KNOWN_FORMATS.find((f) => f.requires.every((r) => keys.has(r))) ?? null
  );
}

/**
 * The field each column holds: the known format's own mapping first, then
 * the aliases. One column per field: a later column naming a field already
 * taken is left unmatched. `Status` only matches when most of its values
 * are ownership words (`isStatusColumn`), since registrars use the same
 * header for a registry status.
 */
export function matchColumns(
  headers: string[],
  isStatusColumn: (column: number) => boolean,
  format: KnownFormat | null = detectFormat(headers),
): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  return headers.map((header, i) => {
    const key = normalizeHeader(header).key;
    const own = format?.fields && Object.hasOwn(format.fields, key);
    const field = own ? format!.fields![key] : fieldForHeader(header);
    if (!field || taken.has(field)) return null;
    if (field === 'status' && !isStatusColumn(i)) return null;
    taken.add(field);
    return field;
  });
}
