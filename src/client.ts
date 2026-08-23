import type {
  ApiResponse,
  ConnectionPage,
  CostInfo,
  GidType,
  InventoryReason,
  OrderCancelReason,
  ProductStatus,
  ShopifyAdminConfig,
} from "./types.js";
import { CredentialsError, MutationError, ShopifyAdminError, ValidationError } from "./types.js";

/** Page size bounds of every connection (Shopify's own `first` cap). */
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 250;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Identifies the server to Shopify when no version is known (tests, `npm run
 * smoke`); index.ts passes `mcp-shopify-admin/<package version>` instead.
 */
export const DEFAULT_USER_AGENT = "mcp-shopify-admin";

/**
 * Call-time texts for missing credentials. The message is the product: it is
 * what the calling model relays to the user, so it names the variable to set
 * and says the server needs a restart — credentials come only from the
 * environment.
 */
const MISSING_STORE_DOMAIN_TEXT =
  "Требуется SHOPIFY_STORE_DOMAIN — постоянный домен магазина вида my-store.myshopify.com.";
const MISSING_AUTH_TEXT =
  "Требуются учётные данные Shopify: либо SHOPIFY_CLIENT_ID и SHOPIFY_CLIENT_SECRET приложения из Dev Dashboard " +
  "(сервер сам получит токен и будет обновлять его — это единственный путь для магазина, настраиваемого сегодня), " +
  "либо готовый SHOPIFY_ACCESS_TOKEN, если у вас сохранилось приложение, созданное в админке до 2026-01-01.";

/** The same variables as list items for the combined «Требуются X и Y» message. */
const LISTED_STORE_DOMAIN = "SHOPIFY_STORE_DOMAIN (постоянный домен магазина my-store.myshopify.com)";
const LISTED_AUTH =
  "SHOPIFY_CLIENT_ID и SHOPIFY_CLIENT_SECRET (приложение Dev Dashboard) или SHOPIFY_ACCESS_TOKEN (готовый токен)";

/**
 * The full CredentialsError message for this config, or undefined when every
 * credential is present. One missing variable keeps its own text; both fold
 * into one combined message so the user fixes them in one restart instead of
 * discovering them one by one.
 */
function missingCredentialsMessage(config: ShopifyAdminConfig): string | undefined {
  // A malformed value degrades the config to "no credentials", so without this
  // branch every call would name the two credential variables — which the
  // operator usually set correctly — and never name the one that actually
  // broke. Report the real problem instead.
  if (config.configProblem) {
    return (
      `Сервер запущен без подключения к магазину из-за ошибки конфигурации: ${config.configProblem}` +
      " Это не сбой сети — повторный вызов не поможет: исправьте переменную окружения в конфигурации" +
      " MCP-клиента и перезапустите сервер."
    );
  }

  const missing: Array<{ single: string; listed: string }> = [];
  // The endpoint stands in for the domain: an explicit SHOPIFY_API_BASE
  // override supplies it without any domain at all.
  if (!config.endpoint) missing.push({ single: MISSING_STORE_DOMAIN_TEXT, listed: LISTED_STORE_DOMAIN });
  // Either authentication path satisfies this; the client prefers a ready-made
  // token and mints one from the client credentials otherwise.
  if (!config.accessToken && !(config.clientId && config.clientSecret)) {
    missing.push({ single: MISSING_AUTH_TEXT, listed: LISTED_AUTH });
  }
  if (missing.length === 0) return undefined;

  const what =
    missing.length === 1
      ? missing[0].single
      : `Требуются ${missing.map((m) => m.listed).join(" и ")}.`;
  const fix =
    " Это не сбой сети — повторный вызов не поможет: задайте " +
    (missing.length === 1 ? "переменную окружения" : "переменные окружения") +
    " в конфигурации MCP-клиента и перезапустите сервер.";
  return what + fix;
}

/**
 * Builds a full `gid://shopify/<Type>/<id>` from what the model passed: a bare
 * numeric id or an already-full gid. A gid of a *different* type is rejected
 * rather than forwarded — passing an Order gid to a Product tool is a mixed-up
 * argument, and the API's NOT_FOUND for it would send the caller hunting the
 * wrong problem.
 */
export function toGid(type: GidType, id: string): string {
  const value = id.trim();
  if (/^\d+$/.test(value)) return `gid://shopify/${type}/${value}`;
  const match = /^gid:\/\/shopify\/([A-Za-z]+)\/(\d+)(?:[/?].*)?$/.exec(value);
  if (!match) {
    throw new ValidationError(
      `id должен быть числом или gid вида gid://shopify/${type}/123, получено "${value.slice(0, 80)}".`,
    );
  }
  if (match[1] !== type) {
    throw new ValidationError(`Ожидался id типа ${type}, получен gid типа ${match[1]}.`);
  }
  return `gid://shopify/${type}/${match[2]}`;
}

