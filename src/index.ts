#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ShopifyAdminClient } from "./client.js";
import { authMode, ConfigError, DEFAULT_API_VERSION, describeTarget, hasCredentials, loadConfig } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";
import type { ShopifyAdminConfig } from "./types.js";
import { registerShopTools } from "./tools/shop.js";
import { registerProductTools } from "./tools/products.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerDiscountTools } from "./tools/discounts.js";
import { registerRawTool } from "./tools/raw.js";

/**
 * Prose handed to the calling model in the `initialize` result, before it picks
 * a tool. It carries only what the tool list cannot: which store the server is
 * bound to, where the surface ends and what covers the rest, what a call costs,
 * and the two auth facts that cost the most blind probes (ACCESS_DENIED is a
 * scope, not the token; mutations fail inside HTTP 200). It is prepended to
 * every session's context, so it stays short and states no fact that is not
 * already proven in the repo.
 */
const INSTRUCTIONS =
  "Shopify Admin API одного магазина: сервер привязан к SHOPIFY_STORE_DOMAIN, ни один инструмент " +
  "не переопределяет магазин. Товары, заказы, клиенты, остатки и скидки покрыты инструментами; " +
  "всё остальное (метаполя, медиа, коллекции, вебхуки, bulk-операции) доступно через " +
  "graphql_request — произвольный GraphQL-документ, помеченный destructive. Права ограничены " +
  "scopes токена: ACCESS_DENIED в ошибке — не неверный токен, а отсутствующий scope у приложения; " +
  "401 — сами учётные данные (сервер сам обновляет токен, если задана пара CLIENT_ID/CLIENT_SECRET). " +
  "Учёт вызовов — cost-бакет GraphQL, восстанавливаемый restoreRate очков в " +
  "секунду; каждый ответ несёт cost с остатком currentlyAvailable, и по нему стоит рассчитывать " +
  "вызовы: одна страница first до 250 дешевле многих мелких. Мутации возвращают HTTP 200 даже при " +
  "провале — вердикт лежит в userErrors; инструменты превращают его в ошибку, но в graphql_request " +
  "его нужно проверять самому. cancel_order необратим и требует явных решений refund и restock; " +
  "заказы старше 60 дней видны только со scope read_all_orders.";

/**
 * Prepended to INSTRUCTIONS when a credential is missing. The model reads this
 * before it picks a tool, so an unconfigured session opens with the fix rather
 * than with a failed call. There is no in-chat login: credentials come only
 * from the environment, so the fix is the operator's — set the variables and
 * restart the server.
 */
const UNCONFIGURED_PREFIX =
  "ВНИМАНИЕ: Shopify ещё не подключён — не задан SHOPIFY_STORE_DOMAIN и/или учётные данные, поэтому " +
  "любой вызов инструмента вернёт ошибку. Подключиться из диалога нельзя: оператор должен создать и " +
  "установить приложение через Shopify Dev Dashboard или Shopify CLI, выдать ему нужные Admin API " +
  "access scopes (например read_products, write_products, read_orders, read_customers), а затем " +
  "задать SHOPIFY_STORE_DOMAIN (домен вида my-store.myshopify.com) и пару SHOPIFY_CLIENT_ID / " +
  "SHOPIFY_CLIENT_SECRET этого приложения — сервер сам обменяет их на токен и будет обновлять его. " +
  "Приложение и магазин должны быть в одной организации Shopify. Если у вас сохранилось приложение, " +
  "созданное в админке магазина до 2026-01-01, можно вместо пары задать готовый SHOPIFY_ACCESS_TOKEN; " +
  "такой токен сервер не обновляет. Переменные читаются только при старте: после правки нужно " +
  "перезапустить сервер. ";

/**
 * Used instead of {@link UNCONFIGURED_PREFIX} when a *malformed* value is what
 * degraded the config. Saying "credentials are missing" would be false and
 * actively misleading here — they are usually set correctly, and one other
 * variable is broken — so the problem leads and the fix is scoped to it.
 */
const configProblemPrefix = (message: string): string =>
  `ВНИМАНИЕ: Shopify не подключён из-за ошибки конфигурации, поэтому любой вызов инструмента вернёт ` +
  `ошибку. Проблема конфигурации: ${message} Остальные переменные при этом могут быть заданы верно — ` +
  `исправить нужно именно названную. Переменные читаются только при старте: после правки нужно ` +
  `перезапустить сервер. `;

