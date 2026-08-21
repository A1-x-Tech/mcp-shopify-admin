import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ShopifyAdminError } from "../types.js";
import {
  CREATE,
  DESTRUCTIVE,
  fail,
  isoDateTime,
  moneyAmount,
  ok,
  pageSize,
  READ_ONLY,
  WRITE,
} from "./util.js";

/** The text of a result's first content block — content is a union the tests must narrow. */
function textOf(res: CallToolResult): string {
  return (res.content[0] as { text: string }).text;
}

test("ok wraps the envelope as compact JSON — the consumer is an LLM", () => {
  const res = ok({ data: { a: 1 }, cost: null });
  assert.deepEqual(res, { content: [{ type: "text", text: '{"data":{"a":1},"cost":null}' }] });
});

test("ok passes strings through and survives null", () => {
  assert.equal(textOf(ok("plain")), "plain");
  assert.equal(textOf(ok(null)), "null");
});

test("fail renders an Error with its cause", () => {
  const err = new Error("outer", { cause: new Error("inner") });
  const res = fail(err);
  assert.equal(res.isError, true);
  assert.equal(textOf(res), "Ошибка: outer (inner)");
});

test("fail appends the wait and the bucket state of a throttled failure", () => {
  const err = new ShopifyAdminError(200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }, undefined, {
    retryAfter: 5,
    kind: "rate_limit",
    cost: { actualQueryCost: null, currentlyAvailable: 100, maximumAvailable: 2000, restoreRate: 100 },
  });
  const text = textOf(fail(err));
  assert.match(text, /повтор через 5 с/);
  assert.match(text, /cost\.currentlyAvailable: 100/);
});

test("fail explains ACCESS_DENIED as a missing scope, not a bad token", () => {
  const err = new ShopifyAdminError(200, {
    errors: [{ message: "Access denied for orders field", extensions: { code: "ACCESS_DENIED" } }],
  });
  const text = textOf(fail(err));
  assert.match(text, /нет нужного access scope/);
  assert.match(text, /SHOPIFY_ACCESS_TOKEN/);
});

test("fail explains the auth-shaped statuses", () => {
  assert.match(textOf(fail(new ShopifyAdminError(401, ""))), /SHOPIFY_ACCESS_TOKEN/);
  assert.match(textOf(fail(new ShopifyAdminError(402, ""))), /заморожен/);
  assert.match(textOf(fail(new ShopifyAdminError(404, ""))), /SHOPIFY_STORE_DOMAIN/);
  assert.match(textOf(fail(new ShopifyAdminError(423, ""))), /заблокирован/);
});

test("the annotation presets always set all four hints", () => {
  for (const preset of [READ_ONLY, WRITE, CREATE, DESTRUCTIVE]) {
    assert.deepEqual(Object.keys(preset).sort(), [
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
      "readOnlyHint",
    ]);
  }
  assert.equal(READ_ONLY.readOnlyHint, true);
  assert.equal(WRITE.idempotentHint, true);
  assert.equal(CREATE.idempotentHint, false);
  assert.equal(DESTRUCTIVE.destructiveHint, true);
});

test("schema factories return a fresh instance per call — shared consts collapse into $ref", () => {
  assert.notEqual(pageSize(), pageSize());
  assert.notEqual(moneyAmount(), moneyAmount());
});

test("moneyAmount accepts decimal strings and rejects numbers-as-prose", () => {
  const schema = z.object({ amount: moneyAmount() });
  assert.equal(schema.safeParse({ amount: "10.00" }).success, true);
  assert.equal(schema.safeParse({ amount: "10" }).success, true);
  assert.equal(schema.safeParse({ amount: "10,00" }).success, false);
  assert.equal(schema.safeParse({ amount: "ten" }).success, false);
});

test("isoDateTime accepts timestamps with offsets and rejects bare dates", () => {
  const schema = z.object({ at: isoDateTime() });
  assert.equal(schema.safeParse({ at: "2026-09-01T00:00:00Z" }).success, true);
  assert.equal(schema.safeParse({ at: "2026-09-01T12:30+03:00" }).success, true);
  assert.equal(schema.safeParse({ at: "2026-09-01" }).success, false);
});
