import type { RegistrarName } from './ipc';

/** A real, clickable destination shown in the settings form. */
export interface HelpLink {
  label: string;
  url: string;
}

/**
 * Help shown in a registrar's expanded settings card. Owned here rather than
 * taken from registrar-client's `helpText` so the copy can speak to the app's
 * form and every link is a real URL — the library's text is written for API
 * consumers and mentions options (sandbox modes, programmatic-only fields)
 * that don't exist in this UI.
 *
 * Keep it terse: which credential, where it's created, and the one gotcha. A
 * field gets a description only when it needs disambiguating (which of two
 * keys, an expected format); otherwise leave it out rather than restate the
 * label. Wrap literal keywords (scopes, prefixes, formats) in backticks; they
 * render as code.
 */
export interface RegistrarHelp {
  summary: string;
  /** The credential page and, where useful, the docs. */
  links: HelpLink[];
  /** Per-field guidance keyed by `ConfigField.name`, shown between the label
   *  and the input. Fields with no entry show nothing. */
  fields: Record<string, string>;
  /** The collapsed Optional section's title, and what its settings are for,
   *  shown at its top. Only registrars with Optional fields have one. */
  optional?: { title: string; summary: string };
}

// Exhaustive over RegistrarName so adding a registrar to the library forces a
// help entry here (the build fails until one is written).
export const REGISTRAR_HELP: Record<RegistrarName, RegistrarHelp> = {
  '101domain': {
    summary:
      'An API key from My Account › Developer Tools – API & MCP, with the ' +
      '`domains_read` and `dns_read` scopes. Add `dns_write` to edit DNS and ' +
      'nameservers, and `domains_write` for URL forwarding. Only the primary ' +
      'user, with 2FA or SSO, can create keys. DNS records can only be ' +
      'edited on 101domain or Secure Web Accelerator nameservers. Renewals, auto-renew, lock, ' +
      'privacy and transfers aren’t available through the API.',
    links: [
      {
        label: 'How to create an API key',
        url: 'https://help.101domain.com/kb/how-to-get-api-keys',
      },
    ],
    fields: {
      apiKey: 'Keys expire after a year at most.',
    },
  },

  cloudflare: {
    summary:
      'A user API token with the account-level Registrar permission (Read ' +
      'and Edit).',
    links: [
      {
        label: 'Create an API token',
        url: 'https://dash.cloudflare.com/profile/api-tokens',
      },
      {
        label: 'Find your Account ID',
        url: 'https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/',
      },
    ],
    fields: {
      apiToken: 'A user API token, not the Global API Key.',
      accountId:
        '32-character hex ID — on any zone’s Overview page, or Copy Account ' +
        'ID from the accounts list.',
    },
  },

  dynadot: {
    summary:
      'An API key and secret from Tools › API in your account. The account ' +
      'must be unlocked with API access enabled before they are shown.',
    links: [
      {
        label: 'Where to find your API key',
        url: 'https://www.dynadot.com/help/question/1151',
      },
    ],
    fields: {},
  },

  gandi: {
    summary:
      'A Personal Access Token created under User settings › Authentication ' +
      'options, with permission to manage domains. The legacy API key is ' +
      'deprecated.',
    links: [
      { label: 'Gandi admin', url: 'https://admin.gandi.net/' },
      {
        label: 'How to create a Personal Access Token',
        url: 'https://docs.gandi.net/en/managing_an_organization/organizations/personal_access_token.html',
      },
    ],
    fields: {},
  },

  godaddy: {
    summary:
      'A Personal Access Token (PAT) generated from the GoDaddy developer ' +
      'dashboard.',
    links: [
      { label: 'Developer dashboard', url: 'https://developer.godaddy.com/' },
      {
        label: 'About authentication (creating a PAT)',
        url: 'https://developer.godaddy.com/en/docs/api-users/auth',
      },
    ],
    fields: {
      customerId: 'The numeric Customer ID shown in your GoDaddy account.',
    },
    optional: {
      title: 'Optional GoDaddy v2 API (Legacy)',
      summary:
        'Only used for two features: URL forwarding and approving ' +
        'transfer-outs. Both go through GoDaddy’s older v2 API. Everything ' +
        'else works with the PAT alone.',
    },
  },

  namebright: {
    summary:
      'API access must be requested from NameBright support first. Once ' +
      'enabled, create an API Application on the API Management page; each ' +
      'application enforces an IP whitelist.',
    links: [
      {
        label: 'API Management',
        url: 'https://my.namebright.com/my-account/api-management',
      },
    ],
    fields: {
      clientId:
        'Account name and application name joined with a colon, e.g. ' +
        '`MyAccount:MyApp`.',
    },
  },

  namecheap: {
    summary:
      'Enable API access under Profile › Tools › Namecheap API Access, ' +
      'generate a key, and whitelist the IP address you will call from ' +
      '(IPv4 only).',
    links: [
      {
        label: 'API Access settings',
        url: 'https://ap.www.namecheap.com/settings/tools/apiaccess/',
      },
    ],
    fields: {
      clientIp:
        'The whitelisted IPv4 address; calls from any other IP are rejected.',
    },
  },

  namecom: {
    summary:
      'A production API token. If your account uses two-step verification, enable API Access in its security settings.',
    links: [
      {
        label: 'API token settings',
        url: 'https://www.name.com/account/settings/api',
      },
    ],
    fields: {
      apiToken:
        'Use a token from the Production section, not the Development/Test token.',
    },
  },

  namefi: {
    summary:
      'Create a Plain API Key in your Namefi account. Both email-held and NFT-held domains are included. Keys can spend your NFSC balance and charge your saved card. Privacy and transfer-lock state are not reported. Use Namefi for manual renewal, transfers and nameserver changes.',

    links: [
      { label: 'Create an API key', url: 'https://namefi.io/api-keys' },
      {
        label: 'Namefi API documentation',
        url: 'https://api.namefi.io/v-next/openapi/doc',
      },
    ],
    fields: { apiKey: 'Use a Plain API Key beginning with `nfk_`.' },
  },

  namesilo: {
    summary:
      'An API key generated in the API Manager under Account Options, ' +
      'optionally restricted to specific IP addresses.',
    links: [
      {
        label: 'API Manager',
        url: 'https://www.namesilo.com/account/api-manager',
      },
    ],
    fields: {},
  },

  porkbun: {
    summary: 'An API key and secret from the API Access page.',
    links: [{ label: 'API Access', url: 'https://porkbun.com/account/api' }],
    fields: {
      apiKey: 'Starts with `pk1_`.',
      secretApiKey: 'Starts with `sk1_`.',
    },
  },

  spaceship: {
    summary: 'An API key and secret from the API Manager.',
    links: [
      {
        label: 'API Manager',
        url: 'https://www.spaceship.com/application/api-manager/',
      },
    ],
    fields: {},
  },

  unstoppable: {
    summary:
      'An MCP API key from Account Settings › Advanced (it starts with ' +
      '`ud_mcp_`). Only regular (ICANN) domains are listed, not web3 names. ' +
      'Registration, renewal, transfers and contacts aren’t supported.',
    links: [
      {
        label: 'Account Settings',
        url: 'https://unstoppabledomains.com/account/settings',
      },
      {
        label: 'How to create an MCP API key',
        url: 'https://support.unstoppabledomains.com/support/solutions/articles/48001280210-connect-your-ai-agent-to-unstoppable-domains',
      },
    ],
    fields: {},
  },
};
