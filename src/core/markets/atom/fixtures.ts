// Response shapes for unit tests, with made-up names and amounts. The error
// bodies are as observed live (unauthenticated, 2026-10-27). Everything else
// is a guess from Atom's specs (DomainApiResponse's fields, the registrar
// API's `success`/`data`/`pagination` envelope). UNVERIFIED: replace with
// recorded shapes once there's an API key.

export const invalidToken = {
  message: 'Invalid API token or insufficient permissions',
};

export const missingToken = { message: 'API Token and UserId are required' };

export const dailyLimit = {
  message:
    'Daily rate limit exceeded. You have used 10 of 10 daily appraisal requests.',
  daily_limit: 10,
  used_today: 10,
};

export function listingRecord(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    domain_name: name,
    status: 'Seller Approved',
    selling_price: 2500,
    primary_category: 'Technology',
    discount_price: 0,
    description: `${name} for a fast-growing brand`,
    ...overrides,
  };
}

/** A page of listings in the registrar API's envelope. */
export function listingsPage(
  names: readonly string[],
  page: number,
  totalPages: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    success: true,
    data: names.map((n) => listingRecord(n, overrides)),
    pagination: {
      current_page: page,
      total_pages: totalPages,
      per_page: 100,
      total_records: null,
    },
  };
}

export const details = {
  success: true,
  data: listingRecord('brightloom.com', {
    domain_type: 'Standard',
    domain_name: 'BrightLoom.com',
    discount_price: 200,
    created_at: '2026-03-14 09:30:00',
  }),
};

export const sales = {
  success: true,
  data: [
    {
      order_id: 9001,
      domain_name: 'quillnest.com',
      domain_type: 'premium',
      sale_price: 4200,
      order_status: 'Completed',
      sold_date: '2026-05-02 17:45:10',
    },
    {
      order_id: 9002,
      domain_name: 'tidalforge.io',
      domain_type: 'standard',
      sale_price: 1800,
      commission: 135,
      net_payout: 1665,
      order_status: 'Payment Plan',
      sold_date: '2026-08-19',
      total_installments: 12,
      installments_paid: 3,
    },
  ],
};

export const analytics = {
  success: true,
  data: {
    domain_name: 'brightloom.com',
    direct_lander_visits: 40,
    platform_discovery_views: 210,
    repeat_views: 6,
    shortlists: 3,
    trackers: 2,
  },
};

export const primaryCategories = {
  success: true,
  data: [
    { id: 1, name: 'Technology' },
    { id: 2, name: 'Health & Wellness' },
  ],
};

export const syndication = {
  success: true,
  data: [{ domain_name: 'quillnest.com' }],
};

export const grading = {
  count: 1,
  data: {
    domain_name: 'brightloom.com',
    is_brand_fit: 'Yes',
    date_submitted: '2026-10-01',
    status: 'Graded',
    premium_fit: 'No',
  },
};

export const appraisal = {
  domain_name: 'brightloom.com',
  atom_appraisal: 3400,
  domain_score: 7,
  key_signals: ['Short', 'Two words'],
  root_words: ['bright', 'loom'],
  tld_taken_count: 4,
  tm_conflicts: 0,
};

export const ok = { message: 'Domain updated successfully' };
