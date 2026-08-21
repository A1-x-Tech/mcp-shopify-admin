import { test } from "node:test";
import assert from "node:assert/strict";

import {
  backoffMs,
  DEFAULT_PAGE_SIZE,
  firstOperationKind,
  isMutationDocument,
  MAX_PAGE_SIZE,
  normalizePageSize,
  ShopifyAdminClient,
  throttleWaitSeconds,
  toGid,
} from "./client.js";
import type { ShopifyAdminConfig } from "./types.js";
import { CredentialsError, MutationError, ShopifyAdminError, ValidationError } from "./types.js";

const ENDPOINT = "https://my-store.myshopify.com/admin/api/2026-01/graphql.json";

function config(overrides: Partial<ShopifyAdminConfig> = {}): ShopifyAdminConfig {
  return {
    storeDomain: "my-store.myshopify.com",
    accessToken: "shpat_test",
    apiVersion: "2026-01",
    endpoint: ENDPOINT,
    // Fast retries so the backoff schedule does not slow the suite down.
    retryBaseMs: 1,
    ...overrides,
  };
}

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: { query: string; variables?: Record<string, unknown>; operationName?: string };
}

/** A queue-driven fetch: each call shifts the next scripted response. */
function scriptedFetch(responses: Array<Response | Error>, recorded: Recorded[] = []) {
  return (async (url: unknown, init?: RequestInit) => {
    recorded.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    const next = responses.shift();
    if (!next) throw new Error("scripted fetch exhausted");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
}

const COST = {
  requestedQueryCost: 12,
  actualQueryCost: 10,
  throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1500, restoreRate: 100 },
};

function gqlOk(data: unknown, extensions: unknown = { cost: COST }): Response {
  return new Response(JSON.stringify({ data, extensions }), { status: 200 });
}

function throttled(requestedQueryCost = 600, currentlyAvailable = 100, restoreRate = 100): Response {
  return new Response(
    JSON.stringify({
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: {
        cost: {
          requestedQueryCost,
          actualQueryCost: null,
          throttleStatus: { maximumAvailable: 2000, currentlyAvailable, restoreRate },
        },
      },
    }),
    { status: 200 },
  );
}

// --- Credentials: rejected before anything is fetched ---

test("a missing token is rejected before fetch, with the variable named", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(config({ accessToken: undefined }), scriptedFetch([], recorded));
  await assert.rejects(client.getShop(), (err: unknown) => {
    assert.ok(err instanceof CredentialsError);
    assert.match(err.message, /SHOPIFY_ACCESS_TOKEN/);
    assert.match(err.message, /перезапустите сервер/);
    return true;
  });
  assert.equal(recorded.length, 0, "fetch must not be called without credentials");
});

test("a missing domain (no endpoint) is rejected the same way", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config({ storeDomain: undefined, endpoint: undefined }),
    scriptedFetch([], recorded),
  );
  await assert.rejects(client.getShop(), (err: unknown) => {
    assert.ok(err instanceof CredentialsError);
    assert.match(err.message, /SHOPIFY_STORE_DOMAIN/);
    return true;
  });
  assert.equal(recorded.length, 0);
});

test("both missing fold into one combined message, so one restart fixes both", async () => {
  const client = new ShopifyAdminClient(
    config({ storeDomain: undefined, endpoint: undefined, accessToken: undefined }),
    scriptedFetch([]),
  );
  await assert.rejects(client.getShop(), (err: unknown) => {
    assert.ok(err instanceof CredentialsError);
    assert.match(err.message, /Требуются SHOPIFY_STORE_DOMAIN/);
    assert.match(err.message, /SHOPIFY_ACCESS_TOKEN/);
    return true;
  });
});

// --- Transport basics ---

test("a request carries the token, the user agent and the document", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config({ userAgent: "mcp-shopify-admin/9.9.9" }),
    scriptedFetch([gqlOk({ shop: { name: "Test" } })], recorded),
  );
  const res = await client.getShop();
  assert.equal(recorded[0].url, ENDPOINT);
  assert.equal(recorded[0].headers["X-Shopify-Access-Token"], "shpat_test");
  assert.equal(recorded[0].headers["User-Agent"], "mcp-shopify-admin/9.9.9");
  assert.match(recorded[0].body.query, /shop \{/);
  assert.deepEqual((res.data.shop as { name: string }).name, "Test");
});

