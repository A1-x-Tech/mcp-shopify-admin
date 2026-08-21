import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { COST, harness } from "./harness.js";
import { registerRawTool } from "./raw.js";

function make(opts: { throwOn?: string } = {}) {
  return harness(registerRawTool as never, { request: { shop: { name: "Test" } } }, opts);
}

test("registers the one escape hatch", () => {
  const { tools } = make();
  assert.deepEqual(Object.keys(tools), ["graphql_request"]);
});

test("graphql_request is destructive — nothing stops the document being a mutation", () => {
  const { configs } = make();
  assert.deepEqual(configs.graphql_request.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
});

test("the description warns that userErrors come back uninterpreted", () => {
  const { configs } = make();
  assert.match(configs.graphql_request.description ?? "", /userErrors/);
  assert.match(configs.graphql_request.description ?? "", /HTTP 200/);
});

test("the schema requires a document and takes variables as an object", () => {
  const { configs } = make();
  const schema = z.object(configs.graphql_request.inputSchema ?? {});
  assert.equal(schema.safeParse({ query: "query { shop { name } }" }).success, true);
  assert.equal(schema.safeParse({ query: "{ shop { name } }", variables: { a: 1 } }).success, true);
  assert.equal(schema.safeParse({ query: "" }).success, false);
  assert.equal(schema.safeParse({ variables: {} }).success, false);
});

test("the document and variables reach the client verbatim, envelope comes back", async () => {
  const { calls, tools } = make();
  const res = await tools.graphql_request({ query: "query ($id: ID!) { node(id: $id) { id } }", variables: { id: "1" } });
  assert.deepEqual(calls[0].params, ["query ($id: ID!) { node(id: $id) { id } }", { id: "1" }, undefined]);
  assert.deepEqual(JSON.parse(res.content[0].text), { data: { shop: { name: "Test" } }, cost: COST });
});

test("operationName is offered and forwarded — a multi-operation document needs it", async () => {
  const { calls, configs, tools } = make();
  const schema = z.object(configs.graphql_request.inputSchema ?? {});
  assert.equal(schema.safeParse({ query: "query A { x } query B { y }", operationName: "B" }).success, true);
  assert.equal(schema.safeParse({ query: "query A { x }", operationName: "" }).success, false);
  await tools.graphql_request({ query: "query A { x } query B { y }", operationName: "B" });
  assert.equal(calls[0].params[2], "B");
});

test("a client rejection is returned as an isError result, not thrown", async () => {
  const { tools } = make({ throwOn: "request" });
  const res = await tools.graphql_request({ query: "{ shop { name } }" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /request отклонён/);
});
