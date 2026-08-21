import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShopifyAdminClient } from "../client.js";
import { cursor, entityId, fail, ok, pageSize, READ_ONLY, searchQuery } from "./util.js";

/**
 * Customer tools — read-only on purpose: customer records are PII, and
 * creating, editing or deleting them is left to graphql_request, where the
 * destructive annotation makes the client ask first. Needs `read_customers`.
 */
export function registerCustomerTools(server: McpServer, client: ShopifyAdminClient): void {
  server.registerTool(
    "list_customers",
    {
      title: "Список клиентов",
      annotations: READ_ONLY,
      description:
        'Возвращает страницу клиентов (имя, email, телефон, число заказов, потраченная сумма, город) плюс count — число клиентов под тем же фильтром. Пагинация курсорная: hasNextPage/endCursor в ответе, следующий вызов передаёт endCursor в after. query — строка поиска Shopify: "email:ivan@example.com", "phone:+79001234567", "state:enabled", "created_at:>=2026-01-01". Клиентов не создаёт и не меняет — записи с персональными данными изменяются только через graphql_request. Нужен scope read_customers.',
      inputSchema: {
        first: pageSize().optional().describe("Размер страницы, 1..250. По умолчанию 20."),
        after: cursor().optional().describe("endCursor предыдущей страницы — продолжить с него."),
        query: searchQuery()
          .optional()
          .describe('Строка поиска Shopify: "email:ivan@example.com", "state:enabled", "created_at:>=2026-01-01".'),
      },
    },
    async ({ first, after, query }) => {
      try {
        return ok(await client.listCustomers({ first, after, query }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_customer",
    {
      title: "Карточка клиента",
      annotations: READ_ONLY,
      description:
        "Возвращает одного клиента целиком: контакты, адреса, заметку, теги и его 10 последних заказов с суммами. Принимает числовой id или gid://shopify/Customer/<id>; клиент по email ищется через list_customers с query \"email:...\". Несуществующий клиент — это data: null, а не ошибка.",
      inputSchema: {
        id: entityId().describe("Id клиента: число или gid://shopify/Customer/<id>."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.getCustomer(id));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
