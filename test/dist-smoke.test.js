/**
 * Built-artifact smoke test: everything here runs against `dist/`, not `src/`.
 *
 * It spawns the published entrypoint exactly as an MCP host would — `node
 * dist/index.js` over stdio, with credentials in the environment — completes
 * the handshake and lists the tools. That catches the failures a source test
 * structurally cannot: a missing `#!/usr/bin/env node`, a register* call left
 * out of index.ts, an import that only resolves under tsx, a tool whose zod
 * shape throws during JSON-schema conversion, or annotations dropped by the
 * build. No network call is made: the token is a static header sent per API
 * call, and listing tools makes none.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ENTRYPOINT = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/** Every tool the assembled server must expose, with the annotations it ships. */
const EXPECTED = {
  // shop.ts
  get_shop: "READ_ONLY",
  // products.ts
  list_products: "READ_ONLY",
  get_product: "READ_ONLY",
  create_product: "CREATE",
  update_product: "WRITE",
  update_variant: "WRITE",
  // orders.ts
  list_orders: "READ_ONLY",
  get_order: "READ_ONLY",
  cancel_order: "DESTRUCTIVE",
  // customers.ts
  list_customers: "READ_ONLY",
  get_customer: "READ_ONLY",
  // inventory.ts
  list_locations: "READ_ONLY",
  set_inventory: "WRITE",
  // discounts.ts
  list_discounts: "READ_ONLY",
  create_basic_discount: "CREATE",
  // raw.ts
  graphql_request: "DESTRUCTIVE",
};

/** The four hints behind each label above — mirrors src/tools/util.ts. */
const ANNOTATIONS = {
  READ_ONLY: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  WRITE: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  CREATE: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  DESTRUCTIVE: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};

/**
 * Handshakes with a freshly spawned dist server and returns its tool list.
 * The credentials are syntactically valid but fake — startup must not touch the
 * network, and if it ever did, these would fail instead of hitting a real store.
 */
async function listToolsFromDist() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRYPOINT],
    env: {
      PATH: process.env.PATH ?? "",
      SHOPIFY_STORE_DOMAIN: "test-store.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_test",
      // Never ping the telemetry endpoint from a test run.
      ASKADS_TELEMETRY: "0",
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "dist-smoke", version: "0" });
  await client.connect(transport);
  try {
    return {
      tools: (await client.listTools()).tools,
      serverVersion: client.getServerVersion(),
      instructions: client.getInstructions(),
    };
  } finally {
    await client.close();
  }
}

test("dist server handshakes over stdio and exposes the full tool set", async () => {
  const { tools, serverVersion } = await listToolsFromDist();

  assert.equal(serverVersion?.name, "mcp-shopify-admin");
  assert.match(serverVersion?.version ?? "", /^\d+\.\d+\.\d+/);

  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, Object.keys(EXPECTED).sort());
});

