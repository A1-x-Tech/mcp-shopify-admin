import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyAdminClient } from "../client.js";
import { cursor, DESTRUCTIVE, entityId, fail, ok, orderCancelReasonEnum, pageSize, READ_ONLY, searchQuery } from "./util.js";

/**
 * Order tools: list, read, cancel. Creating, editing and fulfilling orders are
 * not exposed — the read side plus the one irreversible action agents actually
 * ask for. Everything needs the `read_orders` scope; older than 60 days
 * additionally needs `read_all_orders`, which Shopify grants by request.
 */
export function registerOrderTools(server: McpServer, client: ShopifyAdminClient): void {
  server.registerTool(
    "list_orders",
    {
      title: "Список заказов",
      annotations: READ_ONLY,
      description:
        'Возвращает страницу заказов, новые первыми (номер, дата, финансовый статус, статус выдачи, сумма, клиент) плюс count под тем же фильтром. Пагинация курсорная: hasNextPage/endCursor в ответе, следующий вызов передаёт endCursor в after. query — строка поиска Shopify: "financial_status:pending", "fulfillment_status:unfulfilled", "created_at:>=2026-08-01", "email:ivan@example.com". Нужен scope read_orders; заказы старше 60 дней требуют ещё read_all_orders — без него они просто не приходят.',
      inputSchema: {
        first: pageSize().optional().describe("Размер страницы, 1..250. По умолчанию 20."),
        after: cursor().optional().describe("endCursor предыдущей страницы — продолжить с него."),
        query: searchQuery()
          .optional()
          .describe('Строка поиска Shopify: "financial_status:paid", "fulfillment_status:unfulfilled", "created_at:>=2026-08-01".'),
      },
    },
    async ({ first, after, query }) => {
      try {
        return ok(await client.listOrders({ first, after, query }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "Карточка заказа",
      annotations: READ_ONLY,
      description:
        "Возвращает один заказ целиком: позиции (до 100), суммы (итог, доставка, возвраты), адрес доставки, заметку, теги, отгрузки с трек-номерами. Принимает числовой id или gid://shopify/Order/<id> — id, не «номер» вида #1001 (номер ищется через list_orders с query \"name:#1001\"). Несуществующий заказ — это data: null, а не ошибка.",
      inputSchema: {
        id: entityId().describe("Id заказа: число или gid://shopify/Order/<id> (не номер #1001)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.getOrder(id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Отменить заказ",
      annotations: DESTRUCTIVE,
      description:
        "НЕОБРАТИМО отменяет заказ. Два решения обязательны и не имеют значений по умолчанию: refund — вернуть ли деньги покупателю, restock — вернуть ли позиции на склад. notifyCustomer управляет письмом покупателю. Отмена выполняется фоновой задачей: в ответе job, а не обновлённый заказ — итог стоит проверить через get_order. Уже выданный (fulfilled) заказ Shopify отменить не даст — это придёт ошибкой userErrors. Расформировать отмену нельзя; частичные возвраты этот инструмент не делает.",
      inputSchema: {
        orderId: entityId().describe("Id заказа: число или gid://shopify/Order/<id>."),
        reason: orderCancelReasonEnum().describe(
          "Причина отмены: CUSTOMER (просьба покупателя), DECLINED (платёж отклонён), FRAUD, INVENTORY (нет товара), STAFF (ошибка персонала), OTHER.",
        ),
        refund: z.boolean().describe("Вернуть ли платёж покупателю. Обязательное решение."),
        restock: z.boolean().describe("Вернуть ли позиции заказа на склад. Обязательное решение."),
        notifyCustomer: z.boolean().optional().describe("Отправить ли покупателю письмо об отмене."),
        staffNote: z.string().optional().describe("Внутренняя заметка к отмене (покупателю не видна)."),
      },
    },
    async ({ orderId, reason, refund, restock, notifyCustomer, staffNote }) => {
      try {
        return ok(await client.cancelOrder({ orderId, reason, refund, restock, notifyCustomer, staffNote }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
