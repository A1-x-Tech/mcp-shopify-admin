import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShopifyAdminClient } from "../client.js";
import { fail, ok, READ_ONLY } from "./util.js";

/**
 * Shop-level tools: which store the server is bound to and its baseline facts.
 *
 * The store is never a tool argument — it comes from `SHOPIFY_STORE_DOMAIN`
 * via the config, and the token is minted for exactly that store.
 */
export function registerShopTools(server: McpServer, client: ShopifyAdminClient): void {
  server.registerTool(
    "get_shop",
    {
      title: "Данные магазина",
      annotations: READ_ONLY,
      description:
        "Возвращает магазин, к которому привязан сервер: название, myshopifyDomain, основной домен витрины, валюту, тариф (plan), контактный email, часовой пояс, число товаров и список локаций (id локаций нужны инструменту set_inventory). Аргументов не принимает — магазин задан в SHOPIFY_STORE_DOMAIN и не выбирается для отдельного вызова. Как и у всех инструментов здесь, в ответе есть cost: состояние cost-бакета GraphQL (actualQueryCost — сколько стоил запрос, currentlyAvailable/maximumAvailable — остаток и размер бакета, restoreRate — восстановление в секунду).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.getShop());
      } catch (e) {
        return fail(e);
      }
    },
  );
}