test("the cost block is lifted into the envelope, and its absence becomes null", async () => {
  // An explicit `undefined` would trigger gqlOk's default — an empty
  // extensions object is how "no cost block" actually arrives.
  const client = new ShopifyAdminClient(config(), scriptedFetch([gqlOk({ shop: {} }), gqlOk({ shop: {} }, {})]));
  const withCost = await client.getShop();
  assert.deepEqual(withCost.cost, {
    actualQueryCost: 10,
    currentlyAvailable: 1500,
    maximumAvailable: 2000,
    restoreRate: 100,
  });
  const noCost = await client.getShop();
  assert.equal(noCost.cost, null);
});

// --- Retry asymmetry ---

test("THROTTLED retries even a mutation — the call was refused, not performed", async () => {
  const recorded: Recorded[] = [];
  // restoreRate 0 keeps the bucket math undefined, so the retry sleeps the
  // 1 ms test backoff instead of a real computed wait (that math has its own test).
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch(
      [throttled(60, 50, 0), gqlOk({ productCreate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } })],
      recorded,
    ),
  );
  const res = await client.createProduct({ title: "T" });
  assert.equal(recorded.length, 2, "the throttled mutation must be repeated");
  assert.deepEqual((res.data.product as { id: string }).id, "gid://shopify/Product/1");
});

test("a THROTTLED call that exhausts retries surfaces the wait and the bucket", async () => {
  // maxRetries: 0 — the point is the surfaced numbers, not the sleep before them.
  const client = new ShopifyAdminClient(
    config({ maxRetries: 0 }),
    scriptedFetch([throttled(600, 100, 100)]),
  );
  await assert.rejects(client.getShop(), (err: unknown) => {
    assert.ok(err instanceof ShopifyAdminError);
    assert.equal(err.kind, "rate_limit");
    assert.equal(err.code, "THROTTLED");
    // (600 - 100) / 100 points per second = 5 seconds.
    assert.equal(err.retryAfter, 5);
    assert.equal(err.cost?.currentlyAvailable, 100);
    return true;
  });
});

test("a 5xx repeats a query but never a mutation", async () => {
  const query = new ShopifyAdminClient(
    config(),
    scriptedFetch([new Response("upstream", { status: 502 }), gqlOk({ shop: { name: "ok" } })]),
  );
  const res = await query.getShop();
  assert.equal((res.data.shop as { name: string }).name, "ok");

  const recorded: Recorded[] = [];
  const mutation = new ShopifyAdminClient(
    config(),
    scriptedFetch([new Response("upstream", { status: 502 })], recorded),
  );
  await assert.rejects(mutation.createProduct({ title: "T" }), (err: unknown) => {
    assert.ok(err instanceof ShopifyAdminError);
    assert.equal(err.status, 502);
    return true;
  });
  assert.equal(recorded.length, 1, "a 5xx mutation must not be repeated — it may have committed");
});

test("a network error repeats a query but never a mutation", async () => {
  const query = new ShopifyAdminClient(
    config(),
    scriptedFetch([new Error("socket hang up"), gqlOk({ shop: {} })]),
  );
  await query.getShop();

  const recorded: Recorded[] = [];
  const mutation = new ShopifyAdminClient(config(), scriptedFetch([new Error("socket hang up")], recorded));
  await assert.rejects(mutation.createProduct({ title: "T" }), /socket hang up/);
  assert.equal(recorded.length, 1);
});

test("HTTP 429 repeats even a mutation, honoring Retry-After", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch(
      [
        new Response("slow down", { status: 429, headers: { "Retry-After": "0" } }),
        gqlOk({ productCreate: { product: { id: "gid://shopify/Product/2" }, userErrors: [] } }),
      ],
      recorded,
    ),
  );
  await client.createProduct({ title: "T" });
  assert.equal(recorded.length, 2);
});

test("maxRetries: 0 disables retries entirely", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config({ maxRetries: 0 }),
    scriptedFetch([new Response("upstream", { status: 503 })], recorded),
  );
  await assert.rejects(client.getShop());
  assert.equal(recorded.length, 1);
});

// --- GraphQL errors and userErrors ---

test("a non-throttled GraphQL error throws with its code, no retry", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch(
      [
        new Response(
          JSON.stringify({
            errors: [{ message: "Access denied for products", extensions: { code: "ACCESS_DENIED" } }],
          }),
          { status: 200 },
        ),
      ],
      recorded,
    ),
  );
  await assert.rejects(client.listProducts(), (err: unknown) => {
    assert.ok(err instanceof ShopifyAdminError);
    assert.equal(err.kind, "graphql");
    assert.equal(err.code, "ACCESS_DENIED");
    assert.match(err.message, /Access denied/);
    return true;
  });
  assert.equal(recorded.length, 1, "ACCESS_DENIED is not transient — no retry");
});

