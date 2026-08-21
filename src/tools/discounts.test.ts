import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { harness } from "./harness.js";
import { registerDiscountTools } from "./discounts.js";

function make(opts: { throwOn?: string } = {}) {
  return harness(registerDiscountTools as never, {
    listDiscounts: { count: null, items: [], hasNextPage: false, endCursor: null },
    createBasicDiscountCode: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" } },
  }, opts);
}

test("registers the two discount tools", () => {
  const { tools } = make();
  assert.deepEqual(Object.keys(tools).sort(), ["create_basic_discount", "list_discounts"]);
});

test("listing is read-only; creating a code is a non-idempotent create", () => {
  const { configs } = make();
  assert.equal(configs.list_discounts.annotations?.readOnlyHint, true);
  assert.deepEqual(configs.create_basic_discount.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
});

test("create_basic_discount is described as immediate-by-default and exactly-one-value", () => {
  const { configs } = make();
  assert.match(configs.create_basic_discount.description ?? "", /немедленно/);
  assert.match(configs.create_basic_discount.description ?? "", /ровно одно/i);
});

test("the schema bounds percentage to a 0..1 fraction and takes money as strings", () => {
  const { configs } = make();
  const schema = z.object(configs.create_basic_discount.inputSchema ?? {});
  const base = { title: "Sale", code: "SALE" };
  assert.equal(schema.safeParse({ ...base, percentage: 0.2 }).success, true);
  assert.equal(schema.safeParse({ ...base, amount: "500.00" }).success, true);
  // 20 reads as "20%" but means 2000% — the fraction bound catches the classic slip.
  assert.equal(schema.safeParse({ ...base, percentage: 20 }).success, false);
  assert.equal(schema.safeParse({ ...base, percentage: 0 }).success, false);
  assert.equal(schema.safeParse({ ...base, amount: 500 }).success, false);
  assert.equal(schema.safeParse({ ...base, endsAt: "2026-12-31" }).success, false);
});

test("create_basic_discount forwards the whole shape as one params object", async () => {
  const { calls, tools } = make();
  await tools.create_basic_discount({ title: "Sale", code: "SALE", percentage: 0.2, usageLimit: 100 });
  assert.deepEqual(calls[0].params, [
    {
      title: "Sale",
      code: "SALE",
      percentage: 0.2,
      amount: undefined,
      startsAt: undefined,
      endsAt: undefined,
      usageLimit: 100,
      appliesOncePerCustomer: undefined,
    },
  ]);
});

test("a client rejection (e.g. the XOR check) is returned as an isError result", async () => {
  const { tools } = make({ throwOn: "createBasicDiscountCode" });
  const res = await tools.create_basic_discount({ title: "Sale", code: "SALE", percentage: 0.2 });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /createBasicDiscountCode отклонён/);
});
