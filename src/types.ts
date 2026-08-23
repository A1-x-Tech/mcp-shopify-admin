/**
 * Config, wire types and errors for the Shopify Admin API (GraphQL).
 *
 * The server talks to a single endpoint —
 * `https://{store}.myshopify.com/admin/api/{version}/graphql.json` — with a
 * static `X-Shopify-Access-Token` (a ready-to-use Admin API access token; the
 * server does not perform the OAuth exchange or refresh the token). The store comes from the config, never
 * from a tool argument.
 *
 * Shopify meters this API in a cost bucket, not in requests: every response
 * carries `extensions.cost` with the points the query burned and the bucket
 * state (`currentlyAvailable` / `maximumAvailable`, refilled `restoreRate`
 * points per second). The client lifts that into every envelope as `cost`.
 */

export interface ShopifyAdminConfig {
  /**
   * The store's permanent `*.myshopify.com` host, e.g. `my-store.myshopify.com`
   * (config normalizes a bare store name or a pasted URL into this form).
   * Optional: a server without credentials still starts (degraded) and every
   * tool call answers with {@link CredentialsError} instead.
   */
  storeDomain?: string;
  /**
   * A ready-made Admin API access token, used as-is and never refreshed. This
   * is the legacy path: admin-created custom apps stopped being issuable on
   * 2026-01-01, so only stores that already had one can still supply it.
   * Treated as a secret. Optional, as above.
   */
  accessToken?: string;
  /**
   * Client id of a Dev Dashboard app. With {@link clientSecret} the client
   * mints its own token through the `client_credentials` grant and keeps it
   * fresh — the only path available to a store set up today, where the minted
   * token lives 24 hours. Ignored when {@link accessToken} is set.
   */
  clientId?: string;
  /** Client secret of that app. Treated as a secret. */
  clientSecret?: string;
  /**
   * How early to replace a minted token, in seconds. Defaults to 300: the
   * grant issues 24-hour tokens, so a wide margin costs nothing and keeps a
   * long-running session from ever presenting an expired one.
   */
  tokenLeewaySeconds?: number;
  /** Admin API version, `YYYY-MM` (quarterly) or `unstable`. */
  apiVersion: string;
  /**
   * Full GraphQL endpoint URL. Derived from `storeDomain` + `apiVersion`, or
   * taken verbatim from `SHOPIFY_API_BASE` (e.g. a local mock). Undefined only
   * when the domain is missing — no request leaves the client then.
   */
  endpoint?: string;
  /**
   * Message of the {@link ConfigError} that degraded this config, when one did.
   * Set by index.ts so a tool call can name the variable that actually broke
   * instead of the credentials, which are usually set correctly.
   */
  configProblem?: string;
  /** Per-request timeout in milliseconds. Defaults to 30_000. */
  timeoutMs?: number;
  /** Max retries for transient failures (THROTTLED always, 5xx/network on reads). Defaults to 4. */
  maxRetries?: number;
  /** Base backoff in milliseconds, doubled each retry. Defaults to 500. */
  retryBaseMs?: number;
  /**
   * `User-Agent` sent on every request, so Shopify can tell this server from
   * an unidentified script. Defaults to `mcp-shopify-admin`; index.ts passes
   * the package version with it.
   */
  userAgent?: string;
}

// --- Enumerations (values the API accepts; kept as const tuples so tools can
// build zod enums from them without restating the vocabulary). ---

