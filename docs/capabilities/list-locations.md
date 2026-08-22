# Shopify Admin: List locations — MCP tool

**MCP tool for Shopify:** Returns active and inactive Shopify locations with the ids and addresses needed for inventory work.

Technical name: `list_locations`

## What problem it solves

> I want to see the store locations where inventory can be managed.

Use it to find a location id before setting inventory or to understand the store's warehouse structure.

## When to use it

Use it before `set_inventory`, especially when a product can be stocked at more than one location.

## What to provide

- Optional `first` page size.

## What it returns

Location id, name, address, active state, and whether the location fulfills online orders, plus pagination and GraphQL cost data.

## What changes in Shopify

Nothing. This is a read-only request.

## Example request

> List all Shopify locations, including inactive ones.

## Errors and limitations

The location id is different from an inventory item id and a product or variant id. Scope: `read_locations`.

## Related MCP tools

- [Get shop data](./get-shop.md) — `get_shop`
- [Set inventory](./set-inventory.md) — `set_inventory`

## Technical details

- **Impact:** read-only
- **Group:** Inventory
- **Source:** `registerTool("list_locations")` in `src/tools/inventory.ts`
- [All capabilities](./index.md)
