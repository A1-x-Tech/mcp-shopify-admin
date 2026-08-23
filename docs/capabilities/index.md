# Shopify Admin capabilities

This catalog contains 16 public pages — one for every registered MCP tool in `mcp-shopify-admin`. Each page starts with the user's task, explains the result, and states whether the call changes real Shopify data.

The server is bound to one store through `SHOPIFY_STORE_DOMAIN`; every result carries the GraphQL cost-bucket state. Authentication takes either path: `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` of a Dev Dashboard app, which the server exchanges for a 24-hour token and re-mints on its own, or a ready-made `SHOPIFY_ACCESS_TOKEN` used as-is.

## Shop

- [Shop data](./get-shop.md) — Returns the store, domains, currency, plan, timezone, product count, and locations. **Impact:** read-only.

## Products

- [List products](./list-products.md) — Returns a cursor-paginated product page with inventory and variant prices. **Impact:** read-only.
- [Get a product](./get-product.md) — Returns one product with options and up to 100 variants, prices, inventory, SKU, barcode, and inventory item ids. **Impact:** read-only.
- [Create a product](./create-product.md) — Creates a product with Shopify's default variant; it is not published to sales channels. **Impact:** changes data.
- [Update a product](./update-product.md) — Replaces the supplied product fields without touching the others. **Impact:** changes data.
- [Update variant prices](./update-variant.md) — Sets price and/or compare-at price for up to 250 variants of one product. **Impact:** changes data.

## Orders

- [List orders](./list-orders.md) — Returns newest-first orders with Shopify search filtering; orders older than 60 days require `read_all_orders`. **Impact:** read-only.
- [Get an order](./get-order.md) — Returns line items, totals, addresses, notes, tags, and fulfillments with tracking numbers. **Impact:** read-only.
- [Cancel an order](./cancel-order.md) — Irreversibly cancels an order; refund and restock decisions are required. **Impact:** destructive operation.

## Customers

- [List customers](./list-customers.md) — Returns a filtered customer page with contacts, order count, amount spent, and city. **Impact:** read-only.
- [Get a customer](./get-customer.md) — Returns contacts, addresses, notes, tags, and 10 latest orders. **Impact:** read-only.

## Inventory

- [List locations](./list-locations.md) — Returns active and inactive store locations. **Impact:** read-only.
- [Set inventory](./set-inventory.md) — Sets the absolute available inventory quantity at locations. **Impact:** changes data.

## Discounts

- [List discounts](./list-discounts.md) — Returns automatic and code discounts with status, dates, limits, and usage data. **Impact:** read-only.
- [Create a basic discount](./create-basic-discount.md) — Creates one basic code discount for all customers and products. **Impact:** changes data.

## Technical access

- [Arbitrary GraphQL request](./graphql-request.md) — Runs an arbitrary Admin GraphQL document for capabilities without a dedicated tool. **Impact:** destructive operation.

## For developers and publishers

- [Capability documentation contract](../CAPABILITY-DOCUMENTATION.md)
- [Technical tool reference](../TOOLS.md)
- [GitHub repository](https://github.com/A1-x-Tech/mcp-shopify-admin)
