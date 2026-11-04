# Retained housing search sources

The active housing search architecture is restricted to these families:

- ImmoScout24: Hamburg (source 1) and Schleswig-Holstein (source 69).
- Immowelt: Hamburg (source 3) and Schleswig-Holstein category streams (source 71).
- Immomio tenant connectors: sources 23, 28, 29, 30, 32, 34, 35, 36, 39, 65 and 66.
- Verified tenant.immomio source: Finkenwärder-Hoffnung (source 37). Its connector uses a tenant.immomio application endpoint and the production database contains sent delivery evidence.

All other registry sources are retired from the active runtime. Their historical rows remain only because listings, applications and audit records reference source IDs with non-null foreign keys. Retired sources have no enabled connectors, no worker assignment, no new crawl scheduling and no delivery eligibility. Connector configuration for retired sources is redacted to a retirement marker.

The database function `public.source_allowed_for_search(smallint)` is the authoritative allowlist predicate. The source worker also applies the same allowlist in-process before claiming work.

The allowlist is deliberately narrower than the historical source registry. A source is not retained merely because it has a homepage, a provider profile, an Immomio registration page, or historical listings. The additional-source rule requires both a `tenant.immomio` connector/endpoint and at least one sent delivery.
