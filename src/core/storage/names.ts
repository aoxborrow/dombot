// Namespace names that modules below the services layer need (diagnostics
// sanitizing, migrations). A leaf module, so importing a name never pulls in
// a service and its `new Namespace(...)` before namespace.ts has loaded.

export const CREDENTIALS_NAMESPACE = 'registrar-credentials';
export const RENEWAL_PRICES_NAMESPACE = 'domain-prices';

// Markets (docs/markets.md).
export const MARKET_ACCOUNTS_NAMESPACE = 'market-accounts';
export const MARKET_CREDENTIALS_NAMESPACE = 'market-credentials';
export const MARKET_LISTINGS_NAMESPACE = 'market-listings';
export const MARKET_LAST_SYNC_NAMESPACE = 'market-last-sync';
export const MARKET_SALES_NAMESPACE = 'market-sales';
export const MARKET_STATS_NAMESPACE = 'market-stats';
