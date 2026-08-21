# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-08-21

### Added

- Initial release: an MCP server over stdio for the Shopify Admin API (GraphQL),
  bound to one store via `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ACCESS_TOKEN`.
- 16 tools: `get_shop`; products (`list_products`, `get_product`, `create_product`,
  `update_product`, `update_variant`); orders (`list_orders`, `get_order`,
  `cancel_order`); customers (`list_customers`, `get_customer`); inventory
  (`list_locations`, `set_inventory`); discounts (`list_discounts`,
  `create_basic_discount`); and the `graphql_request` escape hatch.
- Every response carries the GraphQL cost-bucket state (`cost`); THROTTLED calls
  are retried with the wait the bucket math implies, 5xx/network failures are
  retried for queries only, and mutation `userErrors` become explicit errors.
- Degraded start without credentials: the server completes the MCP handshake,
  reports the fix in the initialize instructions and answers every call with an
  actionable `CredentialsError`.
- Anonymous usage telemetry with the `ASKADS_TELEMETRY=0` opt-out shared across
  the Ask Ads server line.
