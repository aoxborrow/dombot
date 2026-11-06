# Namefi integration preparation

This companion change prepares DomBot for the Namefi provider in registrar-client.
It does not vendor a hosted SDK or pretend that the current pinned npm release
contains the provider. Namefi becomes selectable when the SDK provider is merged,
published and the application dependency lock is updated to that release.

The prepared metadata covers the API-key form and credential link, the official
logo, IANA registrar 4337, Namefi DNS, and annual domain quotes where the provider
supplies them. Privacy and transfer-lock readings are unreported, so the UI must
not show the SDK's default false flags as observed off/unlocked states. Manual
renewal, transfer-lock, privacy and delegation changes direct the user to Namefi.

Plain API keys can spend NFSC and charge a saved card. They are submitted through
the normal credential store; no credentials or live account data belong in this
contribution. The official logo is from
https://namefi.io/assets/brand-kit/namefi-compact-square.svg with a normalized
viewBox and equivalent clip path.

Keep this PR a draft until a released registrar-client version includes Namefi,
then update the dependency and lockfile and rerun all application checks. The
prepared future metadata stays exhaustive for the currently released registrars.