/** Reads the package version so the server reports its real version to MCP clients. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Loads the config without dying on a bad value. A server that exits here never
 * completes the MCP handshake, so the user sees a dead server and no reason —
 * instead the problem is carried into the session, where the model can read it
 * and relay it. (Missing credentials are not an error at all — loadConfig
 * leaves the fields undefined; a *malformed* value still throws ConfigError,
 * caught here: the config degrades to "no credentials" and every tool call
 * answers with CredentialsError.)
 */
function loadConfigOrDegraded(telemetry: Telemetry): {
  config: ShopifyAdminConfig;
  problem?: ConfigError;
} {
  try {
    return { config: loadConfig() };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Ошибка конфигурации: ${err.message}`);
    // Fire-and-forget now that the process survives: the `startup_failed`
    // funnel stays comparable across the server line, but nothing blocks startup.
    telemetry.send("startup_failed", { reason: err.reason });
    return {
      // No endpoint on purpose: with the domain possibly being the malformed
      // value, there is no host left to trust — and no request goes out anyway,
      // credentials are gone. `configProblem` rides along so a tool call can
      // report the variable that actually broke rather than the credentials.
      config: { apiVersion: DEFAULT_API_VERSION, configProblem: err.message },
      problem: err,
    };
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so missing
  // credentials can be reported; wired to the server before tools register.
  const version = readVersion();
  const telemetry = new Telemetry(version);
  const { config, problem } = loadConfigOrDegraded(telemetry);
  // The User-Agent is set here because this is the only place that knows the
  // package version; Shopify sees an identified client instead of Node's "node".
  const client = new ShopifyAdminClient({ ...config, userAgent: `mcp-shopify-admin/${version}` });

  // Credentials come only from the environment, so this cannot change
  // mid-session: an unconfigured start stays unconfigured until the operator
  // sets the variables and restarts the server.
  const connected = hasCredentials(config);

  const server = new McpServer(
    {
      name: "mcp-shopify-admin",
      version,
    },
    // `instructions` rides in the initialize result, so the model reads it once
    // per session before any tool call — the only prose it is guaranteed to see.
    // An unconfigured session opens with the fix (and the config problem, when
    // a malformed value is what got us here) before the briefing.
    {
      instructions: connected
        ? INSTRUCTIONS
        : (problem ? configProblemPrefix(problem.message) : UNCONFIGURED_PREFIX) + INSTRUCTIONS,
    },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    // Split on purpose: `server_start` keeps meaning "a usable install started",
    // so the unconfigured case gets its own event instead of inflating that
    // number. With both variables absent the domain wins, matching the check
    // order of the combined credentials message.
    if (connected) telemetry.send("server_start");
    else {
      telemetry.send("unconfigured_start", {
        reason: problem?.reason ?? (!config.endpoint ? "missing_store_domain" : "missing_credentials"),
      });
    }
  };

  registerShopTools(server, client);
  registerProductTools(server, client);
  registerOrderTools(server, client);
  registerCustomerTools(server, client);
  registerInventoryTools(server, client);
  registerDiscountTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    connected
      ? // describeTarget, never the raw endpoint: this line lands in the host's
        // log file, and a URL may carry credentials of its own. The auth mode
        // is named because the two behave differently when a token goes stale.
        `mcp-shopify-admin работает через stdio (магазин ${describeTarget(config)}, API ${config.apiVersion}, ` +
          `авторизация: ${authMode(config) === "client_credentials" ? "client_credentials, токен обновляется автоматически" : "готовый токен, обновление на стороне оператора"})`
      : problem
        ? // This line is what the operator finds in the host's log; telling them
          // to set variables they already set sends them the wrong way.
          `mcp-shopify-admin работает через stdio (не подключён из-за ошибки конфигурации: ${problem.message} ` +
          "Исправьте эту переменную и перезапустите сервер)"
        : "mcp-shopify-admin работает через stdio (креденшелы не заданы — задайте SHOPIFY_STORE_DOMAIN " +
          "и пару SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET и перезапустите сервер)",
  );
}

main().catch((err) => {
  console.error("Критическая ошибка запуска mcp-shopify-admin:", err);
  process.exit(1);
});
