import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { harness } from "./harness.js";
import { registerOrderTools } from "./orders.js";

function make(opts: { throwOn?: string } = {}) {
  return harness(registerOrderTools as never, {
    listOrders: { count: 1, items: [{ id: "gid://shopify/Order/1" }], hasNextPage: false, endCursor: null },
    getOrder: { id: "gid://shopify/Order/1", name: "#1001" },
    cancelOrder: { job: { id: "gid://shopify/Job/1", done: false } },
  }, opts);
}

test("registers the three order tools", () => {
  const { tools } = make();
  assert.deepEqual(Object.keys(tools).sort(), ["cancel_order", "get_order", "list_orders"]);
});

test("the readers are read-only; cancelling is destructive", () => {
  const { configs } = make();
  assert.equal(configs.list_orders.annotations?.readOnlyHint, true);
  assert.equal(configs.get_order.annotations?.readOnlyHint, true);
  assert.deepEqual(configs.cancel_order.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
});

test("cancel_order is described as irreversible with both money decisions required", () => {
  const { configs } = make();
  assert.match(configs.cancel_order.description ?? "", /НЕОБРАТИМО/);
  assert.match(configs.cancel_order.description ?? "", /refund/);
  assert.match(configs.cancel_order.description ?? "", /restock/);
});

test("the cancel schema requires refund and restock — no silent defaults on money", () => {
  const { configs } = make();
  const schema = z.object(configs.cancel_order.inputSchema ?? {});
  const base = { orderId: "1", reason: "CUSTOMER" };
  assert.equal(schema.safeParse({ ...base, refund: true, restock: false }).success, true);
  assert.equal(schema.safeParse({ ...base, refund: true }).success, false);
  assert.equal(schema.safeParse({ ...base, restock: true }).success, false);
  assert.equal(schema.safeParse({ ...base, refund: true, restock: true, reason: "BORED" }).success, false);
});

test("cancel_order forwards every decision to the client", async () => {
  const { calls, tools } = make();
  await tools.cancel_order({ orderId: "5", reason: "FRAUD", refund: false, restock: true, notifyCustomer: false });
  assert.deepEqual(calls[0].params, [
    { orderId: "5", reason: "FRAUD", refund: false, restock: true, notifyCustomer: false, staffNote: undefined },
  ]);
});

test("get_order explains that it takes an id, not the #1001 order name", () => {
  const { configs } = make();
  assert.match(configs.get_order.description ?? "", /#1001/);
});

test("a client rejection is returned as an isError result, not thrown", async () => {
  const { tools } = make({ throwOn: "cancelOrder" });
  const res = await tools.cancel_order({ orderId: "5", reason: "OTHER", refund: true, restock: true });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /cancelOrder отклонён/);
});
