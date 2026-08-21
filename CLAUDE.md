# CLAUDE.md — mcp-shopify-admin

MCP server for the **Shopify Admin API** (GraphQL — the store admin, *not* the Storefront API),
TypeScript over stdio. One endpoint
`https://{store}.myshopify.com/admin/api/{version}/graphql.json`; auth is a static
`X-Shopify-Access-Token` (the Admin API access token of a custom app — no OAuth exchange), the
store host from `SHOPIFY_STORE_DOMAIN`, the version from `SHOPIFY_API_VERSION` (default pinned in
`config.ts`). The API is metered by a **GraphQL cost bucket** (per-query cost, `restoreRate`
points restored per second) reported in `extensions.cost` of every response.

## Commands

```bash
npm run dev        # run from source (tsx watch)
npm test           # unit tests + a dist smoke probe, no network
npm run typecheck  # types for src + tests
npm run build      # emit dist/
npm run smoke      # live READ-ONLY calls (needs the two required env vars)
```

## Architecture

- `src/config.ts` — env → config. Missing `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ACCESS_TOKEN`
  (empty string = absent) is NOT an error: the fields stay `undefined`, the server starts
  degraded and the client raises `CredentialsError` (lives in `types.ts`) at call time.
  `ConfigError` (with a `reason` code) is reserved for malformed values —
  `invalid_store_domain` (only `*.myshopify.com` hosts: silently sending the token to a foreign
  host is how tokens leak; a bare handle or pasted URL normalizes cleanly) and
  `invalid_api_version` — and is caught by `loadConfigOrDegraded` in `index.ts`. Optional
  `SHOPIFY_API_VERSION`, `SHOPIFY_TIMEOUT_MS`, `SHOPIFY_MAX_RETRIES`, `SHOPIFY_API_BASE` (full
  endpoint override; also satisfies `hasCredentials` without a domain, for mocks).
- `src/types.ts` — config, `CostInfo` (flattened `extensions.cost`),
  `ApiResponse<T> = {data, cost}`, `ConnectionPage<T>` (`{count, items, hasNextPage, endCursor}`),
  the enum tuples (`PRODUCT_STATUSES`, `ORDER_CANCEL_REASONS`, `INVENTORY_REASONS`, `GID_TYPES`)
  the tools build zod enums from, `ShopifyAdminError`, `MutationError`, `ValidationError`,
  `CredentialsError`.
- `src/client.ts` — the GraphQL documents (compact selections: the consumer is an LLM) and one
  transport. `send()` first rejects a missing credential with `CredentialsError` (before retries
  and fetch — the message is the product: it names the variables and the needed restart), then
  POSTs with an AbortController timeout that also covers reading the body, retries with backoff,
  lifts `extensions.cost` into the envelope and turns GraphQL `errors` into `ShopifyAdminError`.
  `mutate()` additionally turns a non-empty `userErrors` into `MutationError` (with `errorsKey`
  for renames: `orderCancel` → `orderCancelUserErrors`) and drops the empty field from clean
  results. Also holds the pre-flight validators: `toGid` (builds gids, refuses cross-type ones),
  `isMutationDocument` (retry safety for `graphql_request`; unparseable counts as a mutation),
  `throttleWaitSeconds` (bucket math), `normalizePageSize` (clamp into 1..250).
- `src/tools/*.ts` — `shop`, `products`, `orders`, `customers`, `inventory`, `discounts`, `raw`;
  each exports one `register*Tools(server, client)`. `tools/util.ts` — `ok`/`fail`, the
  annotation presets and the shared zod schema **factories**. `tools/harness.ts` — the fake
  server/client pair the tool tests share (excluded from the build in tsconfig.json).
- `src/index.ts` — wires every `register*` into the McpServer. `loadConfigOrDegraded()` catches
  `ConfigError`, pings `startup_failed` (fire-and-forget) and degrades the config to
  "no credentials" with no endpoint at all; an unconfigured start prepends `UNCONFIGURED_PREFIX`
  — plus `Проблема конфигурации: <message>` when a ConfigError was caught — to the initialize
  `instructions`, and `oninitialized` sends `server_start` for a configured install or
  `unconfigured_start` (with the reason) otherwise.
- `src/telemetry.ts` — anonymous usage pings (ids/names/versions only, never data or arguments;
  fire-and-forget, must never block or throw; opt-out `ASKADS_TELEMETRY=0`). Reasons are a closed
  vocabulary (`missing_store_domain`, `missing_access_token`, `invalid_store_domain`,
  `invalid_api_version`) — never a variable's name or value.

## Conventions (do not break)

- **Never exit because of configuration.** A server that dies before the MCP handshake leaves
  the user with a red cross and no reason — telemetry across this line of servers showed that
  state accounted for nearly every unconfigured install, and almost none of them recovered.
  Missing credentials are a survivable state: start, answer `initialize` (with the unconfigured
  prefix in `instructions`) and `tools/list`, and let every tool call fail with
  `CredentialsError` — its message names the variables to set and says to restart, because
  credentials come only from the environment (there are no login tools). A malformed value
  degrades the same way. `config.test.ts`, `client.test.ts` and `test/dist-smoke.test.js` pin
  this.
