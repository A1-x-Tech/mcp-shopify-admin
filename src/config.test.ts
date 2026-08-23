import { test } from "node:test";
import assert from "node:assert/strict";

import {
  authMode,
  ConfigError,
  DEFAULT_API_VERSION,
  describeTarget,
  hasCredentials,
  loadConfig,
  normalizeStoreDomain,
} from "./config.js";

/**
 * The reason codes below (`invalid_*`) are the vocabulary the dashboard groups
 * by — renaming one silently splits a bar in two, so they are pinned here.
 */
const FULL = {
  SHOPIFY_STORE_DOMAIN: "my-store.myshopify.com",
  SHOPIFY_ACCESS_TOKEN: "shpat_0123456789abcdef",
};

function errorOf(env: Record<string, string | undefined>): ConfigError {
  let caught: unknown;
  try {
    loadConfig(env as NodeJS.ProcessEnv);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ConfigError, "config problems must throw ConfigError, not exit");
  return caught;
}

function reasonOf(env: Record<string, string | undefined>): string {
  return errorOf(env).reason;
}

/**
 * Missing credentials must never throw: the server starts degraded and the
 * client raises CredentialsError at call time instead (pinned in
 * client.test.ts). Reverting this would kill the process before the MCP
 * handshake and leave the user a dead server with no reason.
 */
test("a missing credential does not throw — the field stays undefined", () => {
  const noDomain = loadConfig({ ...FULL, SHOPIFY_STORE_DOMAIN: undefined } as NodeJS.ProcessEnv);
  assert.equal(noDomain.storeDomain, undefined);
  assert.equal(noDomain.endpoint, undefined, "no domain means no endpoint to hit");
  assert.equal(
    loadConfig({ ...FULL, SHOPIFY_ACCESS_TOKEN: undefined } as NodeJS.ProcessEnv).accessToken,
    undefined,
  );
});

test("an empty or blank value is treated as absent, not as an empty credential", () => {
  const config = loadConfig({
    SHOPIFY_STORE_DOMAIN: "   ",
    SHOPIFY_ACCESS_TOKEN: "",
  } as NodeJS.ProcessEnv);
  assert.equal(config.storeDomain, undefined);
  assert.equal(config.accessToken, undefined);
  assert.equal(hasCredentials(config), false);
});

test("with no variables at all the config loads with the pinned API version", () => {
  const config = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(hasCredentials(config), false);
  assert.equal(config.apiVersion, DEFAULT_API_VERSION);
});

test("normalizeStoreDomain collapses every accepted spelling to the myshopify host", () => {
  for (const spelling of [
    "my-store",
    "my-store.myshopify.com",
    "MY-STORE.MYSHOPIFY.COM",
    "https://my-store.myshopify.com",
    "https://my-store.myshopify.com/",
    "http://my-store.myshopify.com/admin?x=1",
  ]) {
    assert.equal(normalizeStoreDomain(spelling), "my-store.myshopify.com", spelling);
  }
});

test("a foreign host is rejected rather than silently sent the token", () => {
  // A custom storefront domain or the admin UI host resolves to servers that
  // must never see the access token.
  for (const bad of ["shop.example.com", "admin.shopify.com", "my-store.myshopify.com.evil.com", ".myshopify.com"]) {
    assert.equal(reasonOf({ ...FULL, SHOPIFY_STORE_DOMAIN: bad }), "invalid_store_domain", bad);
  }
});

test("an unknown API version is rejected rather than silently defaulted", () => {
  for (const bad of ["2026-02", "2026", "latest", "v1"]) {
    assert.equal(reasonOf({ ...FULL, SHOPIFY_API_VERSION: bad }), "invalid_api_version", bad);
  }
  assert.equal(
    loadConfig({ ...FULL, SHOPIFY_API_VERSION: "unstable" } as NodeJS.ProcessEnv).apiVersion,
    "unstable",
  );
});

