# Shopify Admin: Create a product — MCP tool

**MCP tool for Shopify:** Creates a product with Shopify's default variant and returns the new record.

Technical name: `create_product`

## What problem it solves

> I want to create a product in Shopify.

Use it to add the basic product record before setting variant prices or completing other work through the GraphQL escape hatch.

## When to use it

Use it when the title and initial product fields are ready and you intentionally want to create a new Shopify object. Ask the AI client to show the fields before confirming if the values matter.

## What to provide

- `title` — required product title.
- `descriptionHtml` — optional HTML description.
- `vendor` — optional vendor or brand.
- `productType` — optional free-form product type.
- `tags` — optional tags.
- `status` — optional `ACTIVE`, `DRAFT`, or `ARCHIVED`; default `ACTIVE`.

## What it returns

The created product and Shopify's default variant. Use the returned variant id with `update_variant` to set a price. The response also carries GraphQL cost data.

## What changes in Shopify

A new product is created in the admin. API-created products are not published to any sales channel. Publishing requires `publishablePublish` through `graphql_request`. There is no automatic rollback.

## Example request

> Create a draft product called “Winter mug” with the description “A ceramic mug for cold mornings” and the tag “winter”.

## Errors and limitations

Creating the same request twice creates two products. The default status `ACTIVE` is not publication; use `DRAFT` for a draft. This tool does not create variants, media, inventory, or sales-channel publications. Scope: `write_products`. Shopify mutation failures arrive in `userErrors` and are surfaced as errors.

## Related MCP tools

- [Update a product](./update-product.md) — `update_product`
- [Update variant prices](./update-variant.md) — `update_variant`
- [Get a product](./get-product.md) — `get_product`

## Technical details

- **Impact:** changes data
- **Group:** Products
- **Source:** `registerTool("create_product")` in `src/tools/products.ts`
- [All capabilities](./index.md)
