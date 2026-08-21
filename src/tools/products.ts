import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyAdminClient } from "../client.js";
import {
  CREATE,
  cursor,
  entityId,
  fail,
  moneyAmount,
  ok,
  pageSize,
  productStatusEnum,
  READ_ONLY,
  searchQuery,
  WRITE,
} from "./util.js";

/**
 * Product tools: list/read, create, update, and variant price changes.
 *
 * The API's variant model draws the line for us: `create_product` creates the
 * product only (Shopify adds the default variant itself), and variant *prices*
 * change through `update_variant` — creating or deleting variants, images and
 * inventory-item fields are not exposed here (graphql_request covers them).
 */
export function registerProductTools(server: McpServer, client: ShopifyAdminClient): void {
  server.registerTool(
    "list_products",
    {
      title: "Список товаров",
      annotations: READ_ONLY,
      description:
        'Возвращает страницу товаров магазина (id, название, handle, статус, вендор, тип, теги, общий остаток, до 5 вариантов с ценами) плюс count — число товаров под тем же фильтром. Пагинация курсорная: в ответе pageInfo-поля hasNextPage и endCursor, следующий вызов передаёт endCursor в after; параметра "номер страницы" у Shopify нет. query — строка поиска Shopify, например "status:active", "vendor:Nike created_at:>=2026-01-01", "title:*shirt*". Страница first до 250 за один вызов дешевле по cost-бакету, чем много мелких страниц.',
      inputSchema: {
        first: pageSize().optional().describe("Размер страницы, 1..250. По умолчанию 20."),
        after: cursor().optional().describe("endCursor предыдущей страницы — продолжить с него."),
        query: searchQuery()
          .optional()
          .describe('Строка поиска Shopify, как есть: "status:active", "vendor:Nike", "tag:sale", "created_at:>=2026-01-01".'),
      },
    },
    async ({ first, after, query }) => {
      try {
        return ok(await client.listProducts({ first, after, query }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Карточка товара",
      annotations: READ_ONLY,
      description:
        "Возвращает один товар целиком: описание (HTML), опции, до 100 вариантов с ценами, остатками, SKU и id inventoryItem (этот id нужен инструменту set_inventory). Принимает числовой id или gid://shopify/Product/<id>. Несуществующий товар — это data: null, а не ошибка. Медиафайлы и метаполя не возвращает — за ними graphql_request.",
      inputSchema: {
        id: entityId().describe("Id товара: число или gid://shopify/Product/<id>."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.getProduct(id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_product",
    {
      title: "Создать товар",
      annotations: CREATE,
      description:
        'Создаёт товар и возвращает его с дефолтным вариантом, который Shopify добавляет сам. Товар НЕ появляется на витрине: созданные через API товары не опубликованы ни в одном канале продаж, и публикация делается отдельной операцией publishablePublish (её здесь нет — только через graphql_request). Статус по умолчанию — ACTIVE, но это не публикация: status: "DRAFT" дополнительно помечает товар черновиком. Цена задаётся следующим вызовом update_variant по id созданного дефолтного варианта (он есть в ответе). Варианты, изображения и остатки этот инструмент не создаёт. Повторный вызов создаст второй такой же товар. Провал приходит как ошибка с userErrors — HTTP-статус Shopify всегда 200.',
      inputSchema: {
        title: z.string().min(1).describe("Название товара."),
        descriptionHtml: z.string().optional().describe("Описание в HTML."),
        vendor: z.string().optional().describe("Вендор/бренд."),
        productType: z.string().optional().describe("Тип товара в свободной форме."),
        tags: z.array(z.string()).optional().describe("Теги."),
        status: productStatusEnum()
          .optional()
          .describe(
            "ACTIVE (по умолчанию; товар всё равно не опубликован в каналах продаж) | DRAFT (черновик) | ARCHIVED.",
          ),
      },
    },
    async ({ title, descriptionHtml, vendor, productType, tags, status }) => {
      try {
        return ok(await client.createProduct({ title, descriptionHtml, vendor, productType, tags, status }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_product",
    {
      title: "Изменить товар",
      annotations: WRITE,
      description:
        "Перезаписывает переданные поля товара (название, описание, вендор, тип, теги, статус) и не трогает остальные. tags замещают весь список тегов, а не добавляются к нему. Цены и остатки здесь не меняются — цены через update_variant, остатки через set_inventory. status: DRAFT снимает товар с витрины, ARCHIVED архивирует (обратимо — вернуть можно, снова передав ACTIVE). Провал приходит как ошибка с userErrors.",
      inputSchema: {
        id: entityId().describe("Id товара: число или gid://shopify/Product/<id>."),
        title: z.string().min(1).optional().describe("Новое название."),
        descriptionHtml: z.string().optional().describe("Новое описание в HTML."),
        vendor: z.string().optional().describe("Новый вендор."),
        productType: z.string().optional().describe("Новый тип."),
        tags: z.array(z.string()).optional().describe("Полный новый список тегов (замещает старый)."),
        status: productStatusEnum().optional().describe("ACTIVE | DRAFT | ARCHIVED."),
      },
    },
    async ({ id, title, descriptionHtml, vendor, productType, tags, status }) => {
      try {
        return ok(await client.updateProduct({ id, title, descriptionHtml, vendor, productType, tags, status }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_variant",
    {
      title: "Изменить цены варианта",
      annotations: WRITE,
      description:
        'Задаёт цену и/или зачёркнутую цену (compareAtPrice) вариантам одного товара — до 250 вариантов за вызов, каждый элемент variants несёт id варианта и новые значения. Суммы — десятичные строки в валюте магазина ("1999.00"); compareAtPrice: null убирает зачёркнутую цену. Больше ничего в варианте не меняет (SKU, штрихкод, опции — через graphql_request). Требуется id товара-родителя: он есть в ответах list_products и get_product. Провал приходит как ошибка с userErrors.',
      inputSchema: {
        productId: entityId().describe("Id товара-родителя: число или gid://shopify/Product/<id>."),
        variants: z
          .array(
            z.object({
              id: entityId().describe("Id варианта: число или gid://shopify/ProductVariant/<id>."),
              price: moneyAmount().optional().describe('Новая цена, например "1999.00".'),
              compareAtPrice: moneyAmount()
                .nullable()
                .optional()
                .describe('Зачёркнутая цена "до скидки"; null — убрать её.'),
            }),
          )
          .min(1)
          .max(250)
          .describe("Варианты одного товара с новыми ценами."),
      },
    },
    async ({ productId, variants }) => {
      try {
        return ok(await client.updateVariants(productId, variants));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