test("a mutation with userErrors throws MutationError instead of returning HTTP-200 'success'", async () => {
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch([
      gqlOk({
        productUpdate: {
          product: null,
          userErrors: [{ field: ["product", "title"], message: "Title can't be blank" }],
        },
      }),
    ]),
  );
  await assert.rejects(client.updateProduct({ id: "1", title: "" }), (err: unknown) => {
    assert.ok(err instanceof MutationError);
    assert.match(err.message, /productUpdate/);
    assert.match(err.message, /product\.title: Title can't be blank/);
    return true;
  });
});

test("orderCancel reads its renamed orderCancelUserErrors field", async () => {
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch([
      gqlOk({
        orderCancel: {
          job: null,
          orderCancelUserErrors: [{ field: null, message: "Order is fulfilled" }],
        },
      }),
    ]),
  );
  await assert.rejects(
    client.cancelOrder({ orderId: "5", reason: "CUSTOMER", refund: true, restock: true }),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.match(err.message, /Order is fulfilled/);
      return true;
    },
  );
});

test("a clean mutation drops the empty userErrors from the returned data", async () => {
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch([gqlOk({ productCreate: { product: { id: "gid://shopify/Product/3" }, userErrors: [] } })]),
  );
  const res = await client.createProduct({ title: "T" });
  assert.deepEqual(res.data, { product: { id: "gid://shopify/Product/3" } });
});

// --- Reshaping ---

test("listProducts reshapes the connection into count/items/hasNextPage/endCursor", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch(
      [
        gqlOk({
          productsCount: { count: 7 },
          products: {
            nodes: [{ id: "gid://shopify/Product/1" }],
            pageInfo: { hasNextPage: true, endCursor: "abc" },
          },
        }),
      ],
      recorded,
    ),
  );
  const res = await client.listProducts({ first: 999, query: "status:active" });
  assert.deepEqual(res.data, {
    count: 7,
    items: [{ id: "gid://shopify/Product/1" }],
    hasNextPage: true,
    endCursor: "abc",
  });
  // Out-of-range page sizes are clamped, not rejected: "999" means "as many as possible".
  assert.equal(recorded[0].body.variables?.first, MAX_PAGE_SIZE);
  assert.equal(recorded[0].body.variables?.query, "status:active");
});

test("a missing entity comes back as null data, not as an error", async () => {
  const client = new ShopifyAdminClient(config(), scriptedFetch([gqlOk({ product: null })]));
  const res = await client.getProduct("42");
  assert.equal(res.data, null);
});

// --- Offline validation: no request is sent for input the API would refuse ---

test("gid arguments are normalized and cross-type gids are refused before fetch", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(config(), scriptedFetch([gqlOk({ product: null })], recorded));
  await client.getProduct("gid://shopify/Product/77");
  assert.equal(recorded[0].body.variables?.id, "gid://shopify/Product/77");

  await assert.rejects(client.getProduct("gid://shopify/Order/77"), ValidationError);
  await assert.rejects(client.getProduct("not-an-id"), ValidationError);
  assert.equal(recorded.length, 1, "a rejected id must not reach the network");
});

test("createBasicDiscountCode requires exactly one of percentage and amount", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(config(), scriptedFetch([], recorded));
  await assert.rejects(client.createBasicDiscountCode({ title: "t", code: "C" }), ValidationError);
  await assert.rejects(
    client.createBasicDiscountCode({ title: "t", code: "C", percentage: 0.2, amount: "10.00" }),
    ValidationError,
  );
  assert.equal(recorded.length, 0);
});

test("setInventoryQuantities refuses an empty list and negative quantities before fetch", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(config(), scriptedFetch([], recorded));
  await assert.rejects(client.setInventoryQuantities({ quantities: [] }), ValidationError);
  await assert.rejects(
    client.setInventoryQuantities({
      quantities: [{ inventoryItemId: "1", locationId: "2", quantity: -1 }],
    }),
    ValidationError,
  );
  assert.equal(recorded.length, 0);
});