- **Credential failures are not transport failures.** `CredentialsError` is thrown before the
  retry/backoff branch and fetch itself in the client's `send()`. Pinned by "fetch must not be
  called" assertions in `client.test.ts`.
- **The store is config, never an argument.** No tool takes a store or token; the endpoint is
  built once from the config, and `normalizeStoreDomain` refuses any host that is not
  `*.myshopify.com` — the token must never travel to a foreign host.
- **HTTP 200 is not success.** Shopify answers 200 for refused mutations (`userErrors`) and for
  GraphQL-level errors (`errors`). Every wrapped mutation goes through `mutate()`; only
  `graphql_request` returns `userErrors` uninterpreted, and its description says to check them.
- **Retries are asymmetric.** THROTTLED and HTTP 429 always repeat (the call was refused, not
  performed — the wait comes from the bucket math / `Retry-After`); 5xx and network errors
  repeat for queries only — a repeated mutation could apply twice. `graphql_request` derives
  retry safety from `isMutationDocument`, and an unparseable document counts as a mutation.
- **Validate before spending cost.** Anything checkable offline (gid shape and type, page
  bounds, the discount percentage/amount XOR, quantity minimums, empty lists) is rejected
  client-side.
- **Surface `cost`.** Client methods return `{data, cost}` and tools pass that envelope straight
  to `ok`, so the agent always sees the bucket state. Say so in tool descriptions. Failures
  carry it too: `ShopifyAdminError` holds the cost block and the computed wait, and `fail()`
  appends both — plus the auth hints (401 = token, ACCESS_DENIED = a missing *scope*, 404 = the
  store host, 402/423 = the store's standing with Shopify).
- **The API surface is narrow — say so in the descriptions.** No order creation or fulfillment,
  no customer writes (PII), no variant creation, no media, no targeted discounts; descriptions
  name `graphql_request` as the covered escape hatch so the model does not hunt for tools that
  do not exist.
- **Annotations:** `READ_ONLY` for reads, `WRITE` for idempotent overwrites (product fields,
  variant prices, absolute inventory), `CREATE` for non-idempotent creates (product, discount),
  `DESTRUCTIVE` for `cancel_order` and `graphql_request`. All four hints are always set.
- **Validate inputs with zod** in `inputSchema`, reusing the schema **factories** in `util.ts` (a
  fresh schema per field avoids `$ref` dedup in the generated JSON schema). zod stays on **v3**
  (`^3.25.0`).
- **Output compact JSON via `ok`** — the consumer is an LLM; pretty-printing burns tokens.
- **Ids are gids at the wire, numbers at the tool.** Tools accept both; `toGid` normalizes and
  refuses a gid of another type (an Order gid in a Product tool is a mixed-up argument, and the
  API's NOT_FOUND would misdirect the caller). A missing entity is `data: null`, not an error.
- **The API version is pinned, not floating.** The GraphQL documents in `client.ts` are written
  against `DEFAULT_API_VERSION` in `config.ts`; bump it deliberately and re-check the documents
  against the changelog (mutations get renamed: `productVariantUpdate` →
  `productVariantsBulkUpdate` is why `update_variant` takes the parent product id).

## Adding a tool

Before changing the tool registry, read [the MCP capability documentation contract](docs/CAPABILITY-DOCUMENTATION.md). Every registered tool must have exactly one task-oriented page in `docs/capabilities/`; update that page, the index, and the coverage test in the same change.

1. Add (or extend) `src/tools/<name>.ts` with `register<Name>Tools(server, client)`.
2. If it hits a new operation, add the GraphQL document and a method to `src/client.ts`
   (mutations go through `mutate()`, mind the `errorsKey` renames).
3. Import and call the register fn in `src/index.ts`.
4. Add a `*.test.ts` using `tools/harness.ts` (tools) / the scripted fetch (client) — no network.
5. Update `docs/TOOLS.md` and the inventory in `test/dist-smoke.test.js`.
6. `npm run typecheck && npm test`.

## Known gaps

- Not yet exercised against a live store: the tool surface was written against the Admin API
  docs and the pinned version's schema, but no end-to-end run has happened. Before the first
  release, run `npm run smoke` against a development store and walk one mutation of each shape
  (create_product → update_variant → set_inventory, create_basic_discount, cancel_order on a
  test order, a `graphql_request` mutation) — Shopify renames mutation fields between versions,
  and only a live call proves the documents.
- `list_discounts` lists the fields of the six common discount shapes; an exotic type still
  returns its `__typename` and id, nothing more. Extend the fragments if a real store shows more.
- `ordersCount` / `customersCount` may be absent or capped on some plans; the page's `count`
  degrades to `null` by design, so nothing breaks — but do not promise exact totals in prose.