test("a rejected value is never echoed into the message index.ts prints to stderr", () => {
  // The likeliest wrong paste is the access token in the wrong slot, and MCP
  // hosts capture server stderr to disk. Lowercase, so the domain branch
  // (which lowercases its input) would still leak it verbatim if the message
  // interpolated the value. With dots on purpose: a dotless value reads as a
  // bare store handle and normalizes cleanly instead of erroring.
  const secret = "shpat.secret-pasted.in-the-wrong.slot";
  for (const key of ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_API_VERSION"]) {
    const message = errorOf({ ...FULL, [key]: secret }).message;
    assert.equal(message.includes(secret), false, `${key} must not echo its value`);
    assert.match(message, new RegExp(key), `${key} must still name the variable`);
  }
});

test("a fully configured server derives the endpoint from domain and version", () => {
  const config = loadConfig(FULL as NodeJS.ProcessEnv);
  assert.equal(hasCredentials(config), true);
  assert.equal(config.storeDomain, "my-store.myshopify.com");
  assert.equal(config.accessToken, "shpat_0123456789abcdef");
  assert.equal(config.apiVersion, DEFAULT_API_VERSION);
  assert.equal(
    config.endpoint,
    `https://my-store.myshopify.com/admin/api/${DEFAULT_API_VERSION}/graphql.json`,
  );
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(config.maxRetries, 4);
});