test("setInventoryQuantities sends the absolute-set contract: available, no compare check", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch([gqlOk({ inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [] } })], recorded),
  );
  await client.setInventoryQuantities({
    quantities: [{ inventoryItemId: "11", locationId: "22", quantity: 5 }],
  });
  const input = recorded[0].body.variables?.input as Record<string, unknown>;
  assert.equal(input.name, "available");
  assert.equal(input.reason, "correction");
  assert.equal(input.ignoreCompareQuantity, true);
  assert.deepEqual(input.quantities, [
    { inventoryItemId: "gid://shopify/InventoryItem/11", locationId: "gid://shopify/Location/22", quantity: 5 },
  ]);
});

// --- Pure helpers ---

test("toGid builds, passes through and refuses", () => {
  assert.equal(toGid("Product", "123"), "gid://shopify/Product/123");
  assert.equal(toGid("Order", " gid://shopify/Order/9 "), "gid://shopify/Order/9");
  // Shopify sometimes appends params to gids; they are stripped, the id stays.
  assert.equal(toGid("ProductVariant", "gid://shopify/ProductVariant/5?inventory=1"), "gid://shopify/ProductVariant/5");
  assert.throws(() => toGid("Product", "gid://shopify/Order/1"), ValidationError);
  assert.throws(() => toGid("Product", "#1001"), ValidationError);
});

test("isMutationDocument reads the first operation, not vibes", () => {
  assert.equal(isMutationDocument("query { shop { name } }"), false);
  assert.equal(isMutationDocument("{ shop { name } }"), false);
  assert.equal(isMutationDocument("fragment F on Shop { name } query { shop { ...F } }"), false);
  assert.equal(isMutationDocument("mutation { productDelete(input: {id: \"1\"}) { deletedProductId } }"), true);
  assert.equal(isMutationDocument("# just a comment\nmutation M { shopPolicyUpdate { userErrors { message } } }"), true);
  // Unparseable documents count as mutations: never guess "safe to repeat".
  assert.equal(isMutationDocument(""), true);
  assert.equal(isMutationDocument("???"), true);
});

/**
 * Fragment definitions may legally precede the operation they serve. Reading
 * only the document's first keyword classified those as queries and let a
 * mutation into the 5xx retry loop — the double-write this asymmetry exists to
 * prevent. Every case here starts with something that is not the operation.
 */
test("a mutation is still a mutation behind fragments, comments and strings", () => {
  assert.equal(isMutationDocument("fragment PF on Product { id }\nmutation M { productCreate { product { ...PF } } }"), true);
  assert.equal(
    isMutationDocument("fragment A on P { id } fragment B on Q { id } mutation M { x { ...A ...B } }"),
    true,
    "several fragments in a row must not hide the mutation",
  );
  assert.equal(
    isMutationDocument('# leading comment with the word query in it\nfragment F on P { id }\nmutation M { x }'),
    true,
  );
  // A brace inside an argument list is not a selection set, so it must not be
  // mistaken for the fragment's body.
  assert.equal(isMutationDocument('fragment F on P @dir(if: {x: 1}) { id } mutation M { x { ...F } }'), true);
  assert.equal(isMutationDocument('mutation M($in: Input = {a: 1}) { x }'), true);
  // …and the same shapes on the query side stay retry-safe.
  assert.equal(isMutationDocument("fragment PF on Product { id }\nquery Q { product { ...PF } }"), false);
  assert.equal(isMutationDocument("fragment PF on Product { id }\n{ product { ...PF } }"), false);
});

test("firstOperationKind names the operation it found", () => {
  assert.equal(firstOperationKind("query Q { x }"), "query");
  assert.equal(firstOperationKind("{ x }"), "shorthand");
  assert.equal(firstOperationKind("fragment F on P { id } mutation M { x }"), "mutation");
  assert.equal(firstOperationKind("subscription S { x }"), "subscription");
  assert.equal(firstOperationKind("   "), "unknown");
});

test("a fragment-first mutation is NOT retried on 5xx", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch(
      [new Response("boom", { status: 502 }), new Response("boom", { status: 502 })],
      recorded,
    ),
  );
  await assert.rejects(
    client.request("fragment PF on Product { id }\nmutation M { productCreate { product { ...PF } } }"),
    (err: unknown) => err instanceof ShopifyAdminError && err.status === 502,
  );
  assert.equal(recorded.length, 1, "a mutation behind a fragment must not be repeated — it may have committed");
});

