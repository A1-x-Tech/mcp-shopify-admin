# Shopify Admin: Get a customer — MCP tool

**MCP tool for Shopify:** Returns one customer's contacts, addresses, note, tags, and 10 latest orders with totals.

Technical name: `get_customer`

## What problem it solves

> I want to open a Shopify customer record.

Use it when customer id is known and a complete read-only customer view is needed.

## When to use it

Use it after finding the customer with `list_customers`, or when reviewing the customer's recent order history.

## What to provide

- `id` — required customer id as a number or `gid://shopify/Customer/<id>`.

## What it returns

Contacts, addresses, note, tags, and 10 latest orders with totals, plus GraphQL cost data.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> Open the customer with id 8123456789 and show their contact details and latest orders.

## Errors and limitations

A customer can be found by email with `list_customers` and a query such as `email:ivan@example.com`. A missing customer is `data: null`. Dedicated tools do not change customer records because they contain personal data. Scope: `read_customers`.

## Related MCP tools

- [List customers](./list-customers.md) — `list_customers`
- [Get an order](./get-order.md) — `get_order`

## Technical details

- **Impact:** read-only
- **Group:** Customers
- **Source:** `registerTool("get_customer")` in `src/tools/customers.ts`
- [All capabilities](./index.md)
