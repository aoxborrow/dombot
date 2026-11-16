# Verified registration-date recovery

Invalid registrar creation dates trigger a registry RDAP check using the HTTPS
TLD authority published in IANA's DNS bootstrap. A successful response must name
the exact requested domain and contain a valid, unambiguous registration event.
The recovered instant and `createdDateSource` (registry URL and actual check time)
are cached independently of registrar records. Portfolio reads remain cache-only.

Only creation is recovered. Registrar expiry, renewal dates, account identity,
auto-renew, lock, privacy, nameservers and quote age retain their existing sources.
The date remains the UTC registration instant, and the UI presents its UTC day.
No registration year is inferred from expiry. Healthy dates and imported user facts
do not initiate registry requests.

Inventory sync, cached/forced detail reads and direct registrar MCP reads all use
the same recovery. Verified evidence survives a bad registrar refresh, a registry
outage and cache reload, with its original observation time intact. Explicit
unregistered registry results invalidate previous evidence. Failed lookups are
bounded and backed off; a name with no usable evidence remains visibly unresolved.
A quote-only entry is still not a detail read.

The same provenance is returned by `portfolio_query` and `domain_get`. Clearing
cache drops re-fetchable registry data along with the registrar caches. No registry
contact records, registrar secrets or complete RDAP responses are stored.
