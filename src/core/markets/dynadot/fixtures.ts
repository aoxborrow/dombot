// Dynadot's answers, shaped as observed live (2026-11-04), with made-up
// names, ids, prices and keys.

export const KEY = '0123456789abcdef0123456789abcdef';

export const accountInfo = {
  code: 200,
  message: 'Success',
  data: {
    account_info: {
      username: 'example',
      price_level: 'Bulk Account',
      account_balance: '0.00',
      balance_list: [{ currency: 'USD', amount: '0.00' }],
    },
  },
};

export function domainsPage(
  rows: { name: string; forSale: boolean }[],
  page: number,
  pageSize: number,
  total: number,
) {
  return {
    code: 200,
    message: 'Success',
    data: {
      domain_info_list: rows.map((r) => ({
        domain_name: r.name,
        expiration_date: 1844786416000,
        registration_date: 1371400816000,
        glue_info: { glue_type: 'NAME_SERVERS' },
        locked: 'Yes',
        is_for_sale: r.forSale ? 'Yes' : 'No',
        status: 'Active',
      })),
      pagination_result: {
        page,
        page_size: pageSize,
        total,
        has_next_page: page * pageSize < total ? 'Yes' : 'No',
      },
    },
  };
}

export function listingItem(
  name: string,
  type = 'BIN',
  price = '2500.00',
  pending = 'No',
) {
  return {
    code: 200,
    message: 'Success',
    data: {
      listing_item: {
        listing_id: 21185431,
        domain: name,
        price,
        in_bound_links: 12,
        age: 3,
        is_pending_sale_locked: pending,
        type,
        registration_date: 1765951172000,
        expiration_date: 1797487172000,
      },
    },
  };
}

export const notFound = (name: string) => ({
  code: 404,
  message: 'Not Found',
  error: { description: `Can not find the ${name}.` },
});

export const missingCurrency = {
  code: 400,
  message: 'Bad Request',
  error: { description: 'The value for parameter currency is invalid.' },
};

export const otherRegistrarList = {
  code: 200,
  message: 'Success',
  data: {
    domain_info_list: [
      {
        registrar: '101domain',
        folder_id: -1,
        registration_date: 1371400816000,
        expiration_date: 1844786416000,
        status: 'Registered',
        verify_status: 'Unverified',
        for_sale_type: 'Not Set',
        price: '',
        transfer_status: '',
        updated_date: 1793728405390,
        domain_name: 'domanio.com',
      },
      {
        registrar: '',
        folder_id: -1,
        registration_date: 0,
        expiration_date: 0,
        status: 'Unregistered',
        verify_status: 'Verified',
        for_sale_type: 'Buy Now + Make Offer',
        price: '1,500.00',
        transfer_status: '',
        updated_date: 1791579884909,
        domain_name: 'lumenpost.io',
      },
    ],
  },
};

export const verification = {
  code: 200,
  message: 'Success',
  data: {
    txt: KEY,
    domain_name: 'domanio.com',
    cname: `ns1-${KEY}.dyna-ns.net`,
    nameserver_list: [
      'ns1.dyna-ns.net',
      'ns2.dyna-ns.net',
      `ns3-${KEY}.dyna-ns.org`,
    ],
    verify_status: 'Unverified',
    open_market_key: KEY,
  },
};
