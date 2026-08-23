# Development

## Requirements

- Node.js 20+ (the published package ships compiled `dist/`; `npx` needs no separate install).

## Commands

`CODE
npm install
npm run dev        # run from source with tsx watch
npm test           # unit tests + a dist smoke probe, no network
npm run typecheck  # type-check src + tests, no emit
npm run build      # clean dist/ and compile with tsc
npm run smoke      # live READ-ONLY calls: shop and one short products page
`

`npm test` runs two suites: `test:src` executes every `src/**/*.test.ts` through `tsx`, and `test:dist` rebuilds `dist/` and drives the compiled server over stdio. Both suites are offline.

## Local run

`CODE
npm run build
SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  SHOPIFY_CLIENT_ID=your_client_id SHOPIFY_CLIENT_SECRET=your_client_secret \
  node dist/index.js
# legacy path: a ready-made SHOPIFY_ACCESS_TOKEN=shpat_... instead of the pair
# optional: SHOPIFY_API_VERSION, SHOPIFY_TIMEOUT_MS, SHOPIFY_MAX_RETRIES, SHOPIFY_TOKEN_LEEWAY_SECONDS, SHOPIFY_API_BASE
`

With the client ID and secret the server runs the `client_credentials` grant itself against `https://{store}.myshopify.com/admin/oauth/access_token` on the first call. Shopify issues that token for 24 hours; it is cached in memory and never written to disk, re-minted `SHOPIFY_TOKEN_LEEWAY_SECONDS` (default 300) before it expires and once more when a request answers 401, and parallel tool calls share one exchange. The grant works only while the app and the store belong to the same Shopify organization — a mismatch answers `shop_not_permitted`, which no retry and no re-issued secret fixes.

A ready-made `SHOPIFY_ACCESS_TOKEN` is still accepted for stores holding an admin-created custom app from before 2026-01-01: it is sent as-is, never refreshed, and wins when both are set.

`npm run smoke` needs working credentials (the client ID and secret, or a ready-made token) and makes two reads — the shop and one short page of products — without mutations. Orders and customers are deliberately not touched because their scopes are often absent on a fresh app. Prefer a [Shopify development store](https://shopify.dev/docs/apps/build/dev-dashboard/stores/development-stores), or point `SHOPIFY_API_BASE` at a mock.

`SHOPIFY_API_BASE` replaces the whole GraphQL endpoint, and the grant URL is derived from that endpoint's origin. A mock driven with the client-credentials pair therefore has to serve both `POST /admin/oauth/access_token` (answering `access_token` and `expires_in`) and the GraphQL endpoint itself; a mock that only speaks GraphQL works with `SHOPIFY_ACCESS_TOKEN`.

## Tests

Unit tests mock `globalThis.fetch` for the client and use a fake client for tools. They cover retries, throttle math, GraphQL errors, mutation `userErrors`, configuration, annotations, and capability-documentation coverage. Put a `*.test.ts` next to the code it covers; `npm run typecheck && npm test` is the release gate and also runs from `prepublishOnly`.

Never point the suite or an ad-hoc mutation at a production store. Reads are cheap, but a mutation against real data is still a real mutation.

## The cost bucket while developing

The Admin API meters GraphQL by a cost bucket: every query has a cost, and `restoreRate` points return each second. Use `SHOPIFY_API_BASE` with a local mock when exercising failure paths. Client-side validation — gid shape, page bounds, the discount value XOR, quantity minimums, and mutation detection in `graphql_request` — rejects invalid calls before they spend API cost.

## Usage telemetry

The server sends anonymous events to `usage.gistrec.cloud` (`server_start` for a configured install, `unconfigured_start` for a server without credentials, `tool_call` with the tool name, and `startup_failed` with a machine-readable configuration reason) to count active installs and understand tool usage.

Events contain only technical fields: a random install id (`~/.config/mcp-shopify-admin/instance-id`), package version, AI application name and version from the MCP handshake, Node.js version, and OS. Credentials, store data, tool arguments, and prompts are never sent. Delivery is fire-and-forget with a two-second timeout and is silently skipped on errors. Opt out for every Ask Ads MCP server with `ASKADS_TELEMETRY=0`.
