import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyAdminClient } from "../client.js";
import { CREATE, cursor, fail, isoDateTime, moneyAmount, ok, pageSize, READ_ONLY, searchQuery } from "./util.js";

/**
 * Discount tools: the directory plus one well-shaped create — a basic code
 * discount for all customers on all items. Targeted discounts (specific
 * collections, customer segments, BXGY, free shipping) and deactivation are
 * graphql_request territory; a narrow create keeps the fail-shaped inputs out.
 * Needs `read_discounts` / `write_discounts`.
 */
export function registerDiscountTools(server: McpServer, client: ShopifyAdminClient): void {
  server.registerTool(
    "list_discounts",
    {
      title: "Список скидок",
      annotations: READ_ONLY,
      description:
        'Возвращает страницу скидок магазина — промокодных и автоматических: тип (__typename), название, статус, период действия, лимит использований, для кодовых — до 5 кодов и счётчик применений. Пагинация курсорная (hasNextPage/endCursor → after). query — строка поиска Shopify: "status:active", "type:code", "title:BLACKFRIDAY". Ничего не создаёт и не выключает.',
      inputSchema: {
        first: pageSize().optional().describe("Размер страницы, 1..250. По умолчанию 20."),
        after: cursor().optional().describe("endCursor предыдущей страницы — продолжить с него."),
        query: searchQuery().optional().describe('Строка поиска Shopify: "status:active", "type:code", "title:BLACKFRIDAY".'),
      },
    },
    async ({ first, after, query }) => {
      try {
        return ok(await client.listDiscounts({ first, after, query }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_basic_discount",
    {
      title: "Создать промокод",
      annotations: CREATE,
      description:
        'Создаёт базовую промокодную скидку: один код, процент (percentage, доля 0..1: 0.2 = −20%) ИЛИ фиксированная сумма (amount в валюте магазина) — ровно одно из двух, для всех клиентов на все товары. startsAt по умолчанию — сейчас, то есть код начинает действовать немедленно; отложенный запуск задаётся явным startsAt. usageLimit — общий лимит применений, appliesOncePerCustomer — не больше раза на клиента. Скидки на отдельные коллекции/сегменты, BXGY и бесплатная доставка здесь не создаются (graphql_request), выключение скидки — тоже. Повторный вызов с тем же кодом провалится userErrors: код должен быть уникален.',
      inputSchema: {
        title: z.string().min(1).describe("Внутреннее название скидки (видно в админке)."),
        code: z.string().min(1).describe("Промокод, который вводит покупатель, например BLACKFRIDAY. Уникален в магазине."),
        percentage: z
          .number()
          .gt(0)
          .max(1)
          .optional()
          .describe("Доля скидки 0..1 (0.2 = −20%). Ровно одно из percentage/amount."),
        amount: moneyAmount().optional().describe('Фиксированная сумма скидки в валюте магазина, например "500.00".'),
        startsAt: isoDateTime().optional().describe("Начало действия, ISO-8601. По умолчанию — немедленно."),
        endsAt: isoDateTime().optional().describe("Конец действия, ISO-8601. Без него скидка бессрочная."),
        usageLimit: z.number().int().positive().optional().describe("Общий лимит применений кода."),
        appliesOncePerCustomer: z.boolean().optional().describe("Не больше одного применения на клиента."),
      },
    },
    async ({ title, code, percentage, amount, startsAt, endsAt, usageLimit, appliesOncePerCustomer }) => {
      try {
        return ok(
          await client.createBasicDiscountCode({
            title,
            code,
            percentage,
            amount,
            startsAt,
            endsAt,
            usageLimit,
            appliesOncePerCustomer,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
