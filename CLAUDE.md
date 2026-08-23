# CLAUDE.md — mcp-shopify-admin

MCP server for the **Shopify Admin API** (GraphQL — the store admin, *not* the Storefront API),
TypeScript over stdio. One endpoint
`https://{store}.myshopify.com/admin/api/{version}/graphql.json`; every request is signed with an
`X-Shopify-Access-Token`, and that token comes from one of two paths. `SHOPIFY_CLIENT_ID` +
`SHOPIFY_CLIENT_SECRET` of a Dev Dashboard app is the recommended one: the client runs the
`client_credentials` grant itself against
`https://{store}.myshopify.com/admin/oauth/access_token` and keeps the token (24 hours) fresh —
the only path open to a store set up today, since admin-created custom apps stopped being issuable
on 2026-01-01. A ready-made `SHOPIFY_ACCESS_TOKEN` is still accepted, used as-is and never
refreshed, for stores that already hold such a token; it wins when both are set. The store host
comes from `SHOPIFY_STORE_DOMAIN`, the version from `SHOPIFY_API_VERSION` (default pinned in
`config.ts`). The API is metered by a **GraphQL cost bucket** (per-query cost, `restoreRate`
points restored per second) reported in `extensions.cost` of every response.

## Commands

```bash
npm run dev        # run from source (tsx watch)
npm test           # unit tests + a dist smoke probe, no network
npm run typecheck  # types for src + tests
npm run build      # emit dist/
npm run smoke      # live READ-ONLY calls (needs the store domain + credentials)
```

## Architecture

- `src/config.ts` — env → config. Missing `SHOPIFY_STORE_DOMAIN` / credentials
  (empty string = absent) is NOT an error: the fields stay `undefined`, the server starts
  degraded and the client raises `CredentialsError` (lives in `types.ts`) at call time.
  `hasCredentials(config)` is satisfied by either auth path — a ready-made `SHOPIFY_ACCESS_TOKEN`
  or the `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` pair the client can mint one with — and
  `authMode(config)` names which one is in play (`token` / `client_credentials` / `none`) for the
  startup line and telemetry, since the two behave differently when a token goes stale.
  `ConfigError` (with a `reason` code) is reserved for malformed values —
  `invalid_store_domain` (only `*.myshopify.com` hosts: silently sending the token to a foreign
  host is how tokens leak; a bare handle or pasted URL normalizes cleanly), `invalid_api_version`
  and `invalid_api_base` (must parse as an http/https URL) — and is caught by
  `loadConfigOrDegraded` in `index.ts`, which keeps the message as `configProblem` on the degraded
  config. `describeTarget(config)` is the only shape of the target that may be printed: the store
  domain, else the endpoint reduced to origin + path, so nothing a URL may carry (a
  `user:password@`, a token in the path) reaches stderr. Optional `SHOPIFY_API_VERSION`,
  `SHOPIFY_TIMEOUT_MS`, `SHOPIFY_MAX_RETRIES`, `SHOPIFY_TOKEN_LEEWAY_SECONDS` (how early a minted
  token is replaced, default 300), `SHOPIFY_API_BASE` (full endpoint override; also
  satisfies `hasCredentials` without a domain, for mocks).
- `src/types.ts` — config, `CostInfo` (flattened `extensions.cost`),
  `ApiResponse<T> = {data, cost}`, `ConnectionPage<T>` (`{count, items, hasNextPage, endCursor}`),
  the enum tuples (`PRODUCT_STATUSES`, `ORDER_CANCEL_REASONS`, `INVENTORY_REASONS`, `GID_TYPES`)
  the tools build zod enums from, `ShopifyAdminError`, `MutationError`, `ValidationError`,
  `CredentialsError`.
- `src/client.ts` — the GraphQL documents (compact selections: the consumer is an LLM) and one
  transport. The **`--- Auth ---`** section owns the token: `authToken()` returns a ready-made
  `SHOPIFY_ACCESS_TOKEN` untouched, otherwise the cached minted one while it is still more than
  the leeway away from expiry, otherwise the in-flight mint — the promise is stored, so a burst of
  parallel tool calls shares one exchange and a failed mint is never cached. `fetchToken()` posts
  the `client_credentials` grant to `/admin/oauth/access_token` (derived from the endpoint's
  origin, which keeps a mock self-consistent) and caches `{value, expiresAt}` **in memory only,
  never on disk**; it never retries, because its characteristic failure —
  `shop_not_permitted`, the app and the store sitting in different Shopify organizations — is not
  transient (`tools/util.ts` turns it into exactly that hint). `forgetToken()` drops the cache so
  the next attempt mints afresh; `send()` fetches the token per attempt, since a long retry ladder
  can outlive one. `send()` first rejects a missing credential with `CredentialsError` (before retries
  and fetch — the message is the product: it names the variables and the needed restart, or, when
  `configProblem` is set, the malformed variable instead of the credentials), then POSTs with an
  AbortController timeout that also covers reading the body, retries with backoff, lifts
  `extensions.cost` into the envelope and turns GraphQL `errors` — and a 200 that carries no
  `data` object — into `ShopifyAdminError`. `request()` also forwards an optional `operationName`.
  `mutate()` additionally turns a non-empty `userErrors` into `MutationError` (with `errorsKey`
  for renames: `orderCancel` → `orderCancelUserErrors`) and drops the empty field from clean
  results. Also holds the pre-flight validators: `toGid` (builds gids, refuses cross-type ones),
  `isMutationDocument` (retry safety for `graphql_request`, over `firstOperationKind` — a walk
  that skips comments, strings and `(…)` to find the first *executable* operation past any
  fragment definitions; unparseable counts as a mutation), `throttleWaitSeconds` (bucket math),
  `normalizePageSize` (clamp into 1..250).
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
  vocabulary (`missing_store_domain`, `missing_credentials`, `invalid_store_domain`,
  `invalid_api_version`, `invalid_api_base`) — never a variable's name or value.