/** Clamps the page size the same way for every connection (out-of-range means "as many as possible"). */
export function normalizePageSize(first: number | undefined): number {
  if (first === undefined || !Number.isFinite(first)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(first), MIN_PAGE_SIZE), MAX_PAGE_SIZE);
}

/** What the document's first executable operation is. */
export type OperationKind = "query" | "mutation" | "subscription" | "shorthand" | "unknown";

/**
 * The kind of the first *executable operation* in a GraphQL document — the
 * retry-safety gate for `graphql_request`, the one caller whose document the
 * client did not write itself.
 *
 * It cannot just read the first keyword: fragment definitions may legally come
 * before the operation they serve, so `fragment F on Product { id } mutation M
 * { … }` opens with `fragment` while being a mutation. Reading only the first
 * word classified that as a query and let a mutation into the 5xx retry loop —
 * exactly the double-write this whole asymmetry exists to prevent.
 *
 * So this walks the document instead, tracking brace depth and skipping what
 * cannot contain a top-level definition: comments, strings, block strings, and
 * anything inside `(…)` (a directive or variable default may carry braces of
 * its own). The first depth-0 `query`/`mutation`/`subscription` keyword wins;
 * a depth-0 `{` that is not a fragment body is the shorthand query form.
 */
export function firstOperationKind(document: string): OperationKind {
  let i = 0;
  let depth = 0;
  let parens = 0;
  let pendingFragment = false;
  let word = "";

  /** Consumes the identifier just collected; returns the operation it names, if any. */
  const takeWord = (): OperationKind | null => {
    if (!word) return null;
    const w = word.toLowerCase();
    word = "";
    if (w === "fragment") {
      pendingFragment = true;
      return null;
    }
    if (w === "query" || w === "mutation" || w === "subscription") return w;
    return null;
  };

  while (i < document.length) {
    const ch = document[i];

    if (ch === "#") {
      const found = takeWord();
      if (found) return found;
      while (i < document.length && document[i] !== "\n") i++;
      continue;
    }

    if (document.startsWith('"""', i)) {
      const found = takeWord();
      if (found) return found;
      const end = document.indexOf('"""', i + 3);
      i = end === -1 ? document.length : end + 3;
      continue;
    }

    if (ch === '"') {
      const found = takeWord();
      if (found) return found;
      i++;
      while (i < document.length && document[i] !== '"') {
        if (document[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }

    // Argument lists can hold braces (`@dir(if: {x: 1})`, `$v: In = {a: 1}`),
    // so brace depth is only meaningful outside them.
    if (ch === "(" || ch === ")") {
      const found = takeWord();
      if (found) return found;
      if (ch === "(") parens++;
      else if (parens > 0) parens--;
      i++;
      continue;
    }

    if (parens === 0 && (ch === "{" || ch === "}")) {
      const found = takeWord();
      if (found) return found;
      if (ch === "{") {
        if (depth === 0) {
          // A top-level selection set either closes a fragment header or is the
          // shorthand operation form, which is always a query.
          if (pendingFragment) pendingFragment = false;
          else return "shorthand";
        }
        depth++;
      } else if (depth > 0) {
        depth--;
      }
      i++;
      continue;
    }

    if (depth === 0 && parens === 0 && /[A-Za-z_]/.test(ch)) {
      word += ch;
      i++;
      continue;
    }

    const found = takeWord();
    if (found) return found;
    i++;
  }

  return takeWord() ?? "unknown";
}

/**
 * Whether a document must be treated as a write. Only a *proven* non-mutation
 * is safe to repeat: an unreadable document counts as a mutation, because
 * guessing "safe to repeat" about an unknown write is how a write lands twice.
 */
export function isMutationDocument(query: string): boolean {
  const kind = firstOperationKind(query);
  return kind === "mutation" || kind === "unknown";
}

/**
 * How long a THROTTLED call should wait before repeating, from the bucket
 * state the failing response itself carried: the missing points divided by the
 * restore rate. Undefined when the response had no usable cost block.
 */
export function throttleWaitSeconds(requestedQueryCost: number | undefined, cost: CostInfo | null): number | undefined {
  if (!cost || typeof requestedQueryCost !== "number" || cost.restoreRate <= 0) return undefined;
  const missing = requestedQueryCost - cost.currentlyAvailable;
  if (missing <= 0) return 1;
  return Math.ceil(missing / cost.restoreRate);
}

/**
 * Backoff before a retry: honors the wait the response implied when it can be
 * computed (Retry-After on HTTP 429, the bucket math on THROTTLED — capped at
 * 30s so a hostile value cannot park the process), else exponential.
 * Exported so the schedule can be tested without waiting for it.
 */
export function backoffMs(attempt: number, retryBaseMs: number, waitSeconds?: number): number {
  if (waitSeconds !== undefined) return Math.min(waitSeconds, 30) * 1000;
  return Math.min(retryBaseMs * 2 ** attempt, 30_000);
}

/** `Retry-After` in seconds as the server sent it (HTTP 429 answers carry one). */
export function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (raw === null) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
}

// --- GraphQL documents ---
// Written against the pinned API version (config.ts DEFAULT_API_VERSION).
// Selections are deliberately compact: the consumer is an LLM, and every field
// here is either something an agent acts on or an id it needs to act.

const PRODUCT_LIST_FIELDS = `
  id title handle status vendor productType tags totalInventory createdAt updatedAt`;

const VARIANT_FIELDS = `
  id title sku barcode price compareAtPrice inventoryQuantity inventoryItem { id }`;

const SHOP_QUERY = `query {
  shop {
    id name myshopifyDomain contactEmail currencyCode ianaTimezone
    primaryDomain { host }
    plan { displayName shopifyPlus }
    billingAddress { country city }
  }
  productsCount { count }
  locations(first: 10) { nodes { id name isActive } }
}`;

const PRODUCTS_QUERY = `query ($first: Int!, $after: String, $query: String) {
  productsCount(query: $query) { count }
  products(first: $first, after: $after, query: $query) {
    nodes {${PRODUCT_LIST_FIELDS}
      variants(first: 5) { nodes { id title sku price } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const PRODUCT_QUERY = `query ($id: ID!) {
  product(id: $id) {${PRODUCT_LIST_FIELDS}
    descriptionHtml
    options { name values }
    variants(first: 100) { nodes {${VARIANT_FIELDS} } }
  }
}`;

const PRODUCT_CREATE_MUTATION = `mutation ($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product {${PRODUCT_LIST_FIELDS}
      variants(first: 5) { nodes {${VARIANT_FIELDS} } }
    }
    userErrors { field message }
  }
}`;

const PRODUCT_UPDATE_MUTATION = `mutation ($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product {${PRODUCT_LIST_FIELDS} }
    userErrors { field message }
  }
}`;

const VARIANTS_UPDATE_MUTATION = `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {${VARIANT_FIELDS} }
    userErrors { field message }
  }
}`;

const ORDER_LIST_FIELDS = `
  id name createdAt displayFinancialStatus displayFulfillmentStatus closed cancelledAt
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { id displayName email }`;

const ORDERS_QUERY = `query ($first: Int!, $after: String, $query: String) {
  ordersCount(query: $query) { count }
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes {${ORDER_LIST_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ORDER_QUERY = `query ($id: ID!) {
  order(id: $id) {${ORDER_LIST_FIELDS}
    note tags
    subtotalPriceSet { shopMoney { amount currencyCode } }
    totalShippingPriceSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount currencyCode } }
    shippingAddress { name address1 address2 city zip country phone }
    lineItems(first: 100) {
      nodes {
        id title quantity sku
        variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
      }
    }
    fulfillments(first: 10) { status trackingInfo { company number url } }
  }
}`;

const ORDER_CANCEL_MUTATION = `mutation ($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean, $staffNote: String) {
  orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
    job { id done }
    orderCancelUserErrors { field message }
  }
}`;

const CUSTOMER_LIST_FIELDS = `
  id displayName email phone createdAt numberOfOrders
  amountSpent { amount currencyCode }
  defaultAddress { city country }`;

const CUSTOMERS_QUERY = `query ($first: Int!, $after: String, $query: String) {
  customersCount(query: $query) { count }
  customers(first: $first, after: $after, query: $query) {
    nodes {${CUSTOMER_LIST_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CUSTOMER_QUERY = `query ($id: ID!) {
  customer(id: $id) {${CUSTOMER_LIST_FIELDS}
    note verifiedEmail tags
    addresses { address1 city zip country phone }
    orders(first: 10, sortKey: CREATED_AT, reverse: true) {
      nodes { id name createdAt displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } }
    }
  }
}`;

const LOCATIONS_QUERY = `query ($first: Int!) {
  locations(first: $first, includeInactive: true) {
    nodes {
      id name isActive fulfillsOnlineOrders
      address { address1 city zip country }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const INVENTORY_SET_MUTATION = `mutation ($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup {
      reason
      changes { name delta quantityAfterChange item { id } location { id } }
    }
    userErrors { field message }
  }
}`;

/**
 * `discount` is a union with no common interface, so the page lists the
 * typename plus the fields of the shapes an agent actually meets; an exotic
 * type still returns its `__typename` and id rather than vanishing.
 */
const DISCOUNTS_QUERY = `query ($first: Int!, $after: String, $query: String) {
  discountNodes(first: $first, after: $after, query: $query) {
    nodes {
      id
      discount {
        __typename
        ... on DiscountCodeBasic { title status summary startsAt endsAt usageLimit asyncUsageCount codes(first: 5) { nodes { code } } }
        ... on DiscountCodeFreeShipping { title status summary startsAt endsAt usageLimit asyncUsageCount codes(first: 5) { nodes { code } } }
        ... on DiscountCodeBxgy { title status summary startsAt endsAt usageLimit asyncUsageCount codes(first: 5) { nodes { code } } }
        ... on DiscountAutomaticBasic { title status startsAt endsAt }
        ... on DiscountAutomaticBxgy { title status startsAt endsAt }
        ... on DiscountAutomaticFreeShipping { title status startsAt endsAt }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const DISCOUNT_CREATE_MUTATION = `mutation ($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode {
      id
      codeDiscount { ... on DiscountCodeBasic { title status summary startsAt endsAt usageLimit codes(first: 5) { nodes { code } } } }
    }
    userErrors { field message }
  }
}`;

/** Inputs of a cursor-paginated list call. */
export interface ListParams {
  /** Page size, 1..250. Defaults to 20; out-of-range values are clamped. */
  first?: number;
  /** `endCursor` of the previous page. */
  after?: string;
  /** Shopify search query string, passed as-is (e.g. `status:active created_at:>=2026-01-01`). */
  query?: string;
}

export interface CreateProductInput {
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: ProductStatus;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  id: string;
  title?: string;
}

export interface VariantPriceUpdate {
  id: string;
  price?: string;
  compareAtPrice?: string | null;
}

export interface CancelOrderParams {
  orderId: string;
  reason: OrderCancelReason;
  /** Refund the payment to the customer. */
  refund: boolean;
  /** Return the order's items to inventory. */
  restock: boolean;
  notifyCustomer?: boolean;
  staffNote?: string;
}

export interface InventoryQuantityInput {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
}

export interface SetInventoryParams {
  quantities: InventoryQuantityInput[];
  reason?: InventoryReason;
}

export interface CreateBasicDiscountParams {
  title: string;
  code: string;
  /** Fraction 0..1 (0.2 = −20%). Exactly one of percentage / amount. */
  percentage?: number;
  /** Fixed amount off in the shop currency, e.g. "10.00". */
  amount?: string;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
  appliesOncePerCustomer?: boolean;
}

/** One page of a connection plus the count field queried alongside it, reshaped. */
interface RawConnection<T> {
  nodes?: T[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
}

/**
 * Client for the Shopify Admin API (GraphQL).
 *
 * Every call goes through {@link request}: one POST to the store's
 * `graphql.json` with the static access token, an AbortController timeout that
 * also covers reading the body, retries with backoff, `extensions.cost` lifted
 * into the envelope, and GraphQL `errors` turned into {@link ShopifyAdminError}.
 * Mutation helpers additionally turn a non-empty `userErrors` into
 * {@link MutationError} — Shopify answers HTTP 200 either way, and an agent
 * that reads "200" as "done" ships wrong conclusions.
 *
 * Retries are deliberately asymmetric. THROTTLED is always safe to repeat —
 * the call was refused before execution, and the response says how long to
 * wait — but a 5xx or a dropped connection on a mutation may well have
 * committed, so only queries repeat those.
 */
export class ShopifyAdminClient {
  private readonly endpoint?: string;
  private readonly tokenEndpoint?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly leewayMs: number;
  private readonly userAgent: string;

  /** The minted token, cached in memory only — never written to disk. */
  private token?: { value: string; expiresAt: number };
  /** In-flight mint, so parallel tool calls share one exchange. */
  private tokenRequest?: Promise<string>;

  constructor(
    private readonly config: ShopifyAdminConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = config.endpoint;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 4;
    this.retryBaseMs = config.retryBaseMs ?? 500;
    this.leewayMs = (config.tokenLeewaySeconds ?? 300) * 1000;
    // The grant lives on the store host next to the API, not under it, so it
    // is derived from the endpoint's origin — which keeps a mock self-consistent.
    this.tokenEndpoint = config.endpoint
      ? new URL("/admin/oauth/access_token", config.endpoint).toString()
      : undefined;
    // Node's fetch would otherwise send `User-Agent: node`, which is
    // indistinguishable from any other script in Shopify's logs.
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
  }

  // --- Auth ---

  /** Whether this client can mint its own tokens (as opposed to being handed one). */
  private get canMint(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.tokenEndpoint);
  }

  /**
   * The token to sign the next request with.
   *
   * A ready-made `SHOPIFY_ACCESS_TOKEN` is returned as-is — it is the operator's
   * to manage. Otherwise the client_credentials grant mints one, cached until
   * `leeway` before it expires. Concurrent callers share one in-flight request
   * so a burst of parallel tool calls mints exactly one token; a failed mint is
   * not cached.
   */
  private async authToken(): Promise<string> {
    if (this.config.accessToken) return this.config.accessToken;
    if (this.token && Date.now() < this.token.expiresAt - this.leewayMs) return this.token.value;
    if (!this.tokenRequest) {
      this.tokenRequest = this.fetchToken().finally(() => {
        this.tokenRequest = undefined;
      });
    }
    return this.tokenRequest;
  }

  /** Drops the cached token so the next call mints a fresh one (used on a 401). */
  private forgetToken(): void {
    this.token = undefined;
  }

  /**
   * Exchanges the client credentials for an access token. Shopify issues these
   * for 24 hours (`expires_in` 86399) and only when the app and the store sit
   * in the same organization — a mismatch answers `shop_not_permitted`, which
   * no retry can fix, so this never retries.
   */
  private async fetchToken(): Promise<string> {
    const { clientId, clientSecret } = this.config;
    // send() rejects missing credentials before minting; repeated here, where
    // the types demand it, so no future caller can post blanks to the grant.
    if (!clientId || !clientSecret || !this.tokenEndpoint) {
      throw new CredentialsError(missingCredentialsMessage(this.config) ?? MISSING_AUTH_TEXT);
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();

    const { res, text } = await this.fetchWithTimeout(this.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": this.userAgent,
      },
      body,
    });

    const data = parseBody(text);
    if (!res.ok) {
      throw new ShopifyAdminError(res.status, data, "Не удалось получить токен по client_credentials", {
        retryAfter: retryAfterSeconds(res),
        kind: "authentication",
      });
    }

    const parsed = (data ?? {}) as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== "string" || !parsed.access_token) {
      throw new ShopifyAdminError(res.status, data, "В ответе client_credentials нет access_token", {
        kind: "authentication",
      });
    }
    // Shopify sends 86399; the fallback only matters if it ever stops.
    const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 86_399;
    this.token = { value: parsed.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return parsed.access_token;
  }

  /** The store every call is scoped to (from config, never from a tool), or undefined on a degraded start. */
  get storeDomain(): string | undefined {
    return this.config.storeDomain;
  }

  /** Admin API version the queries are sent against. */
  get apiVersion(): string {
    return this.config.apiVersion;
  }

  // --- Transport ---

  /**
   * Low-level GraphQL request, used by every method here and by the
   * graphql_request tool. Retry safety is derived from the document: queries
   * repeat on 5xx and network failures, mutations do not, THROTTLED repeats
   * either way. Non-2xx and GraphQL-level errors throw {@link ShopifyAdminError};
   * `userErrors` of an arbitrary document are NOT interpreted here — the raw
   * payload goes back to the caller.
   */
  async request<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    operationName?: string,
  ): Promise<ApiResponse<T>> {
    return this.send<T>(query, variables, !isMutationDocument(query), operationName);
  }

  private async send<T>(
    query: string,
    variables: Record<string, unknown> | undefined,
    retryUnsafe: boolean,
    operationName?: string,
  ): Promise<ApiResponse<T>> {
    // A missing credential is rejected before the request is built, retried or
    // fetched: it is a configuration problem, not transport trouble, so it
    // must never enter the retry/backoff branch below — and fetch never fires
    // at all (pinned in client.test.ts).
    const missing = missingCredentialsMessage(this.config);
    if (missing) throw new CredentialsError(missing);
    const endpoint = this.endpoint as string;

    const payload = JSON.stringify(
      compact({ query, variables, operationName } as Record<string, unknown>),
    );

    let attempt = 0;
    let tokenRefreshed = false;

    for (;;) {
      // Fetched per attempt, not once: a long retry ladder can outlive a
      // minted token, and this is what re-mints it after a 401 below.
      const token = await this.authToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Shopify-Access-Token": token,
        "User-Agent": this.userAgent,
      };

      let res: Response;
      let text: string;
      try {
        ({ res, text } = await this.fetchWithTimeout(endpoint, { method: "POST", headers, body: payload }));
      } catch (err) {
        // Network error or timeout: the request may or may not have been
        // applied, so only queries repeat it.
        if (retryUnsafe && attempt < this.maxRetries) {
          attempt++;
          await delay(backoffMs(attempt - 1, this.retryBaseMs));
          continue;
        }
        throw err;
      }

      const body = parseBody(text);
      const cost = costInfo(body);

      // 401 on a token we minted: it was revoked or expired earlier than
      // advertised. Drop it and repeat once — this costs no retry, and a
      // second 401 falls through to the error below instead of looping. A
      // ready-made token is not re-minted: nothing would change, and the
      // operator is the one who has to replace it.
      if (res.status === 401 && !tokenRefreshed && this.canMint && !this.config.accessToken) {
        tokenRefreshed = true;
        this.forgetToken();
        continue;
      }

      // HTTP 429 means the call was refused outright, so repeating it is safe
      // even for mutations; 5xx is only safe to repeat for queries.
      const httpTransient = res.status === 429 || (retryUnsafe && res.status >= 500 && res.status < 600);
      if (httpTransient && attempt < this.maxRetries) {
        attempt++;
        await delay(backoffMs(attempt - 1, this.retryBaseMs, retryAfterSeconds(res)));
        continue;
      }

      if (!res.ok) {
        throw new ShopifyAdminError(res.status, body, undefined, {
          retryAfter: retryAfterSeconds(res),
          cost,
        });
      }

      // GraphQL errors arrive as HTTP 200. THROTTLED means the query was
      // refused before execution — the one error that is always safe to
      // repeat, after the wait the bucket math implies.
      const errors = (body as { errors?: unknown[] } | undefined)?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        const throttled = errors.some(
          (e) => (e as { extensions?: { code?: unknown } })?.extensions?.code === "THROTTLED",
        );
        const wait = throttled ? throttleWaitSeconds(requestedCost(body), cost) : undefined;
        if (throttled && attempt < this.maxRetries) {
          attempt++;
          await delay(backoffMs(attempt - 1, this.retryBaseMs, wait));
          continue;
        }
        throw new ShopifyAdminError(res.status, body, undefined, {
          retryAfter: wait,
          cost,
          kind: throttled ? "rate_limit" : "graphql",
        });
      }

      // A 200 whose body is empty, truncated mid-stream or not GraphQL at all
      // used to coerce to `{}` and be reported as a successful call, so the
      // agent read "the shop has no products" instead of "the answer never
      // arrived". Only a real `data` object counts as a result. (`data: null`
      // is only legal alongside `errors`, which the branch above already took.)
      const data = isRecord(body) ? body.data : undefined;
      if (!isRecord(data)) {
        throw new ShopifyAdminError(res.status, body, "Ответ Shopify не содержит объект data", {
          cost,
          kind: "graphql",
        });
      }
      return { data: data as T, cost };
    }
  }

  /**
   * fetch with an AbortController timeout. Reads the response body inside the
   * guarded zone so the timeout also covers a slow or drip-feeding body, not
   * just the initial headers, and returns the text alongside the response.
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Запрос к Shopify Admin API превысил тайм-аут ${this.timeoutMs} мс`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Runs a mutation and applies the userErrors contract: HTTP 200 with a
   * non-empty `userErrors` in the payload is a REFUSAL, not a success, and
   * becomes a {@link MutationError}. `errorsKey` covers the mutations that
   * rename the field (orderCancel → orderCancelUserErrors).
   */
  private async mutate<T extends Record<string, unknown>>(
    operation: string,
    query: string,
    variables: Record<string, unknown>,
    errorsKey = "userErrors",
  ): Promise<ApiResponse<T>> {
    const res = await this.send<Record<string, unknown>>(query, variables, false);
    const payload = (res.data?.[operation] ?? {}) as Record<string, unknown>;
    const userErrors = payload[errorsKey];
    if (Array.isArray(userErrors) && userErrors.length > 0) {
      throw new MutationError(operation, userErrors as Array<{ field?: string[] | null; message: string }>);
    }
    const { [errorsKey]: _dropped, ...clean } = payload;
    return { data: clean as T, cost: res.cost };
  }

  /** Reshapes a connection + its optional sibling count into one page. */
  private page<T>(connection: RawConnection<T> | undefined, count?: unknown): ConnectionPage<T> {
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    return {
      count: typeof (count as { count?: unknown } | undefined)?.count === "number" ? (count as { count: number }).count : null,
      items: nodes,
      hasNextPage: connection?.pageInfo?.hasNextPage === true,
      endCursor: connection?.pageInfo?.endCursor ?? null,
    };
  }

  /** Normalized list variables shared by every connection query. */
  private listVariables(params: ListParams): Record<string, unknown> {
    return {
      first: normalizePageSize(params.first),
      after: params.after || undefined,
      query: params.query || undefined,
    };
  }

  // --- Shop ---

  /** The store the token is bound to, its plan, currency, product count and locations. */
  async getShop(): Promise<ApiResponse<Record<string, unknown>>> {
    const res = await this.send<{
      shop?: Record<string, unknown>;
      productsCount?: { count?: number };
      locations?: RawConnection<Record<string, unknown>>;
    }>(SHOP_QUERY, undefined, true);
    return {
      data: {
        shop: res.data.shop ?? {},
        productsCount: res.data.productsCount?.count ?? null,
        locations: res.data.locations?.nodes ?? [],
      },
      cost: res.cost,
    };
  }

  // --- Products ---

  /** Products, cursor-paginated, with the count matching the same filter. */
  async listProducts(params: ListParams = {}): Promise<ApiResponse<ConnectionPage<Record<string, unknown>>>> {
    const res = await this.send<{
      products?: RawConnection<Record<string, unknown>>;
      productsCount?: { count?: number };
    }>(PRODUCTS_QUERY, this.listVariables(params), true);
    return { data: this.page(res.data.products, res.data.productsCount), cost: res.cost };
  }

  /** One product with options and up to 100 variants (inventoryItem ids included). */
  async getProduct(id: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const res = await this.send<{ product?: Record<string, unknown> | null }>(
      PRODUCT_QUERY,
      { id: toGid("Product", id) },
      true,
    );
    return { data: res.data.product ?? null, cost: res.cost };
  }

  /** Creates a product (Shopify adds the default variant itself). */
  async createProduct(input: CreateProductInput): Promise<ApiResponse<Record<string, unknown>>> {
    return this.mutate("productCreate", PRODUCT_CREATE_MUTATION, { product: compact(input) });
  }

  /** Updates a product's own fields (variants have their own call). */
  async updateProduct(input: UpdateProductInput): Promise<ApiResponse<Record<string, unknown>>> {
    const { id, ...rest } = input;
    return this.mutate("productUpdate", PRODUCT_UPDATE_MUTATION, {
      product: { id: toGid("Product", id), ...compact(rest) },
    });
  }

  /** Updates prices of a product's variants (productVariantsBulkUpdate). */
  async updateVariants(productId: string, variants: VariantPriceUpdate[]): Promise<ApiResponse<Record<string, unknown>>> {
    if (variants.length === 0) throw new ValidationError("variants не может быть пустым.");
    return this.mutate("productVariantsBulkUpdate", VARIANTS_UPDATE_MUTATION, {
      productId: toGid("Product", productId),
      variants: variants.map((v) => compact({ ...v, id: toGid("ProductVariant", v.id) })),
    });
  }

  // --- Orders ---

  /** Orders, newest first, with the count matching the same filter. */
  async listOrders(params: ListParams = {}): Promise<ApiResponse<ConnectionPage<Record<string, unknown>>>> {
    const res = await this.send<{
      orders?: RawConnection<Record<string, unknown>>;
      ordersCount?: { count?: number };
    }>(ORDERS_QUERY, this.listVariables(params), true);
    return { data: this.page(res.data.orders, res.data.ordersCount), cost: res.cost };
  }

  /** One order with line items, addresses, refunds and fulfillments. */
  async getOrder(id: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const res = await this.send<{ order?: Record<string, unknown> | null }>(
      ORDER_QUERY,
      { id: toGid("Order", id) },
      true,
    );
    return { data: res.data.order ?? null, cost: res.cost };
  }

  /**
   * Cancels an order. Irreversible; refund/restock are explicit required
   * decisions, not defaults. Returns the async job — cancellation completes in
   * the background.
   */
  async cancelOrder(params: CancelOrderParams): Promise<ApiResponse<Record<string, unknown>>> {
    return this.mutate(
      "orderCancel",
      ORDER_CANCEL_MUTATION,
      {
        orderId: toGid("Order", params.orderId),
        reason: params.reason,
        refund: params.refund,
        restock: params.restock,
        notifyCustomer: params.notifyCustomer,
        staffNote: params.staffNote,
      },
      "orderCancelUserErrors",
    );
  }

  // --- Customers ---

  /** Customers, cursor-paginated. */
  async listCustomers(params: ListParams = {}): Promise<ApiResponse<ConnectionPage<Record<string, unknown>>>> {
    const res = await this.send<{
      customers?: RawConnection<Record<string, unknown>>;
      customersCount?: { count?: number };
    }>(CUSTOMERS_QUERY, this.listVariables(params), true);
    return { data: this.page(res.data.customers, res.data.customersCount), cost: res.cost };
  }

  /** One customer with addresses and their 10 latest orders. */
  async getCustomer(id: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const res = await this.send<{ customer?: Record<string, unknown> | null }>(
      CUSTOMER_QUERY,
      { id: toGid("Customer", id) },
      true,
    );
    return { data: res.data.customer ?? null, cost: res.cost };
  }

  // --- Inventory ---

  /** Locations, inactive included — set_inventory needs their ids. */
  async listLocations(first?: number): Promise<ApiResponse<ConnectionPage<Record<string, unknown>>>> {
    const res = await this.send<{ locations?: RawConnection<Record<string, unknown>> }>(
      LOCATIONS_QUERY,
      { first: normalizePageSize(first) },
      true,
    );
    return { data: this.page(res.data.locations), cost: res.cost };
  }

  /**
   * Sets absolute available quantities (inventorySetQuantities, name:
   * "available", compare-quantity check off — the tool's contract is "set to
   * this number", not compare-and-swap).
   */
  async setInventoryQuantities(params: SetInventoryParams): Promise<ApiResponse<Record<string, unknown>>> {
    if (params.quantities.length === 0) throw new ValidationError("quantities не может быть пустым.");
    for (const q of params.quantities) {
      if (!Number.isInteger(q.quantity) || q.quantity < 0) {
        throw new ValidationError(`quantity должен быть целым числом не меньше 0, получено ${q.quantity}.`);
      }
    }
    return this.mutate("inventorySetQuantities", INVENTORY_SET_MUTATION, {
      input: {
        name: "available",
        reason: params.reason ?? "correction",
        quantities: params.quantities.map((q) => ({
          inventoryItemId: toGid("InventoryItem", q.inventoryItemId),
          locationId: toGid("Location", q.locationId),
          quantity: q.quantity,
          // An EXPLICIT null is what opts out of the compare-and-set check,
          // and opting out is this tool's whole contract: "set to N" whatever
          // is there now. Omitting the key entirely is not the same thing —
          // the API then demands a compareQuantity and refuses the write. The
          // older way to say this, `ignoreCompareQuantity: true` on the input,
          // is deprecated and disappears in API version 2026-04.
          changeFromQuantity: null,
        })),
      },
    });
  }

  // --- Discounts ---

  /** Discounts (code and automatic), cursor-paginated. */
  async listDiscounts(params: ListParams = {}): Promise<ApiResponse<ConnectionPage<Record<string, unknown>>>> {
    const res = await this.send<{ discountNodes?: RawConnection<Record<string, unknown>> }>(
      DISCOUNTS_QUERY,
      this.listVariables(params),
      true,
    );
    return { data: this.page(res.data.discountNodes), cost: res.cost };
  }

  /**
   * Creates a basic code discount: one code, percentage or fixed amount off,
   * for all customers on all items. Exactly one of percentage/amount — the
   * check runs here, before any cost is spent.
   */
  async createBasicDiscountCode(params: CreateBasicDiscountParams): Promise<ApiResponse<Record<string, unknown>>> {
    const hasPercentage = params.percentage !== undefined;
    const hasAmount = params.amount !== undefined;
    if (hasPercentage === hasAmount) {
      throw new ValidationError("Нужно ровно одно из percentage (доля 0..1) и amount (сумма в валюте магазина).");
    }
    if (hasPercentage && (params.percentage as number) <= 0) {
      throw new ValidationError("percentage должен быть больше 0 (доля скидки, например 0.2 для −20%).");
    }
    const value = hasPercentage
      ? { percentage: params.percentage }
      : { discountAmount: { amount: params.amount, appliesOnEachItem: false } };
    return this.mutate("discountCodeBasicCreate", DISCOUNT_CREATE_MUTATION, {
      basicCodeDiscount: compact({
        title: params.title,
        code: params.code,
        startsAt: params.startsAt ?? new Date().toISOString(),
        endsAt: params.endsAt,
        usageLimit: params.usageLimit,
        appliesOncePerCustomer: params.appliesOncePerCustomer,
        // Who the discount is for lives in `context`, not in the
        // `customerSelection` field older guides describe — that field is
        // absent from DiscountCodeBasicInput here, so sending it failed the
        // whole mutation. `all` is the DiscountBuyerSelection enum, whose only
        // value is ALL.
        context: { all: "ALL" },
        customerGets: { value, items: { all: true } },
      }),
    });
  }
}

/** The cost block of a response body, flattened, or null when absent. */
function costInfo(body: unknown): CostInfo | null {
  const cost = (body as { extensions?: { cost?: unknown } } | null | undefined)?.extensions?.cost;
  if (!cost || typeof cost !== "object") return null;
  const c = cost as {
    actualQueryCost?: unknown;
    throttleStatus?: { currentlyAvailable?: unknown; maximumAvailable?: unknown; restoreRate?: unknown };
  };
  const throttle = c.throttleStatus ?? {};
  return {
    actualQueryCost: typeof c.actualQueryCost === "number" ? c.actualQueryCost : null,
    currentlyAvailable: numberOr(throttle.currentlyAvailable, 0),
    maximumAvailable: numberOr(throttle.maximumAvailable, 0),
    restoreRate: numberOr(throttle.restoreRate, 0),
  };
}

/** `requestedQueryCost` of a response body — what a THROTTLED query would have cost. */
function requestedCost(body: unknown): number | undefined {
  const cost = (body as { extensions?: { cost?: { requestedQueryCost?: unknown } } } | null | undefined)?.extensions
    ?.cost;
  return typeof cost?.requestedQueryCost === "number" ? cost.requestedQueryCost : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A non-null plain object — what both a GraphQL body and its `data` must be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a response body, degrading to the raw text (or undefined when empty). */
function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Drops keys whose value is `undefined` so they are not sent to the API. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
