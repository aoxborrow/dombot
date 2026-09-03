import type { RegistrarName } from './ipc';

/** A real, clickable destination shown in the settings form. */
export interface HelpLink {
  label: string;
  url: string;
}

/** Guidance for one credential input, keyed by its `ConfigField.name`. */
export interface FieldHelp {
  text: string;
  /** Optional "where to find it" link rendered after the text. */
  link?: HelpLink;
}

/**
 * Help shown in a registrar's expanded settings card. Owned here rather than
 * taken from registrar-client's `helpText` so the copy can speak to the app's
 * form (per field, in the order the form shows them) and every link is a real
 * URL — the library's text is written for API consumers and mentions options
 * (sandbox modes, programmatic-only fields) that don't exist in this UI.
 */
export interface RegistrarHelp {
  /** One or two sentences: which credential, where it's created, any gotcha. */
  summary: string;
  /** Primary places to go — the credential page and, where useful, the docs. */
  links: HelpLink[];
  /** Per-field guidance. A field with no entry simply shows no description. */
  fields: Record<string, FieldHelp>;
}

// Exhaustive over RegistrarName so adding a registrar to the library forces a
// help entry here (the build fails until one is written).
export const REGISTRAR_HELP: Record<RegistrarName, RegistrarHelp> = {
  cloudflare: {
    summary:
      'Cloudflare Registrar is managed with a user API token scoped to your ' +
      'account. Create a custom token with the account-level Registrar ' +
      'permission (Read and Edit), then paste it below along with the ID of ' +
      'the account that holds your domains.',
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
      apiToken: {
        text:
          'A user API token — not the Global API Key — with the account-level ' +
          'Registrar permission set to Read and Edit. Cloudflare shows it only ' +
          'once, when it is created.',
      },
      accountId: {
        text:
          'The 32-character ID of the Cloudflare account holding your domains. ' +
          'It is on the Overview page of any zone, or use Copy Account ID from ' +
          'the accounts list.',
      },
    },
  },

  dynadot: {
    summary:
      'Dynadot uses an API key to identify your account and an API secret to ' +
      'sign each request. Both live on the API page under Tools in your ' +
      'account; the account must be unlocked with API access enabled before ' +
      'the keys are shown.',
    links: [
      {
        label: 'Where to find your API key',
        url: 'https://www.dynadot.com/help/question/1151',
      },
      {
        label: 'API documentation',
        url: 'https://www.dynadot.com/domain/api-document',
      },
    ],
    fields: {
      apiKey: {
        text: 'Your Production API Key from Tools › API (not the Sandbox key).',
      },
      apiSecret: {
        text:
          'Your Production API Secret Key. It signs requests and is never sent ' +
          'on the wire, so keep it private.',
      },
    },
  },

  gandi: {
    summary:
      'Gandi’s API uses a Personal Access Token (PAT). Create one in your ' +
      'Gandi admin under User settings › Authentication options › Personal ' +
      'Access Tokens, with permission to manage domains. The legacy API key ' +
      'is deprecated and no longer works.',
    links: [
      { label: 'Gandi admin', url: 'https://admin.gandi.net/' },
      {
        label: 'How to create a Personal Access Token',
        url: 'https://docs.gandi.net/en/managing_an_organization/organizations/personal_access_token.html',
      },
    ],
    fields: {
      apiKey: {
        text:
          'Copy the token as soon as it is created — Gandi shows it only once. ' +
          'Tokens expire (one year at most), so replace it when it does.',
      },
    },
  },

  godaddy: {
    summary:
      'GoDaddy’s API uses a Personal Access Token (PAT). Generate one from the ' +
      'GoDaddy developer dashboard — it is the only credential you need, ' +
      'covering domain listing, DNS, renewals, transfers, and locks.',
    links: [
      { label: 'Developer dashboard', url: 'https://developer.godaddy.com/' },
      {
        label: 'About authentication (creating a PAT)',
        url: 'https://developer.godaddy.com/en/docs/api-users/auth',
      },
    ],
    fields: {
      apiToken: {
        text:
          'A Personal Access Token from the developer dashboard. Grant it the ' +
          'domain scopes you need; it is shown once, so copy it right away. ' +
          'The older API Key/Secret pair is not supported here.',
      },
    },
  },

  namebright: {
    summary:
      'NameBright issues API credentials per application. API access is off ' +
      'by default — request it from NameBright support first. Once enabled, ' +
      'create an API Application on the API Management page; each application ' +
      'also enforces an IP whitelist.',
    links: [
      {
        label: 'API Management',
        url: 'https://my.namebright.com/my-account/api-management',
      },
    ],
    fields: {
      clientId: {
        text:
          'Your account name and the application name joined with a colon, ' +
          'e.g. MyAccount:MyApp.',
      },
      clientSecret: {
        text: 'The secret NameBright assigns when you create the application.',
      },
    },
  },

  namecheap: {
    summary:
      'Namecheap’s API is off until you enable it and whitelist an IP. Turn it ' +
      'on under Profile › Tools › Business & Dev Tools › Namecheap API ' +
      'Access, generate a key, then add the IP address you will call from ' +
      '(IPv4 only).',
    links: [
      {
        label: 'API Access settings',
        url: 'https://ap.www.namecheap.com/settings/tools/apiaccess/',
      },
      {
        label: 'API documentation',
        url: 'https://www.namecheap.com/support/api/intro/',
      },
    ],
    fields: {
      username: {
        text: 'Your Namecheap account username — the one you sign in with.',
      },
      apiKey: { text: 'The API key from the API Access page.' },
      clientIp: {
        text:
          'The public IPv4 address you whitelisted on the API Access page. ' +
          'Namecheap rejects calls from any IP that is not on the list.',
      },
    },
  },

  namesilo: {
    summary:
      'NameSilo uses a single API key. Generate one from the API Manager under ' +
      'Account Options; you can restrict it to specific IP addresses there.',
    links: [
      {
        label: 'API Manager',
        url: 'https://www.namesilo.com/account/api-manager',
      },
    ],
    fields: {
      apiKey: {
        text: 'Copy the key when it is generated — NameSilo does not show it again.',
      },
    },
  },

  porkbun: {
    summary:
      'Porkbun uses an API key and secret pair. Create them on the API Access ' +
      'page, then turn on API Access for each domain you want to manage — it ' +
      'is a per-domain toggle in the domain’s Details.',
    links: [
      { label: 'API Access', url: 'https://porkbun.com/account/api' },
      {
        label: 'API documentation',
        url: 'https://porkbun.com/api/json/v3/documentation',
      },
    ],
    fields: {
      apiKey: { text: 'The API Key (it starts with pk1_).' },
      secretApiKey: {
        text:
          'The Secret API Key (it starts with sk1_). It is shown only when ' +
          'the pair is created.',
      },
    },
  },

  spaceship: {
    summary:
      'Spaceship uses an API key and secret. Create them in the API Manager ' +
      'with New API key — both are required on every request.',
    links: [
      {
        label: 'API Manager',
        url: 'https://www.spaceship.com/application/api-manager/',
      },
      { label: 'API documentation', url: 'https://docs.spaceship.dev/' },
    ],
    fields: {
      apiKey: { text: 'The API key from the API Manager.' },
      apiSecret: {
        text: 'The matching API secret, shown when the key is created.',
      },
    },
  },
};
