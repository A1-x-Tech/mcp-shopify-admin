import { test } from "node:test";
import assert from "node:assert/strict";

import { COST, harness } from "./harness.js";
import { registerCustomerTools } from "./customers.js";

const PAGE = { count: 2, items: [{ id: "gid://shopify/Customer/1" }], hasNextPage: false, endCursor: null };

function make(opts: { throwOn?: string } = {}) {
  return harness(registerCustomerTools as never, {
    listCustomers: PAGE,
    getCustomer: { id: "gid://shopify/Customer/1", displayName: "Ivan" },
  }, opts);
}

test("registers exactly the two read-only customer tools — PII stays read-only here", () => {
  const { configs, tools } = make();
  assert.deepEqual(Object.keys(tools).sort(), ["get_customer", "list_customers"]);
  for (const name of Object.keys(tools)) {
    assert.equal(configs[name].annotations?.readOnlyHint, true, name);
  }
});

test("list_customers forwards the cursor triple and passes the page through", async () => {
  const { calls, tools } = make();
  const res = await tools.list_customers({ query: "email:ivan@example.com" });
  assert.deepEqual(calls[0].params, [{ first: undefined, after: undefined, query: "email:ivan@example.com" }]);
  assert.deepEqual(JSON.parse(res.content[0].text), { data: PAGE, cost: COST });
});

test("get_customer forwards the id verbatim — the client normalizes gids", async () => {
  const { calls, tools } = make();
  await tools.get_customer({ id: "123" });
  assert.deepEqual(calls[0].params, ["123"]);
});

test("a client rejection is returned as an isError result, not thrown", async () => {
  const { tools } = make({ throwOn: "getCustomer" });
  const res = await tools.get_customer({ id: "123" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /getCustomer отклонён/);
});
