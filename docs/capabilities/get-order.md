# Shopify Admin: Get an order — MCP tool

**MCP tool for Shopify:** Returns one order with line items, totals, shipping address, notes, tags, and fulfillments with tracking numbers.

Technical name: `get_order`

## What problem it solves

> I want to inspect one Shopify order.

Use it when the order number is known and you need the full record before making a decision.

## When to use it

Use it after finding the order with `list_orders`, before cancellation, or when reviewing fulfillment and refund details.

## What to provide

- `id` — required order id as a number or `gid://shopify/Order/<id>`. The human number such as `#1001` must first be resolved with `list_orders` and `query: "name:#1001"`.

## What it returns

Up to 100 line items, totals, shipping and refund amounts, shipping address, note, tags, fulfillments, and tracking numbers, plus GraphQL cost data.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> Show the complete Shopify order with id 8123456789, including items, refunds, and tracking.

## Errors and limitations

The id must identify an Order. A missing order is `data: null`. Scope: `read_orders`; old orders may additionally require `read_all_orders`.

## Related MCP tools

- [List orders](./list-orders.md) — `list_orders`
- [Cancel an order](./cancel-order.md) — `cancel_order`
- [Get a customer](./get-customer.md) — `get_customer`

## Technical details

- **Impact:** read-only
- **Group:** Orders
- **Source:** `registerTool("get_order")` in `src/tools/orders.ts`
- [All capabilities](./index.md)