/** Product lifecycle status. */
export const PRODUCT_STATUSES = ["ACTIVE", "ARCHIVED", "DRAFT"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Why an order is being cancelled — the API's `OrderCancelReason`. */
export const ORDER_CANCEL_REASONS = ["CUSTOMER", "DECLINED", "FRAUD", "INVENTORY", "OTHER", "STAFF"] as const;
export type OrderCancelReason = (typeof ORDER_CANCEL_REASONS)[number];

/**
 * Why an inventory quantity is being set — the closed `reason` vocabulary of
 * `inventorySetQuantities`; an unknown value is a userError, so the tool
 * offers exactly this list.
 */
export const INVENTORY_REASONS = [
  "correction",
  "cycle_count_available",
  "damaged",
  "movement_canceled",
  "movement_created",
  "movement_received",
  "movement_updated",
  "other",
  "promotion",
  "quality_control",
  "received",
  "reservation_created",
  "reservation_deleted",
  "reservation_updated",
  "restock",
  "safety_stock",
  "shrinkage",
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

/** GID types the tools accept ids for; used to build and check `gid://shopify/<Type>/<id>`. */
export const GID_TYPES = [
  "Product",
  "ProductVariant",
  "Order",
  "Customer",
  "Location",
  "InventoryItem",
  "DiscountNode",
] as const;
export type GidType = (typeof GID_TYPES)[number];

// --- Envelope ---

/**
 * What the GraphQL cost bucket said about this call, flattened from
 * `extensions.cost`: what the query actually burned and how much of the bucket
 * is left (refilled `restoreRate` points per second). `null` when the response
 * carried no cost block.
 */
export interface CostInfo {
  /** Points the executed query actually cost (null while Shopify is still estimating). */
  actualQueryCost: number | null;
  /** Points left in the bucket right now. */
  currentlyAvailable: number;
  /** Bucket size. */
  maximumAvailable: number;
  /** Points restored per second. */
  restoreRate: number;
}

/**
 * Every client call returns the parsed data plus the cost-bucket state, read
 * off `extensions.cost`. Shopify meters the API in points that restore per
 * second, so tools pass the numbers through to the agent — that is how it
 * knows whether it can afford the next call or should wait a beat.
 */
export interface ApiResponse<T> {
  data: T;
  /** Cost-bucket state of this response, or null when Shopify sent none. */
  cost: CostInfo | null;
}

/** One page of a cursor-paginated connection. */
export interface ConnectionPage<T> {
  /** Total matching the same filter, when the API exposes a count for it; null otherwise. */
  count: number | null;
  items: T[];
  /** Whether another page exists after this one. */
  hasNextPage: boolean;
  /** Cursor to pass as `after` for the next page, or null on the last page. */
  endCursor: string | null;
}

// --- Errors ---

/** Coarse failure class of an API error. */
export type ShopifyErrorKind =
  | "bad_request"
  | "authentication"
  | "access_denied"
  | "not_found"
  | "payment_required"
  | "locked"
  | "rate_limit"
  | "server"
  | "graphql"
  | "api";

/** Maps an HTTP status onto the error taxonomy (GraphQL-level kinds are set by the caller). */
export function errorKind(status: number): ShopifyErrorKind {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "authentication";
    case 402:
      return "payment_required";
    case 403:
      return "access_denied";
    case 404:
      return "not_found";
    case 423:
      return "locked";
    case 429:
      return "rate_limit";
    default:
      return status >= 500 ? "server" : "api";
  }
}

/** What the failing response itself said about when to come back, and at what cost. */
export interface ShopifyAdminErrorMeta {
  /** Seconds to wait before repeating the call, when the response said so (Retry-After or throttleStatus). */
  retryAfter?: number;
  /** Cost-bucket state of the failing response, when it carried one. */
  cost?: CostInfo | null;
  /** Overrides the status-derived kind (e.g. `rate_limit` for a THROTTLED GraphQL error). */
  kind?: ShopifyErrorKind;
}

/**
 * A failed API call: a non-2xx HTTP response, or an HTTP 200 whose body
 * carries GraphQL `errors`. The parsed body is kept alongside the status.
 *
 * A THROTTLED error is the one this cost-metered API is built around, so it
 * carries the numbers that make it actionable: `retryAfter` (computed from the
 * bucket's restore rate) and the `cost` block with what is left.
 */
export class ShopifyAdminError extends Error {
  readonly status: number;
  readonly body?: unknown;
  /** Failure class, so callers can branch without matching on status numbers. */
  readonly kind: ShopifyErrorKind;
  /** The first `extensions.code` of the GraphQL errors, when there was one (e.g. ACCESS_DENIED, THROTTLED). */
  readonly code?: string;
  /** Seconds to wait before repeating the call, when the response said so. */
  readonly retryAfter?: number;
  /** Cost-bucket state when the call failed, or null if the response carried none. */
  readonly cost: CostInfo | null;

  constructor(status: number, body: unknown, context?: string, meta: ShopifyAdminErrorMeta = {}) {
    super(`${context ? `${context}: ` : ""}HTTP ${status}: ${formatErrorBody(body)}`);
    this.name = "ShopifyAdminError";
    this.status = status;
    this.body = body;
    this.kind = meta.kind ?? errorKind(status);
    const code = firstGraphqlCode(body);
    if (code !== undefined) this.code = code;
    if (typeof meta.retryAfter === "number") this.retryAfter = meta.retryAfter;
    this.cost = meta.cost ?? null;
  }
}

/**
 * A mutation the API executed the request for but refused to apply: HTTP 200,
 * empty GraphQL `errors`, and a non-empty `userErrors` in the payload. Kept
 * separate from {@link ShopifyAdminError} because nothing about the transport
 * failed — the input did — and a retry with the same input cannot succeed.
 */
export class MutationError extends Error {
  /** The API's per-field verdicts, verbatim. */
  readonly userErrors: Array<{ field?: string[] | null; message: string }>;

  constructor(operation: string, userErrors: Array<{ field?: string[] | null; message: string }>) {
    const details = userErrors
      .map((e) => (e.field && e.field.length > 0 ? `${e.field.join(".")}: ${e.message}` : e.message))
      .join("; ");
    super(`${operation} отклонена API (userErrors): ${details}`);
    this.name = "MutationError";
    this.userErrors = userErrors;
  }
}

/**
 * Input rejected before it reached the network — a malformed gid, a page size
 * over the cap, a discount without a value. Separate from
 * {@link ShopifyAdminError} so a caller can tell "you sent nonsense" from
 * "Shopify said no".
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * A tool call arrived while the server runs without credentials (degraded
 * start). Thrown by the client BEFORE the request is built or anything is
 * fetched: a missing credential is a configuration problem, not transport
 * trouble, so it must never enter the retry/backoff path. The message is the
 * product — it is the only text the calling model reads about the missing
 * setup, so it names the variables to set and says the server needs a restart
 * (credentials come only from the environment).
 */
export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

/** The first machine code of a GraphQL error body, e.g. THROTTLED or ACCESS_DENIED. */
function firstGraphqlCode(body: unknown): string | undefined {
  const errors = (body as { errors?: unknown } | null | undefined)?.errors;
  if (!Array.isArray(errors)) return undefined;
  for (const err of errors) {
    const code = (err as { extensions?: { code?: unknown } } | null | undefined)?.extensions?.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Turns a parsed API error body into a short, readable message. */
function formatErrorBody(body: unknown): string {
  if (body == null) return "(пустое тело)";
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body !== "object") return String(body);
  const obj = body as Record<string, unknown>;

  // GraphQL style: { errors: [{ message, extensions: { code } }] }.
  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    const parts = obj.errors.slice(0, 5).map((err) => {
      const e = err as { message?: unknown; extensions?: { code?: unknown } };
      const code = typeof e.extensions?.code === "string" ? `[${e.extensions.code}] ` : "";
      return `${code}${typeof e.message === "string" ? e.message : JSON.stringify(err)}`;
    });
    return parts.join("; ").slice(0, 500);
  }

  // REST-style bodies some statuses answer with: { errors: "..." } or { error: "..." }.
  if (typeof obj.errors === "string") return obj.errors.slice(0, 500);
  if (typeof obj.error === "string") return obj.error.slice(0, 500);

  return JSON.stringify(obj).slice(0, 500);
}
