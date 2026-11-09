# Namefi

DomBot connects to Namefi through the provider in registrar-client (1.2.0 and
later), with an API-key form and credential link, the official logo, IANA
registrar 4337, Namefi DNS recognition and per-name annual quotes.

The API doesn't report WHOIS privacy or the transfer lock, so DomBot shows them as
not reported instead of the library's default `false`, in the UI, MCP results and
CSV exports. Manual renewal, transfer-lock, privacy and nameserver changes direct
the user to Namefi.

Plain API keys can spend NFSC and charge a saved card. They are stored like any
other registrar credential. The logo is from
https://namefi.io/assets/brand-kit/namefi-compact-square.svg with a normalized
viewBox and equivalent clip path.
