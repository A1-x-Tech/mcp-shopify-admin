# Shopify Admin: Update variant prices — MCP tool

**MCP tool for Shopify:** Sets the price and/or compare-at price for up to 250 variants belonging to one product.

Technical name: `update_variant`

## What problem it solves

> I want to change prices for product variants.

Use it for price updates after obtaining the parent product id and variant ids from a product read.

## When to use it

Use it when the new prices are known and you want to update one or more variants in one call. The operation changes real Shopify data.

## What to provide

- `productId` — required parent product id.
- `variants` — required list of 1..250 variants. Each item has `id`, optional decimal-string `price`, and optional `compareAtPrice`; `null` removes the compare-at price.

## What it returns

The updated variants and the GraphQL cost state.

## What changes in Shopify

The supplied price fields are replaced in Shopify. SKU, barcode, options, media, and inventory are not changed.

## Example request

> Set the price of variant 987654321 to 1999.00 and remove its compare-at price.

## Errors and limitations

Prices are decimal strings in the shop currency. The parent `productId` must match the variants. Use `graphql_request` for other variant fields. Shopify mutation failures are surfaced from `userErrors`. Scope: `write_products`.

## Related MCP tools

- [Get a product](./get-product.md) — `get_product`
- [List products](./list-products.md) — `list_products`
- [Update a product](./update-product.md) — `update_product`
- [Arbitrary GraphQL request](./graphql-request.md) — `graphql_request`

## Technical details

- **Impact:** changes data
- **Group:** Products
- **Source:** `registerTool("update_variant")` in `src/tools/products.ts`
- [All capabilities](./index.md)
