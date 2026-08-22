# Shopify Admin: List products — MCP tool

**MCP tool for Shopify:** Returns a cursor-paginated product page with status, tags, total inventory, and up to five variants with prices.

Technical name: `list_products`

## What problem it solves

> I want to find products in my Shopify store.

Use it to browse the catalog, filter products with Shopify search syntax, and find candidates for a later read or update.

## When to use it

Use it for catalog review, inventory checks, price audits, or when you need a product id before calling another tool. It reads the store only when requested.

## What to provide

- `first` — optional page size, 1..250; default 20.
- `after` — optional cursor from the previous response.
- `query` — optional Shopify search string, for example `status:active`, `vendor:Nike`, or `tag:sale`.

## What it returns

Each product includes id, title, handle, status, vendor, product type, tags, `totalInventory`, and up to five variants with prices. The page includes `count` under the same filter, `hasNextPage`, `endCursor`, and the GraphQL cost state.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> Find active products from Nike with their prices and inventory.

## Errors and limitations

Pagination is cursor-based; there are no page numbers. `first` up to 250 is usually more cost-efficient than many small pages. The result is limited to the fields listed here; media and metafields require `graphql_request`. Scope: `read_products`.

## Related MCP tools

- [Get a product](./get-product.md) — `get_product`
- [Create a product](./create-product.md) — `create_product`
- [Update a product](./update-product.md) — `update_product`
- [Update variant prices](./update-variant.md) — `update_variant`

## Technical details

- **Impact:** read-only
- **Group:** Products
- **Source:** `registerTool("list_products")` in `src/tools/products.ts`
- [All capabilities](./index.md)