test("dist tools keep their annotations, descriptions and input schemas", async () => {
  const { tools } = await listToolsFromDist();

  for (const tool of tools) {
    const label = EXPECTED[tool.name];
    assert.ok(label, `unexpected tool ${tool.name}`);
    assert.deepEqual(
      {
        readOnlyHint: tool.annotations?.readOnlyHint,
        destructiveHint: tool.annotations?.destructiveHint,
        idempotentHint: tool.annotations?.idempotentHint,
        openWorldHint: tool.annotations?.openWorldHint,
      },
      ANNOTATIONS[label],
      `${tool.name} should ship the ${label} annotations`,
    );

    // A tool the model cannot understand is as good as missing.
    assert.ok((tool.description ?? "").length > 40, `${tool.name} needs a real description`);
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} needs an object input schema`);
    // $ref survives zod-to-json-schema dedup and some consumers do not resolve
    // it, rendering the field as `any`; util.ts's factories exist to avoid it.
    assert.equal(
      JSON.stringify(tool.inputSchema).includes('"$ref"'),
      false,
      `${tool.name} input schema must not contain $ref`,
    );
  }
});

test("dist server ships usable instructions in the initialize result", async () => {
  const { instructions } = await listToolsFromDist();

  // The one piece of prose the calling model gets before it picks a tool; an
  // empty one means the option was dropped somewhere between src and dist.
  assert.ok(instructions, "initialize must carry instructions");
  assert.ok(
    instructions.length > 300,
    `instructions look truncated (${instructions.length} chars)`,
  );
  // Cheap regression guard on the facts that cost the most to rediscover:
  // mutations fail inside HTTP 200, and calls burn a cost bucket.
  assert.match(instructions, /userErrors/);
  assert.match(instructions, /cost/);
});

/**
 * Handshakes with a dist server spawned over `env` and returns a connected
 * client. The caller closes it. Used by the degraded-start tests below, which
 * never provide credentials — offline: the CredentialsError fires before any
 * fetch, so no network is touched.
 */
async function connectToDist(env, name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRYPOINT],
    env: { PATH: process.env.PATH ?? "", ASKADS_TELEMETRY: "0", ...env },
    stderr: "ignore",
  });
  const client = new Client({ name, version: "0" });
  await client.connect(transport);
  return client;
}

/**
 * The degraded-start contract: without any credentials the server must still
 * start, list every tool, open the instructions with the fix, and answer a
 * tool call with the actionable error — never exit(1) before the handshake.
 */
test("dist server starts without credentials: handshake, tool list, actionable call error", async () => {
  const client = await connectToDist({}, "dist-smoke-unconfigured");
  try {
    // The model must read the fix before it picks a tool.
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /ещё не подключён/);
    assert.match(instructions, /SHOPIFY_STORE_DOMAIN/);
    assert.match(instructions, /перезапустить сервер/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), Object.keys(EXPECTED).sort());

    // A tool call fails with the exact message instead of killing the server.
    // A tool call fails with the exact message instead of killing the server.
    // Both authentication paths must be named: a store set up today can only
    // use the client credentials, so pointing only at the retired ready-made
    // token would send the operator somewhere they cannot go.
    const result = await client.callTool({ name: "get_shop", arguments: {} });
    assert.equal(result.isError, true);
    const text = result.content.map((c) => c.text ?? "").join(" ");
    assert.match(text, /Требуются SHOPIFY_STORE_DOMAIN/);
    assert.match(text, /SHOPIFY_CLIENT_ID/);
    assert.match(text, /SHOPIFY_CLIENT_SECRET/);
    assert.match(text, /SHOPIFY_ACCESS_TOKEN/);
    assert.match(text, /перезапустите сервер/);
  } finally {
    await client.close();
  }
});

/**
 * The client-credentials path must be usable end to end from the built
 * artifact, not just from src: the server has to reach the grant on the store
 * host, present the token it gets back, and never send the client secret to
 * the API. A tiny store stands in for Shopify — it serves both routes.
 */
test("dist server authenticates with client credentials and signs the call with the minted token", async () => {
  const { createServer } = await import("node:http");
  const seen = [];
  const store = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url.includes("/admin/oauth/access_token")) {
        const form = new URLSearchParams(raw);
        seen.push({ kind: "mint", grant: form.get("grant_type"), clientId: form.get("client_id") });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ access_token: "minted-by-dist", expires_in: 86399 }));
      }
      seen.push({ kind: "api", token: req.headers["x-shopify-access-token"], body: raw });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { shop: { name: "Dist Store" }, productsCount: { count: 2 }, locations: { nodes: [] } } }));
    });
  });
  await new Promise((resolve) => store.listen(0, "127.0.0.1", resolve));
  const port = store.address().port;

  const client = await connectToDist(
    {
      SHOPIFY_API_BASE: `http://127.0.0.1:${port}/graphql.json`,
      SHOPIFY_CLIENT_ID: "cid-dist",
      SHOPIFY_CLIENT_SECRET: "csecret-dist",
    },
    "dist-smoke-client-credentials",
  );
  try {
    const result = await client.callTool({ name: "get_shop", arguments: {} });
    assert.equal(result.isError, undefined, "the call must succeed on a minted token");
    const text = result.content.map((c) => c.text ?? "").join(" ");
    assert.match(text, /Dist Store/);

    const mints = seen.filter((s) => s.kind === "mint");
    const calls = seen.filter((s) => s.kind === "api");
    assert.equal(mints.length, 1, "exactly one exchange");
    assert.equal(mints[0].grant, "client_credentials");
    assert.equal(mints[0].clientId, "cid-dist");
    assert.equal(calls[0].token, "minted-by-dist", "the API is signed with what the grant returned");
    assert.equal(calls[0].body.includes("csecret-dist"), false, "the secret never travels to the API");
  } finally {
    await client.close();
    await new Promise((resolve) => store.close(resolve));
  }
});

test("dist server survives a malformed store domain and carries the problem into the instructions", async () => {
  const client = await connectToDist(
    {
      SHOPIFY_STORE_DOMAIN: "shop.example.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_test",
    },
    "dist-smoke-malformed",
  );
  try {
    // The malformed value degrades the config to "no credentials": the problem
    // itself is reported in the instructions, and a call answers with the
    // missing-variable message — the fix is the same either way: correct the
    // value and restart.
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /Проблема конфигурации: SHOPIFY_STORE_DOMAIN/);

    const result = await client.callTool({ name: "get_shop", arguments: {} });
    assert.equal(result.isError, true);
    const text = result.content.map((c) => c.text ?? "").join(" ");
    assert.match(text, /SHOPIFY_STORE_DOMAIN/);
  } finally {
    await client.close();
  }
});
