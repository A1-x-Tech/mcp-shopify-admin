import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { harness } from "./harness.js";
import { registerInventoryTools } from "./inventory.js";

function make(opts: { throwOn?: string } = {}) {
  return harness(registerInventoryTools as never, {
    listLocations: { count: null, items: [{ id: "gid://shopify/Location/1" }], hasNextPage: false, endCursor: null },
    setInventoryQuantities: { inventoryAdjustmentGroup: { reason: "correction", changes: [] } },
  }, opts);
}

test("registers the two inventory tools", () => {
  const { tools } = make();
  assert.deepEqual(Object.keys(tools).sort(), ["list_locations", "set_inventory"]);
});

test("listing locations is read-only; setting quantities is an idempotent write", () => {
  const { configs } = make();
  assert.equal(configs.list_locations.annotations?.readOnlyHint, true);
  // "Set to N" lands on the same state when repeated — WRITE, not CREATE.
  assert.deepEqual(configs.set_inventory.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
});

test("set_inventory is described as absolute, and names where both ids come from", () => {
  const { configs } = make();
  assert.match(configs.set_inventory.description ?? "", /АБСОЛЮТНЫЙ/);
  assert.match(configs.set_inventory.description ?? "", /get_product/);
  assert.match(configs.set_inventory.description ?? "", /list_locations/);
});

test("the schema rejects an empty list, negative and fractional quantities, unknown reasons", () => {
  const { configs } = make();
  const schema = z.object(configs.set_inventory.inputSchema ?? {});
  const item = { inventoryItemId: "1", locationId: "2", quantity: 5 };
  assert.equal(schema.safeParse({ quantities: [item] }).success, true);
  assert.equal(schema.safeParse({ quantities: [item], reason: "restock" }).success, true);
  assert.equal(schema.safeParse({ quantities: [] }).success, false);
  assert.equal(schema.safeParse({ quantities: [{ ...item, quantity: -1 }] }).success, false);
  assert.equal(schema.safeParse({ quantities: [{ ...item, quantity: 1.5 }] }).success, false);
  assert.equal(schema.safeParse({ quantities: [item], reason: "because" }).success, false);
});

test("set_inventory forwards quantities and reason as one params object", async () => {
  const { calls, tools } = make();
  await tools.set_inventory({ quantities: [{ inventoryItemId: "1", locationId: "2", quantity: 0 }], reason: "damaged" });
  assert.deepEqual(calls[0].params, [
    { quantities: [{ inventoryItemId: "1", locationId: "2", quantity: 0 }], reason: "damaged" },
  ]);
});

test("a client rejection is returned as an isError result, not thrown", async () => {
  const { tools } = make({ throwOn: "setInventoryQuantities" });
  const res = await tools.set_inventory({ quantities: [{ inventoryItemId: "1", locationId: "2", quantity: 1 }] });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /setInventoryQuantities отклонён/);
});
