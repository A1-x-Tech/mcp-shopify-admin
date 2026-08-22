# Shopify Admin: List discounts — MCP tool

**MCP tool for Shopify:** Returns automatic and code discounts with their types, status, dates, limits, codes, and usage counts.

Technical name: `list_discounts`

## What problem it solves

> I want to review the discounts in Shopify.

Use it to audit active and inactive promotions or find an existing code before creating another one.

## When to use it

Use it for discount reviews and planning. It never creates, updates, or disables a discount.

## What to provide

- Optional `first` page size and `after` cursor.
- Optional Shopify `query` string.

## What it returns

Discount type, title, status, active period, usage limit, and for code discounts up to five codes and usage counts. The page also includes cursor data and the GraphQL cost state.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> List active and scheduled discounts with their codes, dates, and usage limits.

## Errors and limitations

The page is cursor-paginated. Common discount shapes are expanded; an unfamiliar Shopify discount type may return only its typename and id. Scope: `read_discounts`.

## Related MCP tools

- [Create a basic discount](./create-basic-discount.md) — `create_basic_discount`
- [Arbitrary GraphQL request](./graphql-request.md) — `graphql_request`

## Technical details

- **Impact:** read-only
- **Group:** Discounts
- **Source:** `registerTool("list_discounts")` in `src/tools/discounts.ts`
- [All capabilities](./index.md)
