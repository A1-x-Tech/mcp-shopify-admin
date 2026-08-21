import { test } from "node:test";
import assert from "node:assert/strict";

import { COST, harness } from "./harness.js";
import { registerShopTools } from "./shop.js";

const SHOP = { shop: { name: "Test Store", myshopifyDomain: "test.myshopify.com" }, productsCount: 7, locations: [] };

function make(opts: { throwOn?: string } = {}) {
  return harness(registerShopTools as never, { getShop: SHOP }, opts);
}

test("registers the one shop tool", () => {
  const { tools } = make();
  assert.deepEqual(Object.keys(tools), ["get_shop"]);
});

test("get_shop is read-only and takes no arguments — the store comes from config", () => {
  const { configs } = make();
  assert.deepEqual(configs.get_shop.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(configs.get_shop.inputSchema, {});
  assert.match(configs.get_shop.description ?? "", /SHOPIFY_STORE_DOMAIN/);
  assert.match(configs.get_shop.description ?? "", /cost/);
});

test("get_shop passes the envelope through as compact JSON", async () => {
  const { calls, tools } = make();
  const res = await tools.get_shop({});
  assert.equal(calls[0].method, "getShop");
  assert.deepEqual(JSON.parse(res.content[0].text), { data: SHOP, cost: COST });
});

test("a client rejection is returned as an isError result, not thrown", async () => {
  const { tools } = make({ throwOn: "getShop" });
  const res = await tools.get_shop({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /getShop отклонён/);
});
