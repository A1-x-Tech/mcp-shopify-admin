# Shopify Admin: Cancel an order — MCP tool

**MCP tool for Shopify:** Irreversibly cancels an order and requires explicit decisions about refunding the customer and restocking the items.

Technical name: `cancel_order`

## What problem it solves

> I want to cancel a Shopify order.

Use it when the cancellation decision is final and the refund and restock consequences are known.

## When to use it

Use it only after reviewing the order and deciding the required `refund` and `restock` booleans. The operation changes real Shopify data.

## What to provide

- `orderId` — required order id.
- `reason` — required `CUSTOMER`, `DECLINED`, `FRAUD`, `INVENTORY`, `STAFF`, or `OTHER`.
- `refund` — required boolean: whether to refund the payment.
- `restock` — required boolean: whether to return items to inventory.
- `notifyCustomer` — optional customer notification.
- `staffNote` — optional internal note.

## What it returns

Shopify returns a background `job`, not necessarily the final order state. The result also carries GraphQL cost data; check the outcome with `get_order`.

## What changes in Shopify

The order is cancelled. Depending on the explicit booleans, Shopify may refund the customer and/or restock the items. Cancellation cannot be undone by this tool.

## Example request

> Show me the consequences of cancelling order 8123456789, then cancel it with no refund and no restock after I confirm.

## Errors and limitations

The tool requires `read_orders` and old orders may require `read_all_orders`. Fulfilled orders can be rejected by Shopify. Partial refunds are not implemented here. Shopify reports mutation failures through `userErrors`; the server turns them into errors even though the HTTP status may be 200.

## Related MCP tools

- [Get an order](./get-order.md) — `get_order`
- [List orders](./list-orders.md) — `list_orders`

## Technical details

- **Impact:** destructive operation
- **Group:** Orders
- **Source:** `registerTool("cancel_order")` in `src/tools/orders.ts`
- [All capabilities](./index.md)
