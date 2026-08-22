# Shopify Admin: Update a product — MCP tool

**MCP tool for Shopify:** Replaces the product fields supplied in the request and leaves other fields untouched.

Technical name: `update_product`

## What problem it solves

> I want to change the details of a Shopify product.

Use it for title, description, vendor, product type, tags, or status changes without touching prices or inventory.

## When to use it

Use it after finding the product id and deciding exactly which fields should change. The operation updates real Shopify data.

## What to provide

- `id` — required product id as a number or Product gid.
- Optional `title`, `descriptionHtml`, `vendor`, `productType`, `tags`, and `status`.
- At least one field besides `id` must be supplied.

## What it returns

The updated product and the GraphQL cost state.

## What changes in Shopify

Only the fields included in the request are replaced. `tags` replaces the entire tag list. Prices and inventory are not changed.

## Example request

> Change product 8123456789 to the title “Winter mug” and replace its tags with “winter” and “gift”.

## Errors and limitations

Use `update_variant` for prices and `set_inventory` for inventory. `DRAFT` marks a product as a draft and `ARCHIVED` archives it. Shopify mutation failures are surfaced from `userErrors`. Scope: `write_products`.

## Related MCP tools

- [Get a product](./get-product.md) — `get_product`
- [Update variant prices](./update-variant.md) — `update_variant`
- [Set inventory](./set-inventory.md) — `set_inventory`

## Technical details

- **Impact:** changes data
- **Group:** Products
- **Source:** `registerTool("update_product")` in `src/tools/products.ts`
- [All capabilities](./index.md)
