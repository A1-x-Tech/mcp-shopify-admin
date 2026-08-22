# Tools

Use the [capability catalog](./capabilities/index.md) to choose a tool by the user's task. This page is the technical reference for schemas, API behavior, and limits.

The server exposes 16 tools over the Shopify Admin GraphQL API:
`https://{store}.myshopify.com/admin/api/{version}/graphql.json`.

## Rules shared by all tools

- **The store is fixed.** Every request goes to `SHOPIFY_STORE_DOMAIN` and uses `SHOPIFY_ACCESS_TOKEN`. No tool accepts a store or token argument. Invalid configuration names the variable that failed; fix it and restart the server.
- **Results are `{data, cost}`.** The compact JSON envelope carries the GraphQL cost state from `extensions.cost`: `actualQueryCost`, `currentlyAvailable`, `maximumAvailable`, and `restoreRate`, or `null` when Shopify did not send cost data. Errors may carry the same state and a suggested retry wait.
- **Ids accept two forms.** Pass a numeric id such as `8123456789` or a full gid such as `gid://shopify/Product/8123456789`. The client normalizes numbers and rejects a gid of the wrong resource type before sending the request.
- **Pagination is cursor-based.** `first` is 1..250 and defaults to 20; `after` receives the previous page's `endCursor`. Shopify has no page numbers. Lists return `{count, items, hasNextPage, endCursor}`; `count` is under the same query filter, not the store total, and can be `null` where Shopify has no counter.
- **`query` is Shopify search syntax.** It is passed through as `field:value`, ranges such as `created_at:>=2026-01-01`, `AND`/`OR`, and `-` exclusions.
- **Mutations check `userErrors`.** Shopify can return HTTP 200 for both success and failure. Wrapped mutations turn `userErrors` into an error with `field: message`; `graphql_request` returns the payload as-is, so callers must inspect `userErrors`. A 200 response without a `data` object is also an error.
- **Retries are asymmetric.** `THROTTLED` and HTTP 429 are always retried using bucket math or `Retry-After`. 5xx and network errors are retried only for reads, because replaying a mutation could apply it twice.
- **Access is controlled by app scopes.** `ACCESS_DENIED` means the token is missing a scope, not that the token is invalid; 401 points to the token; a 404 at the API layer usually points to `SHOPIFY_STORE_DOMAIN`. A missing entity is `data: null`, not a transport error.

## Shop

### `get_shop` — read-only

No arguments. Returns the shop name, `myshopifyDomain`, storefront domain, currency, plan, contact email, timezone, `productsCount`, and up to 10 locations. Location ids are needed by `set_inventory`.

## Products

### `list_products` — read-only

`first?`, `after?`, `query?`. Returns product id, title, handle, status (`ACTIVE`/`DRAFT`/`ARCHIVED`), vendor, type, tags, `totalInventory`, and up to five variants with prices. `count` uses the same query. Scope: `read_products`.

### `get_product` — read-only

`id`. Returns `descriptionHtml`, options, and up to 100 variants with price, `compareAtPrice`, inventory quantity, SKU, barcode, and `inventoryItem.id` for `set_inventory`. Media and metafields require `graphql_request`.

### `create_product` — create

`title`, `descriptionHtml?`, `vendor?`, `productType?`, `tags?`, `status?`. Calls `productCreate`; Shopify adds a default variant. Set its price with `update_variant`. API-created products are not published to sales channels; publishing uses `publishablePublish` through `graphql_request`. The default status is `ACTIVE`, but that is not publication; `DRAFT` marks the product as a draft. Scope: `write_products`.

### `update_product` — write

`id` plus any of `title`, `descriptionHtml`, `vendor`, `productType`, `tags`, or `status`. Calls `productUpdate` and replaces only supplied fields. `tags` replaces the entire tag list; prices and inventory are untouched. Scope: `write_products`.

### `update_variant` — write

`productId`, `variants: [{id, price?, compareAtPrice?}]`, up to 250 variants. Calls `productVariantsBulkUpdate`. Prices are decimal strings in the shop currency; `compareAtPrice: null` removes the compare-at price. Other variant fields require `graphql_request`. Scope: `write_products`.

## Orders

Scope: `read_orders`. Orders older than 60 days additionally require `read_all_orders`; without it, Shopify does not return them.

### `list_orders` — read-only

`first?`, `after?`, `query?`. Returns newest-first orders with number, date, financial status, fulfillment status, total, and customer. `count` uses the same filter.

### `get_order` — read-only

`id` (an id, not a number such as `#1001`; find that number with `list_orders` and `query: "name:#1001"`). Returns up to 100 line items, totals, shipping and refund amounts, shipping address, note, tags, and fulfillments with tracking numbers.

### `cancel_order` — destructive

`orderId`, `reason` (`CUSTOMER`/`DECLINED`/`FRAUD`/`INVENTORY`/`STAFF`/`OTHER`), required boolean `refund`, required boolean `restock`, `notifyCustomer?`, and `staffNote?`. Calls `orderCancel`; cancellation is irreversible and runs as a background job. The response contains `job`; verify the outcome with `get_order`. Shopify rejects fulfilled orders through `userErrors`.

## Customers

Customer records are read-only in dedicated tools; writes require `graphql_request`. Scope: `read_customers`.

### `list_customers` — read-only

`first?`, `after?`, `query?`. Returns name, email, phone, order count, amount spent, city, and `count` under the same filter.

### `get_customer` — read-only

`id`. Returns contacts, addresses, note, tags, and the customer's 10 latest orders with totals.

## Inventory

### `list_locations` — read-only

`first?`. Returns active and inactive locations with id, name, address, and activity state. Scope: `read_locations`.

### `set_inventory` — write

`quantities: [{inventoryItemId, locationId, quantity}]`, up to 250 entries, plus `reason?` from Shopify's closed vocabulary (default: `correction`). Calls `inventorySetQuantities` with `name: "available"` and `ignoreCompareQuantity: true`: it sets the **absolute** available quantity — “become N,” not “change by N.” `inventoryItemId` comes from `get_product` and is not a variant id. Scope: `write_inventory`.

## Discounts

Scopes: `read_discounts` / `write_discounts`.

### `list_discounts` — read-only

`first?`, `after?`, `query?`. Returns code and automatic discounts with type (`__typename`), title, status, active period, usage limit, and up to five codes plus usage counts for code discounts.

### `create_basic_discount` — create

`title`, `code`, exactly one of `percentage` (0..1) or `amount` (a decimal string in the shop currency), `startsAt?` (immediate by default), `endsAt?`, `usageLimit?`, and `appliesOncePerCustomer?`. Calls `discountCodeBasicCreate`: one code for all customers and all products. Targeted discounts, BXGY, free shipping, and deactivation require `graphql_request`.

## Technical access

### `graphql_request` — destructive

`query` (a GraphQL document), `variables?`, and `operationName?`. Sends an arbitrary Admin API document for metafields, media, collections, webhooks, segments, bulk operations, and anything else without a dedicated tool. The server supplies the store, token, and API version. `operationName` is required when the document contains more than one operation.

It is marked destructive because the document may be a mutation. Mutations are never replayed after 5xx or network errors; `THROTTLED` is retried. Operation kind is detected by parsing the document rather than looking only at its first word, so fragments before a mutation are handled safely; an unparseable document is treated as a mutation. `userErrors` are returned unchanged and must be checked by the caller. Shopify rejects queries costing more than 1,000 points.
