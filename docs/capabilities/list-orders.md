# Shopify Admin: List orders — MCP tool

**MCP tool for Shopify:** Returns newest-first orders with statuses, totals, customers, and Shopify search filtering.

Technical name: `list_orders`

## What problem it solves

> I want to find orders in Shopify.

Use it to review recent orders, filter by payment or fulfillment state, and find the id for a later order read or cancellation check.

## When to use it

Use it for order monitoring initiated by an AI request. It never changes an order.

## What to provide

- `first` — optional page size, 1..250; default 20.
- `after` — optional cursor from the previous page.
- `query` — optional Shopify search string such as `financial_status:paid`, `fulfillment_status:unfulfilled`, or `created_at:>=2026-08-01`.

## What it returns

A page of orders with number, date, financial status, fulfillment status, total, customer, `count`, `hasNextPage`, `endCursor`, and GraphQL cost data.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> Show unpaid and unfulfilled orders created since August 1, 2026.

## Errors and limitations

Pagination is cursor-based. Orders older than 60 days require `read_all_orders` in addition to `read_orders`; without it they are not returned. `count` follows the same filter and is not necessarily the store-wide total.

## Related MCP tools

- [Get an order](./get-order.md) — `get_order`
- [Cancel an order](./cancel-order.md) — `cancel_order`

## Technical details

- **Impact:** read-only
- **Group:** Orders
- **Source:** `registerTool("list_orders")` in `src/tools/orders.ts`
- [All capabilities](./index.md)