test("a bare store name is enough — the host is completed for the endpoint too", () => {
  const config = loadConfig({ ...FULL, SHOPIFY_STORE_DOMAIN: "my-store" } as NodeJS.ProcessEnv);
  assert.equal(config.storeDomain, "my-store.myshopify.com");
  assert.match(config.endpoint ?? "", /^https:\/\/my-store\.myshopify\.com\//);
});

test("SHOPIFY_API_BASE overrides the whole endpoint and satisfies hasCredentials without a domain", () => {
  const config = loadConfig({
    SHOPIFY_ACCESS_TOKEN: "shpat_x",
    SHOPIFY_API_BASE: "http://localhost:9000/graphql.json",
  } as NodeJS.ProcessEnv);
  assert.equal(config.endpoint, "http://localhost:9000/graphql.json");
  assert.equal(hasCredentials(config), true, "a mock endpoint needs no store domain");
});

/**
 * The third slot used to be taken verbatim: a token pasted here became the
 * endpoint, satisfied hasCredentials, and was then printed to stderr on every
 * start and echoed inside the error text the model reads.
 */
test("SHOPIFY_API_BASE must be an http(s) URL, and its value is never echoed", () => {
  const secret = "shpat_pasted-in-the-wrong-slot";
  for (const bad of [secret, "localhost:9000", "ftp://example.com/graphql.json", "/admin/api/graphql.json"]) {
    assert.equal(reasonOf({ ...FULL, SHOPIFY_API_BASE: bad }), "invalid_api_base", bad);
  }
  const message = errorOf({ ...FULL, SHOPIFY_API_BASE: secret }).message;
  assert.equal(message.includes(secret), false, "the rejected endpoint must not be echoed");
  assert.match(message, /SHOPIFY_API_BASE/);
});

test("describeTarget never leaks credentials embedded in the endpoint", () => {
  // A URL may legally carry user:password@; this string reaches the host's log.
  const config = loadConfig({
    SHOPIFY_ACCESS_TOKEN: "shpat_x",
    SHOPIFY_API_BASE: "https://apiuser:s3cr3t@127.0.0.1:9000/graphql.json",
  } as NodeJS.ProcessEnv);
  const shown = describeTarget(config);
  assert.equal(shown.includes("s3cr3t"), false, "the password must not reach stderr");
  assert.equal(shown.includes("apiuser"), false);
  assert.equal(shown, "https://127.0.0.1:9000/graphql.json");
  // With a store domain configured it stays the friendly name.
  assert.equal(describeTarget(loadConfig(FULL as NodeJS.ProcessEnv)), "my-store.myshopify.com");
});

/**
 * Admin-created custom apps stopped being issuable on 2026-01-01, so a store
 * set up today has only the client_credentials path. Both must load, and a
 * ready-made token must keep winning for the stores that still hold one.
 */
test("client credentials are a complete set of credentials on their own", () => {
  const config = loadConfig({
    SHOPIFY_STORE_DOMAIN: "my-store.myshopify.com",
    SHOPIFY_CLIENT_ID: "cid",
    SHOPIFY_CLIENT_SECRET: "csecret",
  } as NodeJS.ProcessEnv);
  assert.equal(config.clientId, "cid");
  assert.equal(config.clientSecret, "csecret");
  assert.equal(config.accessToken, undefined);
  assert.equal(hasCredentials(config), true, "no ready-made token is needed");
  assert.equal(authMode(config), "client_credentials");
});

test("half the pair is not a credential set", () => {
  for (const half of [{ SHOPIFY_CLIENT_ID: "cid" }, { SHOPIFY_CLIENT_SECRET: "csecret" }]) {
    const config = loadConfig({ SHOPIFY_STORE_DOMAIN: "my-store.myshopify.com", ...half } as NodeJS.ProcessEnv);
    assert.equal(hasCredentials(config), false, JSON.stringify(half));
    assert.equal(authMode(config), "none");
  }
});

test("a ready-made token wins when both paths are configured", () => {
  const config = loadConfig({
    ...FULL,
    SHOPIFY_CLIENT_ID: "cid",
    SHOPIFY_CLIENT_SECRET: "csecret",
  } as NodeJS.ProcessEnv);
  assert.equal(authMode(config), "token");
  assert.equal(hasCredentials(config), true);
});

test("the token leeway defaults to 300 seconds and can be overridden, zero included", () => {
  assert.equal(loadConfig(FULL as NodeJS.ProcessEnv).tokenLeewaySeconds, 300);
  assert.equal(
    loadConfig({ ...FULL, SHOPIFY_TOKEN_LEEWAY_SECONDS: "0" } as NodeJS.ProcessEnv).tokenLeewaySeconds,
    0,
  );
  assert.equal(
    loadConfig({ ...FULL, SHOPIFY_TOKEN_LEEWAY_SECONDS: "soon" } as NodeJS.ProcessEnv).tokenLeewaySeconds,
    300,
  );
});

/**
 * A newline inside a token used to reach fetch, whose thrown message quotes the
 * offending value — putting the credential into the model's context and the
 * host's transcript. It is rejected here instead, and the message must name the
 * variable without ever showing it.
 */
test("a credential carrying a control character is refused, and never echoed", () => {
  const canary = "shpat_SECRETCANARY";
  for (const variable of ["SHOPIFY_ACCESS_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"]) {
    const env = { SHOPIFY_STORE_DOMAIN: "my-store.myshopify.com", [variable]: `${canary}\nX-Evil: 1` };
    assert.equal(reasonOf(env), "invalid_credential", variable);
    const message = errorOf(env).message;
    assert.equal(message.includes(canary), false, `${variable} must not echo its value`);
    assert.match(message, new RegExp(variable));
  }
});

test("a credential is trimmed, because a trailing newline is a paste artifact", () => {
  const config = loadConfig({
    SHOPIFY_STORE_DOMAIN: "my-store.myshopify.com",
    SHOPIFY_ACCESS_TOKEN: "  shpat_padded\n",
  } as NodeJS.ProcessEnv);
  assert.equal(config.accessToken, "shpat_padded");
  // Ordinary tokens keep working: the check is control characters only.
  assert.equal(
    loadConfig({ ...FULL, SHOPIFY_ACCESS_TOKEN: "shpat_0123456789abcdef" } as NodeJS.ProcessEnv).accessToken,
    "shpat_0123456789abcdef",
  );
});

test("numeric overrides are honored; zero disables retries", () => {
  const config = loadConfig({
    ...FULL,
    SHOPIFY_TIMEOUT_MS: "5000",
    SHOPIFY_MAX_RETRIES: "0",
  } as NodeJS.ProcessEnv);
  assert.equal(config.timeoutMs, 5000);
  assert.equal(config.maxRetries, 0);
});

test("garbage numeric overrides fall back to the defaults instead of NaN", () => {
  const config = loadConfig({
    ...FULL,
    SHOPIFY_TIMEOUT_MS: "soon",
    SHOPIFY_MAX_RETRIES: "-2",
  } as NodeJS.ProcessEnv);
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(config.maxRetries, 4);
});

test("loadConfig defaults to process.env", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, FULL);
    assert.equal(loadConfig().storeDomain, "my-store.myshopify.com");
  } finally {
    for (const key of Object.keys(FULL)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
