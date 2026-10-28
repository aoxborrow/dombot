// Response shapes for unit tests, as Atom sent them live (2026-10-28), with
// made-up names, ids and amounts: the repo is public, so real responses
// would publish a portfolio and its sales. Grading rows and write answers
// are still from the spec (the account had none to show).

export const invalidToken = {
  message: 'Invalid API token or insufficient permissions',
};

export const missingToken = { message: 'API Token and UserId are required' };

/** What /domain-details and /domain-analytics say for a name not listed. */
export const notListed = { message: 'Wrong Domain name in the request' };

export const dailyLimit = {
  message:
    'Daily rate limit exceeded. You have used 10 of 10 daily appraisal requests.',
  daily_limit: 10,
  used_today: 10,
};

/** A listing record, as /domains, /domain-details and syndication send it. */
export function listingRecord(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 100001,
    domain_name: name,
    status: 'Approved',
    full_price: 2500,
    selling_price: 2500,
    primary_category: 'Technology',
    discount: 0,
    description: `${name} is a bright, memorable name for a fast-growing brand.`,
    logo_image: `https://img.atom.com/story_images/visual_images/${name}.png`,
    listing_type: 'Premium',
    ...overrides,
  };
}

/** A page of /domains: a bare array, no paging fields. */
export function listingsPage(
  names: readonly string[],
  overrides: Record<string, unknown> = {},
) {
  return names.map((n) => listingRecord(n, overrides));
}

export const details = listingRecord('BrightLoom.com', {
  id: 100002,
  status: 'Seller Approved',
  listing_type: 'Standard',
  full_price: 2400,
  selling_price: 2400,
});

/** A Standard listing at Make an Offer: price 0, no category or description. */
export const makeOffer = listingRecord('OpenBid.com', {
  status: 'Seller Approved',
  listing_type: 'Standard',
  full_price: 0,
  selling_price: 0,
  primary_category: null,
  description: null,
});

/** Sold names stay in the list. */
export const sold = listingRecord('QuillNest.io', {
  status: 'Transfer Complete',
  full_price: 4200,
  selling_price: 4200,
});

/** The syndication list sends a partner price in `selling_price`. */
export const syndicated = listingRecord('QuillNest.io', {
  full_price: 4200,
  selling_price: 4632.999999999999,
});

export const sales = [
  {
    'Domain Name': 'QuillNest.io',
    sales_type: 'Premium',
    sale_date: 'May 02, 2026 17:45:10',
    sale_amount: 4200,
    sale_amount_net: 0,
    sale_terms: 'Outright',
    transfer_status: 'AuthCode Sent',
    added_on: 'Dec 03, 2020 14:26:26',
  },
  {
    'Domain Name': 'TidalForge.io',
    sales_type: 'Premium',
    sale_date: 'Sep 8, 2025 09:05:00',
    sale_amount: 1800,
    sale_amount_net: 0,
    sale_terms: 'Outright',
    transfer_status: null,
    added_on: 'Dec 03, 2020 14:35:40',
  },
];

export const analytics = {
  total_views: 412,
  total_shortlists: 37,
  total_offers: 2,
};

export const categories = [
  { id: 9, name: 'Fitness & Gym' },
  { id: 56, name: 'Music & Audio' },
];

export const primaryCategories = {
  message: 'Primary categories list',
  categories: ['Technology', 'Health & Wellness'],
};

export const noGrading = { count: 0, data: [] };

/** A grading result, per the spec's GradeDomainResponse. */
export const grading = {
  count: 1,
  data: [
    {
      domain_name: 'brightloom.com',
      is_brand_fit: 'Yes',
      date_submitted: '2026-10-01',
      status: 'Graded',
      premium_fit: 'No',
    },
  ],
};

export const appraisal = {
  domain_name: 'brightloom.com',
  atom_appraisal: 3400,
  domain_score: 6.2,
  positive_signals: ['Registered in 12 TLDs', 'Aged Domain (6 Years)'],
  negative_signals: [],
  root_words: ['bright', 'loom'],
  tld_taken_count: 12,
  tm_conflicts: 0,
  date_registered: '2020-07-05 14:31:02',
  external_message: null,
  appraisal_token: '0123456789abcdef0123456789abcdef',
  is_listed: true,
  bin_price: 2400,
  usage: {
    used_today: 1,
    daily_limit: 10,
    cumulative_count: 1,
    user_level: 'B',
  },
  bonus_credits_remaining: 0,
};

export const ok = { message: 'Domain updated successfully' };
