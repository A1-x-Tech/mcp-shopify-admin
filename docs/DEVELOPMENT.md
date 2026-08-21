# Development

## Requirements

- Node.js 20+ (the published package ships compiled `dist/`; `npx` needs no separate install).

## Commands

```bash
npm install
npm run dev        # run from source with tsx watch
npm test           # test:src (unit tests) + test:dist (build, then probe dist/index.js)
npm run typecheck  # type-check src + tests (no emit)
npm run build      # clean dist/ and compile with tsc
npm run smoke      # live READ-ONLY calls: the shop and one short page of products
```

`npm test` runs two suites: `test:src` executes every `src/**/*.test.ts` through `tsx`, and
`test:dist` rebuilds `dist/` and runs `test/dist-smoke.test.js`, which spawns the **built** server
over stdio and asserts the tool inventory and annotations that the README and `docs/TOOLS.md`
describe. Both are offline.

## Local run

```bash
npm run build
SHOPIFY_STORE_DOMAIN=my-store.myshopify.com SHOPIFY_ACCESS_TOKEN=shpat_... node dist/index.js
# optional: SHOPIFY_API_VERSION, SHOPIFY_TIMEOUT_MS, SHOPIFY_MAX_RETRIES, SHOPIFY_API_BASE
```

`npm run smoke` needs the same credentials and makes two reads — the shop and one short page of
products — and no mutations. Orders and customers are deliberately not touched: their scopes are
often absent on a fresh token, and the smoke proves the connection, not the widest grant. It
prints the remaining cost-bucket points after every step; the bucket refills at `restoreRate`
points per second, so a passing smoke costs nothing lasting. Prefer running it against a
[development store](https://shopify.dev/docs/api/development-stores), or point `SHOPIFY_API_BASE`
at a mock.

## Tests

Unit tests mock `globalThis.fetch` (client, retries, throttle math, userErrors contract) or drive
the tools against a fake client (`src/tools/harness.ts`), so the whole suite runs offline. Put a
`*.test.ts` next to the code it covers; `npm run typecheck && npm test` is the gate (also run by
`prepublishOnly`).

Never point the suite — or an ad-hoc script — at a production store: reads are cheap, but a
mutation test against real data is a real mutation.

## The cost bucket while developing

The Admin API meters by a **GraphQL cost bucket** (per-query cost, `restoreRate` points back per
second), not by request rate. When exercising the server by hand, use `SHOPIFY_API_BASE` with a
local mock (the override replaces the whole endpoint, so a mock that serves one `POST
/graphql.json` route is self-consistent) or a development store. Client-side validation — gid
shape and type, page bounds, the discount value XOR, quantity minimums, the mutation detection in
`graphql_request` — all rejects before the request, so those failure modes cost nothing.

## Usage telemetry

The server sends anonymous events to `usage.gistrec.cloud` (`server_start` when a client connects
to a configured install, `unconfigured_start` when a client connects to a server without
credentials, `tool_call` with the tool **name**, and `startup_failed` with a machine-readable
reason code when the configuration is malformed) so we can count active installs and see which
tools matter. An event carries only impersonal technical fields: a random install id
(`~/.config/mcp-shopify-admin/instance-id`), the package version, the AI application's name and
version from the MCP handshake, the Node.js version and the OS.

Credentials, store data, tool arguments and request contents are never sent (implementation:
`src/telemetry.ts`). Delivery is fire-and-forget with a 2 s timeout and is silently skipped on any
error. Opt out of telemetry for every Ask Ads MCP server at once: `ASKADS_TELEMETRY=0`.
