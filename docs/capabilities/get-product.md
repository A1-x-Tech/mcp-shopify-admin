# Shopify Admin: Get a product — MCP tool

**MCP tool for Shopify:** Returns one product with its description, options, variants, prices, inventory quantities, SKU, barcode, and inventory item ids.

Technical name: `get_product`

## What problem it solves

> I want to inspect one Shopify product in detail.

Use it when you need the exact product or variant ids required for price or inventory work.

## When to use it

Use it after finding a product with `list_products`, before changing variant prices or inventory, or when reviewing the complete product record.

## What to provide

- `id` — required product id as a number or `gid://shopify/Product/<id>`.

## What it returns

The product's `descriptionHtml`, options, and up to 100 variants. Each variant includes price, `compareAtPrice`, inventory quantity, SKU, barcode, and `inventoryItem.id`. Media and metafields require `graphql_request`. The response also carries GraphQL cost data.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> Show the complete product record for product 8123456789, including variant inventory and SKUs.

## Errors and limitations

The id must identify a Product; a gid for another resource type is rejected before the request. A missing product is returned as `data: null`, not as a fabricated empty product. Scope: `read_products`.

## Related MCP tools

- [List products](./list-products.md) — `list_products`
- [Update variant prices](./update-variant.md) — `update_variant`
- [Set inventory](./set-inventory.md) — `set_inventory`

## Technical details

- **Impact:** read-only
- **Group:** Products
- **Source:** `registerTool("get_product")` in `src/tools/products.ts`
- [All capabilities](./index.md)