## Conventions (do not break)

- **Never exit because of configuration.** A server that dies before the MCP handshake leaves
  the user with a red cross and no reason — telemetry across this line of servers showed that
  state accounted for nearly every unconfigured install, and almost none of them recovered.
  Missing credentials are a survivable state: start, answer `initialize` (with the unconfigured
  prefix in `instructions`) and `tools/list`, and let every tool call fail with
  `CredentialsError` — its message names the variables to set and says to restart, because
  credentials come only from the environment (there are no login tools). A malformed value
  degrades the same way, but the call-time message then names **the variable that actually
  broke** (carried as `configProblem`) instead of the credential variables the operator
  usually set correctly. `config.test.ts`, `client.test.ts` and `test/dist-smoke.test.js` pin
  this.
- **Credential failures are not transport failures.** `CredentialsError` is thrown before the
  retry/backoff branch and fetch itself in the client's `send()`. Pinned by "fetch must not be
  called" assertions in `client.test.ts`.
- **A ready-made token is the operator's; a minted one is the client's.** `SHOPIFY_ACCESS_TOKEN`
  is sent as-is and is **never** re-minted — not even on a 401: the client has nothing to exchange
  and nothing would change, so the error must reach the operator, who is the only one who can
  replace that token. A token the client minted itself is different: a 401 means it was revoked or
  expired earlier than advertised, so it is dropped (`forgetToken()`) and re-minted **exactly
  once** per `send()` — it costs no retry attempt, and a second 401 falls through to the error
  instead of looping. When both credential sets are present the ready-made token wins, and the
  startup line says which mode is running, because "the token went stale" has a different fix in
  each.
- **The store is config, never an argument.** No tool takes a store or token; the endpoint is
  built once from the config, and `normalizeStoreDomain` refuses any host that is not
  `*.myshopify.com` — the token must never travel to a foreign host. `SHOPIFY_API_BASE` is
  validated the same way (an http/https URL, else `ConfigError`) and is **never echoed**: it
  reaches both stderr and the error text the model reads, so a secret pasted into that slot would
  be printed twice. The startup line prints `describeTarget(config)`, not the endpoint, and every
  config message names the accepted shape instead of the rejected value.
- **HTTP 200 is not success.** Shopify answers 200 for refused mutations (`userErrors`) and for
  GraphQL-level errors (`errors`). Every wrapped mutation goes through `mutate()`; only
  `graphql_request` returns `userErrors` uninterpreted, and its description says to check them.
  A 200 whose body is empty, truncated mid-stream or not GraphQL at all is an error too
  («Ответ Shopify не содержит объект data»), never a successful call with empty data — otherwise
  the agent reads "the shop has no products" where the answer simply never arrived.
- **Retries are asymmetric.** THROTTLED and HTTP 429 always repeat (the call was refused, not
  performed — the wait comes from the bucket math / `Retry-After`); 5xx and network errors
  repeat for queries only — a repeated mutation could apply twice. `graphql_request` derives
  retry safety from `isMutationDocument`, which decides the operation kind by **parsing** the
  document, not by reading its first keyword: fragment definitions may legally precede the
  operation they serve, so `fragment F on Product { … } mutation M { … }` is a mutation and must
  not be repeated. An unparseable document counts as a mutation.
- **Validate before spending cost.** Anything checkable offline (gid shape and type, page
  bounds, the discount percentage/amount XOR, quantity minimums, empty lists) is rejected
  client-side.
- **Surface `cost`.** Client methods return `{data, cost}` and tools pass that envelope straight
  to `ok`, so the agent always sees the bucket state. Say so in tool descriptions. Failures
  carry it too: `ShopifyAdminError` holds the cost block and the computed wait, and `fail()`
  appends both — plus the auth hints (401 = the credentials of whichever path is in use,
  `shop_not_permitted` = the app and the store are in different Shopify organizations,
  ACCESS_DENIED = a missing *scope*, 404 = the store host, 402/423 = the store's standing with
  Shopify).
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

- Not yet exercised against a live store. The documents themselves are no longer in doubt: the
  six shapes that Shopify renames most often — `productCreate(product:)`, `productUpdate`,
  `productVariantsBulkUpdate(productId:, variants:)`,
  `discountCodeBasicCreate(basicCodeDiscount:)`, the `inventorySetQuantities` input and
  `Order.fulfillments` as a plain list — were cross-checked against the 2026-01 reference and
  match it. What is still missing is a run against a real store: before the first release, run
  `npm run smoke` against a development store and walk one mutation of each shape (create_product
  → update_variant → set_inventory, create_basic_discount, cancel_order on a test order, a
  `graphql_request` mutation) — scopes, plan limits and real data are what a schema check cannot
  prove.
- `list_discounts` lists the fields of the six common discount shapes; an exotic type still
  returns its `__typename` and id, nothing more. Extend the fragments if a real store shows more.
- `ordersCount` / `customersCount` may be absent or capped on some plans; the page's `count`
  degrades to `null` by design, so nothing breaks — but do not promise exact totals in prose.
