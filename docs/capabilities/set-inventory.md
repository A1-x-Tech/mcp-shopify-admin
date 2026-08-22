# Shopify Admin: Set inventory — MCP tool

**MCP tool for Shopify:** Sets the absolute available inventory quantity for inventory items at locations: “become N,” not “change by N.”

Technical name: `set_inventory`

## What problem it solves

> I want to set the available stock for Shopify inventory items.

Use it after reading the product's `inventoryItem.id` and the target location id.

## When to use it

Use it for an inventory count correction or another intentional absolute stock update. The operation changes real Shopify data.

## What to provide

- `quantities` — required list of 1..250 items. Each item contains `inventoryItemId`, `locationId`, and an integer `quantity` >= 0.
- `reason` — optional Shopify inventory reason; default `correction`.

## What it returns

The result of setting the quantities and the GraphQL cost state.

## What changes in Shopify

The available quantity is set absolutely through `inventorySetQuantities`. A repeat with the same numbers leaves the same state, but there is no automatic rollback.

## Example request

> Set inventory item 123456 at location 987654 to an available quantity of 12.

## Errors and limitations

Get `inventoryItemId` from `get_product` — it is not the variant id. Get `locationId` from `list_locations`. Shopify can reject untracked items or items not connected to the location through `userErrors`. Scope: `write_inventory`.

## Related MCP tools

- [Get a product](./get-product.md) — `get_product`
- [List locations](./list-locations.md) — `list_locations`

## Technical details

- **Impact:** changes data
- **Group:** Inventory
- **Source:** `registerTool("set_inventory")` in `src/tools/inventory.ts`
- [All capabilities](./index.md)
