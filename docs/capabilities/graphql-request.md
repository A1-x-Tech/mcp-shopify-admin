# Shopify Admin: Arbitrary GraphQL request — MCP tool

**MCP tool for Shopify:** Sends an arbitrary GraphQL document to the Admin API for capabilities that do not have a dedicated tool.

Technical name: `graphql_request`

## What problem it solves

> I want to use a Shopify Admin API capability that has no dedicated MCP tool.

Use it for metafields, media, collections, webhooks, segments, bulk operations, targeted discounts, publication, and other GraphQL operations not covered by the focused tools.

## When to use it

Use it only when the document, variables, operation, required scopes, and possible data changes are understood. It is the broadest and most dangerous server capability.

## What to provide

- `query` — required GraphQL document.
- `variables` — optional variables object.
- `operationName` — optional unless the document has more than one operation.

## What it returns

The Shopify GraphQL payload as-is, together with the cost state. `userErrors` are not normalized; the caller must inspect them.

## What changes in Shopify

A query reads data, but a mutation can create, update, publish, cancel, or delete data depending on its document. The tool is marked destructive because the server cannot safely assume the document is read-only.

## Example request

> Run this reviewed GraphQL query to return the first five product ids and titles.

## Errors and limitations

The server supplies the configured store, token, and API version. It detects the operation kind by parsing the document, so fragments before a mutation are handled safely; an unparseable document is treated as a mutation and is not replayed after 5xx or network errors. `operationName` is required for multiple operations. Shopify rejects documents costing more than 1,000 points.

## Related MCP tools

- [Get a product](./get-product.md) — `get_product`
- [List discounts](./list-discounts.md) — `list_discounts`
- [All tools](../TOOLS.md)

## Technical details

- **Impact:** destructive operation
- **Group:** Technical access
- **Source:** `registerTool("graphql_request")` in `src/tools/raw.ts`
- [All capabilities](./index.md)
