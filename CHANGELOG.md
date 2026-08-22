# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Made `README.md` the primary English guide and added a synchronized `README.ru.md` translation.
- Reworked the technical tool reference and all 16 capability pages into English, with coverage tests for the public documentation contract.
- Documented Shopify's current authentication boundary: the server accepts a ready-to-use Admin API access token but does not perform OAuth or refresh expiring tokens.
- Added an A1 social preview asset for the repository.

## [1.0.0] — 2026-08-21

### Added

- Initial release: an MCP server over stdio for the Shopify Admin API (GraphQL),
  bound to one store via `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ACCESS_TOKEN`.
- 16 tools: `get_shop`; products (`list_products`, `get_product`, `create_product`,
  `update_product`, `update_variant`); orders (`list_orders`, `get_order`,
  `cancel_order`); customers (`list_customers`, `get_customer`); inventory
  (`list_locations`, `set_inventory`); discounts (`list_discounts`,
  `create_basic_discount`); and the `graphql_request` escape hatch, which takes
  an arbitrary document, its `variables` and an optional `operationName` —
  required when the document holds more than one operation.
- Every response carries the GraphQL cost-bucket state (`cost`); THROTTLED calls
  are retried with the wait the bucket math implies, 5xx/network failures are
  retried for queries only — the operation kind comes from parsing the document,
  so a mutation preceded by fragment definitions is not repeated either — and
  mutation `userErrors` become explicit errors.
- HTTP 200 is never taken on trust: a body that is empty, truncated mid-stream
  or not GraphQL at all fails with `Ответ Shopify не содержит объект data`
  instead of coming back as a successful call with empty data.
- Degraded start without credentials: the server completes the MCP handshake,
  reports the fix in the initialize instructions and answers every call with an
  actionable `CredentialsError`; a malformed value degrades the same way, and
  the call then names the variable that actually broke.
- Configuration is validated and never echoed back: `SHOPIFY_STORE_DOMAIN`
  normalizes to the permanent `*.myshopify.com` host, `SHOPIFY_API_BASE` must be
  an http/https URL, messages name the accepted shape instead of the rejected
  value, and the startup line reports the target without anything a URL may
  carry.
- Anonymous usage telemetry with the `ASKADS_TELEMETRY=0` opt-out shared across
  the Ask Ads server line.
