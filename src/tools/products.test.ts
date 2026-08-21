import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { COST, harness } from "./harness.js";
import { registerProductTools } from "./products.js";

const PAGE = { count: 1, items: [{ id: "gid://shopify/Product/1" }], hasNextPage: false, endCursor: null };

function make(opts: { throwOn?: string } = {}) {
  return harness(registerProductTools as never, {
    listProducts: PAGE,
    getProduct: { id: "gid://shopify/Product/1", title: "T" },
    createProduct: { product: { id: "gid://shopify/Product/2" } },
    updateProduct: { product: { id: "gid://shopify/Product/1" } },
    updateVariants: { productVariants: [] },
  }, opts);
}

test("registers the five product tools", () => {
  const { tools } = make();
  assert.deepEqual(
    Object.keys(tools).sort(),
    ["create_product", "get_product", "list_products", "update_product", "update_variant"],
  );
});

test("readers are read-only, create is CREATE, updates are idempotent writes", () => {
  const { configs } = make();
  assert.equal(configs.list_products.annotations?.readOnlyHint, true);
  assert.equal(configs.get_product.annotations?.readOnlyHint, true);
  assert.deepEqual(configs.create_product.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
  for (const name of ["update_product", "update_variant"]) {
    assert.deepEqual(configs[name].annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    }, name);
  }
});

test("list_products forwards the cursor triple and passes the page through", async () => {
  const { calls, tools } = make();
  const res = await tools.list_products({ first: 50, after: "abc", query: "status:active" });
  assert.deepEqual(calls[0].params, [{ first: 50, after: "abc", query: "status:active" }]);
  assert.deepEqual(JSON.parse(res.content[0].text), { data: PAGE, cost: COST });
});

test("create_product is described as visible-by-default (ACTIVE unless DRAFT)", () => {
  const { configs } = make();
  assert.match(configs.create_product.description ?? "", /ACTIVE/);
  assert.match(configs.create_product.description ?? "", /DRAFT/);
});

test("create_product forwards every field and leaves omitted optionals undefined", async () => {
  const { calls, tools } = make();
  await tools.create_product({ title: "Tee", tags: ["a"], status: "DRAFT" });
  assert.deepEqual(calls[0].params, [
    { title: "Tee", descriptionHtml: undefined, vendor: undefined, productType: undefined, tags: ["a"], status: "DRAFT" },
  ]);
});

test("update_variant nests the variants under the parent product id", async () => {
  const { calls, tools } = make();
  await tools.update_variant({ productId: "1", variants: [{ id: "2", price: "10.00" }] });
  assert.deepEqual(calls[0].params, ["1", [{ id: "2", price: "10.00" }]]);
});

test("the update_variant schema takes decimal-string prices, nullable compareAtPrice", () => {
  const { configs } = make();
  const schema = z.object(configs.update_variant.inputSchema ?? {});
  assert.equal(schema.safeParse({ productId: "1", variants: [{ id: "2", price: "10.00" }] }).success, true);
  assert.equal(schema.safeParse({ productId: "1", variants: [{ id: "2", compareAtPrice: null }] }).success, true);
  assert.equal(schema.safeParse({ productId: "1", variants: [{ id: "2", price: 10 }] }).success, false);
  assert.equal(schema.safeParse({ productId: "1", variants: [] }).success, false);
});

test("the list schema rejects an out-of-range page size instead of guessing", () => {
  const { configs } = make();
  const schema = z.object(configs.list_products.inputSchema ?? {});
  assert.equal(schema.safeParse({ first: 250 }).success, true);
  assert.equal(schema.safeParse({ first: 251 }).success, false);
  assert.equal(schema.safeParse({ first: 0 }).success, false);
});

test("a client rejection is returned as an isError result, not thrown", async () => {
  const { tools } = make({ throwOn: "updateProduct" });
  const res = await tools.update_product({ id: "1", title: "X" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /updateProduct отклонён/);
});
