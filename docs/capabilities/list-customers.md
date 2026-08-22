# Shopify Admin: List customers — MCP tool

**MCP tool for Shopify:** Returns a filtered customer page with contact details, order count, amount spent, city, and cursor pagination.

Technical name: `list_customers`

## What problem it solves

> I want to find customers in Shopify.

Use it to search by email, phone, state, date, or another Shopify customer query without changing personal data.

## When to use it

Use it for customer support and order research when a read-only customer list is enough.

## What to provide

- `first` — optional page size, 1..250; default 20.
- `after` — optional cursor from the previous page.
- `query` — optional Shopify search string such as `email:ivan@example.com`, `phone:+79001234567`, or `state:enabled`.

## What it returns

Customer name, email, phone, order count, amount spent, city, `count`, cursor pagination fields, and GraphQL cost data.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> Find customers with the email ivan@example.com and show their order counts.

## Errors and limitations

Customer writes are not exposed by dedicated tools; use `graphql_request` only for an intentional, reviewed mutation. Scope: `read_customers`. The count follows the same filter and may be `null` when Shopify does not provide it.

## Related MCP tools

- [Get a customer](./get-customer.md) — `get_customer`
- [List orders](./list-orders.md) — `list_orders`

## Technical details

- **Impact:** read-only
- **Group:** Customers
- **Source:** `registerTool("list_customers")` in `src/tools/customers.ts`
- [All capabilities](./index.md)
