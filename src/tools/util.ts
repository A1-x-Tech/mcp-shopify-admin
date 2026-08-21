import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ShopifyAdminError } from "../types.js";
import { INVENTORY_REASONS, ORDER_CANCEL_REASONS, PRODUCT_STATUSES } from "../types.js";

/**
 * Everything below is a FACTORY (not a shared const): reusing one zod object
 * across two fields makes zod-to-json-schema dedupe them into a `$ref` (e.g.
 * endsAt → #/properties/startsAt), which some tool-schema consumers (OpenAI
 * Apps review) don't dereference and flag as `any`. A fresh object per field
 * keeps each one inlined with its own type, pattern and description.
 */

/** An entity id: a bare number ("8123456789") or a full gid (gid://shopify/Product/8123456789). */
export const entityId = () =>
  z
    .string()
    .min(1)
    .describe("Числовой id или полный gid://shopify/<Type>/<id>.");

/** Page size of a connection: 1..250 (Shopify's own `first` cap). */
export const pageSize = () => z.number().int().min(1).max(250);

/** Opaque cursor from the previous page's endCursor. */
export const cursor = () => z.string().min(1);

/**
 * Shopify search query string, passed to the API as-is. The syntax is shared
 * by every list endpoint: `field:value`, ranges (`created_at:>=2026-01-01`),
 * AND/OR, `-` for negation.
 */
export const searchQuery = () => z.string().min(1);

/** A money amount as the API takes it: a decimal string in the shop currency. */
export const moneyAmount = () =>
  z.string().regex(/^\d+(\.\d{1,2})?$/, 'Сумма — десятичная строка в валюте магазина, например "10.00"');

/** An ISO-8601 timestamp, e.g. 2026-09-01T00:00:00Z. */
export const isoDateTime = () =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, {
    message: "Момент времени должен быть в ISO-8601, например 2026-09-01T00:00:00Z",
  });

export const productStatusEnum = () => z.enum(PRODUCT_STATUSES);
export const orderCancelReasonEnum = () => z.enum(ORDER_CANCEL_REASONS);
export const inventoryReasonEnum = () => z.enum(INVENTORY_REASONS);

/**
 * Wraps a value as a compact-JSON tool result (compact: the consumer is an
 * LLM). Client methods return `{ data, cost }`, so passing that envelope
 * straight to `ok` hands the agent the cost-bucket state with the answer.
 */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text: text ?? "null" }] };
}

/**
 * Renders an error for the agent. An API failure also reports what the
 * response itself said about coming back: the wait a THROTTLED answer implies
 * (this API is metered in a cost bucket, so a refusal without a wait time is
 * unanswerable) and the bucket state, which every successful result carries
 * and which the agent would otherwise lose exactly when it matters.
 */
export function fail(err: unknown): CallToolResult {
  let message = err instanceof Error ? err.message : String(err);
  // Surface the underlying cause (e.g. the network error behind a timeout) — no
  // secrets live in cause, and it makes failures far easier to diagnose.
  if (err instanceof Error && err.cause instanceof Error) message += ` (${err.cause.message})`;
  if (err instanceof ShopifyAdminError) {
    const hint = authHint(err);
    if (hint) message += ` — ${hint}`;
    if (err.retryAfter !== undefined) message += ` — повтор через ${err.retryAfter} с`;
    if (err.cost !== null) message += ` (cost.currentlyAvailable: ${err.cost.currentlyAvailable})`;
  }
  return { content: [{ type: "text", text: `Ошибка: ${message}` }], isError: true };
}

/**
 * What the API's auth-shaped failures actually mean here.
 *
 * The two that cost the most blind probes: a 401 is the token itself, but
 * ACCESS_DENIED inside a 200 is NOT — the token is fine and lacks an access
 * scope, which no amount of re-pasting fixes; the app's scopes must change
 * (and changing them re-issues the token). A 404 at the API level is the
 * store host, not a missing entity — entity misses come back as `null` data.
 */
function authHint(err: ShopifyAdminError): string | undefined {
  if (err.code === "ACCESS_DENIED") {
    return (
      "токен действителен, но у приложения нет нужного access scope: выдайте его в админке " +
      "(Settings → Apps and sales channels → Develop apps → приложение → Configuration), " +
      "переустановите приложение и обновите SHOPIFY_ACCESS_TOKEN — смена scopes выпускает новый токен"
    );
  }
  switch (err.status) {
    case 401:
      return "токен отклонён: стоит проверить SHOPIFY_ACCESS_TOKEN (Admin API access token кастомного приложения, начинается с shpat_)";
    case 402:
      return "магазин заморожен из-за проблемы с оплатой тарифа Shopify — API вернётся после оплаты";
    case 404:
      return "магазин не найден: SHOPIFY_STORE_DOMAIN должен быть постоянным доменом вида my-store.myshopify.com";
    case 423:
      return "магазин временно заблокирован Shopify — API недоступен до разблокировки";
    default:
      return undefined;
  }
}

/**
 * MCP tool annotations — hints the consuming client can use to gate or label a
 * tool. All four hints are always set explicitly: some clients (OpenAI Apps
 * review) require readOnlyHint, destructiveHint and openWorldHint on every tool.
 */

/** Reads remote state and changes nothing; re-reading yields the same result. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * Writes remote state, but only ever overwrites a field with the value given
 * (a title, a price, a quantity), so repeating the call lands on the same
 * state and nothing is lost. Use for the update-* and set-* tools.
 */
export const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * Creates a new remote entity. Not destructive — nothing existing is harmed —
 * but repeating it produces a duplicate, so it is not idempotent. Use for the
 * create_* tools (product, discount).
 */
export const CREATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/**
 * Irreversible from the agent's side: cancelling an order (with a possible
 * refund), or an arbitrary GraphQL document that may mutate anything.
 */
export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;
