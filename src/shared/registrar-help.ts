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
 * label.
 */
export interface RegistrarHelp {
  summary: string;
  /** The credential page and, where useful, the docs. */
  links: HelpLink[];
  /** Per-field guidance keyed by `ConfigField.name`, shown between the label
   *  and the input. Fields with no entry show nothing. */
  fields: Record<string, string>;
}

// Exhaustive over RegistrarName so adding a registrar to the library forces a
// help entry here (the build fails until one is written).
export const REGISTRAR_HELP: Record<RegistrarName, RegistrarHelp> = {
  cloudflare: {
    summary:
      'A user API token with the account-level Registrar permission (Read ' +
      'and Edit), plus the ID of the account that holds your domains.',
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
      'An API key and secret from Tools › API in your account. Use the ' +
      'Production pair, not the Sandbox one; the account must be unlocked ' +
      'with API access enabled before they are shown.',
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
      'dashboard. The older API Key/Secret pair is not supported.',
    links: [
      { label: 'Developer dashboard', url: 'https://developer.godaddy.com/' },
      {
        label: 'About authentication (creating a PAT)',
        url: 'https://developer.godaddy.com/en/docs/api-users/auth',
      },
    ],
    fields: {},
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
        'MyAccount:MyApp.',
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
      apiKey: 'Starts with pk1_.',
      secretApiKey: 'Starts with sk1_.',
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
};
