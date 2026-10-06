# 101domain integration preparation

This companion draft depends on [registrar-client PR #59](https://github.com/aoxborrow/registrar-client/pull/59). The current released dependency (0.7.0) has no 101domain provider. After the provider is published, update the dependency and lockfile, rerun checks, and mark this PR ready. The generic provider catalog will then expose 101domain automatically.

The companion adds credential/scope/expiry help, the official monochrome logo, demo nameservers, conservative bulk spacing, and API capability guards. Keys use the existing encrypted account storage and account-ID routing. Use `domains_read` and `dns_read` for reads, `dns_write` for DNS/nameservers, and `domains_write` for permanent apex URL forwarding.

The API does not offer registration, renewal, auto-renew changes, transfer/EPP codes, privacy/lock changes or contact mutations. Known unavailable row/bulk/MCP operations are blocked before dispatch. Privacy is not reported and is displayed as “Not reported,” rather than treating its normalized default as an off state. Nameserver changes accepted but pending keep active cached/UI nameservers until a later read confirms completion.

The web account flow also restores omitted optional positional arguments that JSON serializes as null. This fixes adding an account without a nickname while preserving meaningful nulls and required-argument validation.

Read-only account sync was verified in the separate local integration preview: 30 records, no API errors. That preview used an injected Node TLS transport because local workerd failed to reach the API host even without authentication. This upstream draft contains no temporary transport, hosted-tenant configuration, credential files or local package archive. Hosted access and real DNS/forwarding writes remain unverified.

Sources: [API reference](https://api.101domain.com/api/documentation), [key setup](https://help.101domain.com/kb/how-to-get-api-keys), [endpoint capabilities](https://help.101domain.com/kb/api-endpoints-reference).
