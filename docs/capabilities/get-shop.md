# Shopify Admin: Shop data — MCP tool

**MCP tool for Shopify:** Returns the shop identity and operating context that other tools use: name, domains, currency, plan, timezone, product count, and locations.

Technical name: `get_shop`

## What problem it solves

> I want to see my Shopify store details.

It gives the assistant a reliable starting point for understanding which store the server is connected to and which locations are available.

## When to use it

Use it before inventory work, when checking the active connection, or whenever you need shop metadata without opening the Shopify admin manually. The operation runs only when the AI application calls it.

## What to provide

No arguments.

## What it returns

The shop name, `myshopifyDomain`, storefront domain, currency, plan, contact email, timezone, `productsCount`, and up to 10 locations. The response also carries the GraphQL cost state: `actualQueryCost`, `currentlyAvailable`, `maximumAvailable`, and `restoreRate`.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> Show the Shopify store details and its locations.

## Errors and limitations

The store is fixed by `SHOPIFY_STORE_DOMAIN`; this tool cannot select another store. `ACCESS_DENIED` means the token is missing a scope, not that the token is necessarily invalid — with client credentials the added scope is picked up at the next token exchange, while a ready-made token has to be replaced by hand. The tool needs only working credentials — `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` of a Dev Dashboard app, which the server exchanges for a token itself, or a ready-made `SHOPIFY_ACCESS_TOKEN` — and the scopes required by the fields Shopify returns. A 401 means those credentials were rejected; `shop_not_permitted` means the app and the store belong to different Shopify organizations, which the `client_credentials` grant does not cross.

## Related MCP tools

- [List locations](./list-locations.md) — `list_locations`
- [List products](./list-products.md) — `list_products`

## Technical details

- **Impact:** read-only
- **Group:** Shop
- **Source:** `registerTool("get_shop")` in `src/tools/shop.ts`
- [All capabilities](./index.md)
