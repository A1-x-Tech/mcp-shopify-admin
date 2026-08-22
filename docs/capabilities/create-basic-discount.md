# Shopify Admin: Create a basic discount — MCP tool

**MCP tool for Shopify:** Creates one basic discount code for all customers and all products, using either a percentage or a fixed amount.

Technical name: `create_basic_discount`

## What problem it solves

> I want to create a basic discount code in Shopify.

Use it for a simple store-wide code when one code, one value, and one validity period are enough.

## When to use it

Use it only after checking the proposed code, value, dates, and limits. The operation creates real Shopify data.

## What to provide

- `title` — required internal discount title.
- `code` — required unique customer-facing code.
- Exactly one of optional `percentage` (0..1; `0.2` means 20%) or `amount` (decimal string in the shop currency).
- Optional `startsAt` (immediate by default), `endsAt`, `usageLimit`, and `appliesOncePerCustomer`.

## What it returns

The created discount and the GraphQL cost state.

## What changes in Shopify

A new code discount is created for all customers and products. There is no automatic rollback.

## Example request

> Prepare a 20% discount code SUMMER from September 1 through September 14, with a limit of 100 uses.

## Errors and limitations

Exactly one of `percentage` and `amount` is required. The code must be unique. Targeted discounts, BXGY, free shipping, and deactivation require `graphql_request`. Scope: `write_discounts`. Shopify mutation failures are surfaced from `userErrors`.

## Related MCP tools

- [List discounts](./list-discounts.md) — `list_discounts`
- [Arbitrary GraphQL request](./graphql-request.md) — `graphql_request`

## Technical details

- **Impact:** changes data
- **Group:** Discounts
- **Source:** `registerTool("create_basic_discount")` in `src/tools/discounts.ts`
- [All capabilities](./index.md)
