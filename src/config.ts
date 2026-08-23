import type { ShopifyAdminConfig } from "./types.js";

/**
 * Default Admin API version. Quarterly (`YYYY-01/04/07/10`), each supported
 * for 12 months; bump it with the dependency refresh, not ad-hoc — tool
 * queries are written against this version's schema.
 */
export const DEFAULT_API_VERSION = "2026-01";

/** Accepted shapes of SHOPIFY_API_VERSION: a quarterly release or `unstable`. */
const API_VERSION_RE = /^\d{4}-(01|04|07|10)$/;

/** The permanent Admin host every store keeps regardless of its storefront domain. */
const MYSHOPIFY_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * A malformed environment variable. Thrown instead of exiting on the spot so
 * index.ts can catch it, report the drop-off and start degraded instead of
 * dying; `reason` is the machine-readable code that ships with that ping
 * (never a variable's value). A *missing* credential is NOT a ConfigError —
 * see loadConfig.
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

function die(message: string, reason: string): never {
  throw new ConfigError(message, reason);
}

/** Reads a numeric env var that must be > 0, else returns the fallback. */
function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Same, but 0 is a meaningful value (no retries). */
function nonNegativeNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * True when everything a request needs is present: an endpoint to hit, and a
 * way to sign it — either a ready-made token or the client credentials the
 * client can mint one with.
 */
export function hasCredentials(config: ShopifyAdminConfig): boolean {
  return Boolean(config.endpoint && (config.accessToken || (config.clientId && config.clientSecret)));
}

/** Which authentication path this config uses, for logs and telemetry. */
export function authMode(config: ShopifyAdminConfig): "token" | "client_credentials" | "none" {
  if (config.accessToken) return "token";
  if (config.clientId && config.clientSecret) return "client_credentials";
  return "none";
}

/**
 * Where the server points, in a form that is safe to print. MCP hosts capture
 * stderr to disk, so this never returns anything that could carry a secret: the
 * store domain when there is one, otherwise the endpoint reduced to origin and
 * path — dropping any `user:password@` the URL may hold.
 */
export function describeTarget(config: ShopifyAdminConfig): string {
  if (config.storeDomain) return config.storeDomain;
  if (!config.endpoint) return "эндпоинт не задан";
  try {
    const url = new URL(config.endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "эндпоинт не задан";
  }
}

/**
 * Normalizes what users paste as "the store" into the permanent
 * `*.myshopify.com` host: a bare handle (`my-store`), the full host, or a URL
 * with scheme, path or trailing slash all collapse to `my-store.myshopify.com`.
 * Anything else — a storefront custom domain, an admin.shopify.com URL —
 * throws: the Admin API lives only on the myshopify.com host, and silently
 * sending the token to another host is how tokens leak.
 */
export function normalizeStoreDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/[/?#].*$/, "");
  // Bare handle: no dot means the user gave the store name alone.
  if (value && !value.includes(".")) value = `${value}.myshopify.com`;
  if (!MYSHOPIFY_RE.test(value)) {
    // The rejected value is never echoed back: this message lands on stderr,
    // which MCP hosts capture to disk, and the likeliest wrong paste is a
    // custom storefront domain — naming the accepted shape is what helps.
    die(
      "SHOPIFY_STORE_DOMAIN должен быть постоянным доменом магазина вида my-store.myshopify.com " +
        "(можно и просто my-store). Витринный домен и admin.shopify.com не подходят — Admin API " +
        "живёт только на myshopify.com.",
      "invalid_store_domain",
    );
  }
  return value;
}

/**
 * Builds the client config from environment variables. The variable names are
 * the ones the Shopify tooling ecosystem already uses, so a working set of
 * credentials is portable.
 *
 * Missing credentials are NOT an error here: the fields stay `undefined`, the
 * server starts anyway and the client raises CredentialsError per tool call
 * (see client.ts), so an unconfigured install completes the MCP handshake and
 * the model can tell the user which variable to set — instead of dying before
 * `initialize` and leaving a dead server with no reason. There is no in-chat
 * login: the fix is the operator setting the variables and restarting the
 * server. A *malformed* value (a foreign domain, an unknown API version)
 * still throws ConfigError, because guessing what the user meant is worse —
 * index.ts catches it and degrades instead of exiting.
 *
 * Authentication takes either path, and a ready-made token wins when both are
 * present. `SHOPIFY_ACCESS_TOKEN` is the legacy one: admin-created custom apps
 * stopped being issuable on 2026-01-01, so only stores that already hold such
 * a token can use it. A store set up today registers an app in the Dev
 * Dashboard and supplies `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`, which
 * the client exchanges for a token that lives 24 hours and re-mints as needed.
 *
 *   SHOPIFY_STORE_DOMAIN           my-store.myshopify.com (or the bare store name)
 *   SHOPIFY_ACCESS_TOKEN           ready-made Admin API access token (legacy apps)
 *   SHOPIFY_CLIENT_ID              client id of a Dev Dashboard app
 *   SHOPIFY_CLIENT_SECRET          client secret of that app
 *   SHOPIFY_API_VERSION            YYYY-MM quarterly release or unstable (default 2026-01)
 *   SHOPIFY_TIMEOUT_MS             per-request timeout (default 30000)
 *   SHOPIFY_MAX_RETRIES            retries for THROTTLED (always) and 5xx/network on reads (default 4)
 *   SHOPIFY_TOKEN_LEEWAY_SECONDS   re-mint a token this early (default 300)
 *   SHOPIFY_API_BASE               full GraphQL endpoint override, e.g. a local mock
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShopifyAdminConfig {
  // An empty string reads as absent, never as an empty credential.
  const accessToken = env.SHOPIFY_ACCESS_TOKEN || undefined;
  const clientId = env.SHOPIFY_CLIENT_ID || undefined;
  const clientSecret = env.SHOPIFY_CLIENT_SECRET || undefined;

  const domainRaw = (env.SHOPIFY_STORE_DOMAIN ?? "").trim();
  const storeDomain = domainRaw ? normalizeStoreDomain(domainRaw) : undefined;

  const versionRaw = (env.SHOPIFY_API_VERSION ?? "").trim().toLowerCase();
  if (versionRaw && versionRaw !== "unstable" && !API_VERSION_RE.test(versionRaw)) {
    // Same rule: the accepted vocabulary, not the rejected value.
    die(
      'SHOPIFY_API_VERSION должен быть квартальным релизом вида "2026-01" (месяцы 01/04/07/10) или "unstable".',
      "invalid_api_version",
    );
  }
  const apiVersion = versionRaw || DEFAULT_API_VERSION;

  // The override replaces the whole endpoint, version included, so a mock
  // server can be pointed at directly; otherwise the domain + version build it.
  //
  // It is validated rather than trusted: an unchecked value is taken verbatim
  // as the endpoint, satisfies hasCredentials and then reaches both the startup
  // line on stderr and the error text the model reads — so a secret pasted into
  // this slot would be printed twice. As everywhere here, the message describes
  // the accepted shape and never echoes what was rejected.
  const apiBaseRaw = (env.SHOPIFY_API_BASE ?? "").trim();
  let apiBase: string | undefined;
  if (apiBaseRaw) {
    const badApiBase =
      "SHOPIFY_API_BASE должен быть полным URL GraphQL-эндпоинта по схеме http или https, например " +
      "https://my-store.myshopify.com/admin/api/2026-01/graphql.json.";
    let parsed: URL;
    try {
      parsed = new URL(apiBaseRaw);
    } catch {
      die(badApiBase, "invalid_api_base");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") die(badApiBase, "invalid_api_base");
    apiBase = parsed.toString();
  }

  const endpoint =
    apiBase ?? (storeDomain ? `https://${storeDomain}/admin/api/${apiVersion}/graphql.json` : undefined);

  return {
    storeDomain,
    accessToken,
    clientId,
    clientSecret,
    apiVersion,
    endpoint,
    timeoutMs: positiveNumber(env.SHOPIFY_TIMEOUT_MS, 30_000),
    maxRetries: nonNegativeNumber(env.SHOPIFY_MAX_RETRIES, 4),
    tokenLeewaySeconds: nonNegativeNumber(env.SHOPIFY_TOKEN_LEEWAY_SECONDS, 300),
  };
}
