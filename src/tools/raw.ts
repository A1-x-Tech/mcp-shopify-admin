import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyAdminClient } from "../client.js";
import { DESTRUCTIVE, fail, ok } from "./util.js";

/**
 * The escape hatch: an arbitrary GraphQL document against the Admin API. One
 * tool instead of a growing pile of one-off wrappers — and DESTRUCTIVE,
 * because nothing stops the document from being a mutation.
 */
export function registerRawTool(server: McpServer, client: ShopifyAdminClient): void {
  server.registerTool(
    "graphql_request",
    {
      title: "Произвольный GraphQL-запрос",
      annotations: DESTRUCTIVE,
      description:
        "Выполняет произвольный GraphQL-документ против Admin API магазина — для всего, чему нет отдельного инструмента (метаполя, медиа, коллекции, вебхуки, сегменты, bulk-операции). Токен, магазин и версию API подставляет сервер; переменные — через variables. Помечен destructive, потому что документ может быть мутацией; query безопасен. ВАЖНО: у мутаций Shopify HTTP 200 не значит успех — реальный вердикт в userErrors внутри data, и здесь он возвращается как есть, без интерпретации: поле userErrors нужно проверить самому. Ретраев для мутаций нет (повтор мог бы применить изменение дважды); THROTTLED повторяется сам после паузы. Стоимость запроса видна в cost ответа — глубокие вложенные выборки стоят дорого, а дороже 1000 очков запрос отклоняется валидатором Shopify.",
      inputSchema: {
        query: z.string().min(1).describe('GraphQL-документ, например "query { shop { name } }" или мутация.'),
        variables: z.record(z.any()).optional().describe("Переменные документа, объект JSON."),
      },
    },
    async ({ query, variables }) => {
      try {
        return ok(await client.request(query, variables));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