test("operationName is forwarded so a multi-operation document can pick one", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(config(), scriptedFetch([gqlOk({ shop: {} }), gqlOk({ shop: {} })], recorded));
  await client.request("query A { shop { name } } query B { shop { id } }", undefined, "B");
  assert.equal(recorded[0].body.operationName, "B");
  // Omitted, it must not appear in the body at all rather than ride as null.
  await client.request("query { shop { name } }");
  assert.equal("operationName" in recorded[1].body, false);
});

test("listCustomers filters its count the same way the page is filtered", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    config(),
    scriptedFetch([gqlOk({ customersCount: { count: 1 }, customers: { nodes: [] } })], recorded),
  );
  await client.listCustomers({ query: "email:ivan@example.com" });
  // Without the argument the count is the store-wide total, reported beside a
  // filtered page — a number the agent reads as "matches" and misreports.
  assert.match(recorded[0].body.query, /customersCount\(query: \$query\)/);
});

test("a 200 that is empty, truncated or not GraphQL is an error, not an empty success", async () => {
  for (const body of ["", '{"data":{"shop":{"na', '{"data":null}', "<html>502</html>", "[]"]) {
    const client = new ShopifyAdminClient(
      config({ maxRetries: 0 }),
      scriptedFetch([new Response(body, { status: 200 })]),
    );
    await assert.rejects(
      client.getShop(),
      (err: unknown) => {
        assert.ok(err instanceof ShopifyAdminError, `${JSON.stringify(body)} must not read as success`);
        assert.match(err.message, /не содержит объект data/);
        return true;
      },
      `body ${JSON.stringify(body)}`,
    );
  }
});

test("a degraded config reports the variable that actually broke, not the credentials", async () => {
  const recorded: Recorded[] = [];
  const client = new ShopifyAdminClient(
    // What index.ts hands over after catching a ConfigError: no endpoint, no
    // token, and the problem that caused it.
    { apiVersion: "2026-01", configProblem: 'SHOPIFY_API_VERSION должен быть квартальным релизом.' },
    scriptedFetch([], recorded),
  );
  await assert.rejects(client.getShop(), (err: unknown) => {
    assert.ok(err instanceof CredentialsError);
    assert.match(err.message, /SHOPIFY_API_VERSION/);
    assert.match(err.message, /перезапустите сервер/);
    // Naming the two credentials here sends the operator to fix what is already correct.
    assert.equal(/Требуются SHOPIFY_STORE_DOMAIN/.test(err.message), false);
    return true;
  });
  assert.equal(recorded.length, 0);
});

test("throttleWaitSeconds does the bucket math and degrades to undefined", () => {
  assert.equal(
    throttleWaitSeconds(600, { actualQueryCost: null, currentlyAvailable: 100, maximumAvailable: 2000, restoreRate: 100 }),
    5,
  );
  // Enough points already — the tiniest wait, not zero (the refusal was real).
  assert.equal(
    throttleWaitSeconds(50, { actualQueryCost: null, currentlyAvailable: 100, maximumAvailable: 2000, restoreRate: 100 }),
    1,
  );
  assert.equal(throttleWaitSeconds(undefined, null), undefined);
  assert.equal(
    throttleWaitSeconds(600, { actualQueryCost: null, currentlyAvailable: 0, maximumAvailable: 0, restoreRate: 0 }),
    undefined,
  );
});

test("backoffMs prefers the server's wait, capped, else exponential, capped", () => {
  assert.equal(backoffMs(0, 500), 500);
  assert.equal(backoffMs(3, 500), 4000);
  assert.equal(backoffMs(10, 500), 30_000);
  assert.equal(backoffMs(0, 500, 5), 5000);
  assert.equal(backoffMs(0, 500, 999), 30_000, "a hostile wait cannot park the process");
});

test("normalizePageSize clamps into Shopify's 1..250", () => {
  assert.equal(normalizePageSize(undefined), DEFAULT_PAGE_SIZE);
  assert.equal(normalizePageSize(0), 1);
  assert.equal(normalizePageSize(999), MAX_PAGE_SIZE);
  assert.equal(normalizePageSize(50.9), 50);
  assert.equal(normalizePageSize(Number.NaN), DEFAULT_PAGE_SIZE);
});

// --- Timeout ---

test("a hung response is aborted with a message naming the timeout", async () => {
  const hangingFetch = ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as typeof fetch;
  const client = new ShopifyAdminClient(config({ timeoutMs: 20, maxRetries: 0 }), hangingFetch);
  await assert.rejects(client.getShop(), /тайм-аут 20 мс/);
});
