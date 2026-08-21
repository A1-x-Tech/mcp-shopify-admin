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

/** True when everything a request needs is present (an endpoint to hit and a token to sign it). */
export function hasCredentials(config: ShopifyAdminConfig): boolean {
  return Boolean(config.accessToken && config.endpoint);
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
 *   SHOPIFY_STORE_DOMAIN   my-store.myshopify.com (or the bare store name)
 *   SHOPIFY_ACCESS_TOKEN   Admin API access token of the custom app (shpat_…)
 *   SHOPIFY_API_VERSION    YYYY-MM quarterly release or unstable (default 2026-01)
 *   SHOPIFY_TIMEOUT_MS     per-request timeout (default 30000)
 *   SHOPIFY_MAX_RETRIES    retries for THROTTLED (always) and 5xx/network on reads (default 4)
 *   SHOPIFY_API_BASE       full GraphQL endpoint override, e.g. a local mock
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShopifyAdminConfig {
  // An empty string reads as absent, never as an empty credential.
  const accessToken = env.SHOPIFY_ACCESS_TOKEN || undefined;

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
  const endpoint =
    env.SHOPIFY_API_BASE ||
    (storeDomain ? `https://${storeDomain}/admin/api/${apiVersion}/graphql.json` : undefined);

  return {
    storeDomain,
    accessToken,
    apiVersion,
    endpoint,
    timeoutMs: positiveNumber(env.SHOPIFY_TIMEOUT_MS, 30_000),
    maxRetries: nonNegativeNumber(env.SHOPIFY_MAX_RETRIES, 4),
  };
}
