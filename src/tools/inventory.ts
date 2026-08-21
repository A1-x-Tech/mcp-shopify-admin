import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyAdminClient } from "../client.js";
import { entityId, fail, inventoryReasonEnum, ok, pageSize, READ_ONLY, WRITE } from "./util.js";

/**
 * Inventory tools: the locations directory and one write — setting absolute
 * available quantities. Both ids the write needs come from other tools here:
 * inventoryItemId from get_product's variants, locationId from list_locations
 * (or get_shop). Needs `read_locations` / `write_inventory`.
 */
export function registerInventoryTools(server: McpServer, client: ShopifyAdminClient): void {
  server.registerTool(
    "list_locations",
    {
      title: "Список локаций",
      annotations: READ_ONLY,
      description:
        "Возвращает локации магазина (склады и точки), включая неактивные: id, название, адрес, активность, выполняет ли онлайн-заказы. Именно id локации нужен инструменту set_inventory. У большинства магазинов локаций одна-две, так что страницы по умолчанию хватает.",
      inputSchema: {
        first: pageSize().optional().describe("Размер страницы, 1..250. По умолчанию 20."),
      },
    },
    async ({ first }) => {
      try {
        return ok(await client.listLocations(first));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_inventory",
    {
      title: "Задать остатки",
      annotations: WRITE,
      description:
        'Устанавливает АБСОЛЮТНЫЙ доступный остаток (available) позиций на локациях — «стало N», не «изменить на N»: повторный вызов с теми же числами ничего не меняет. Каждый элемент quantities несёт inventoryItemId (id inventoryItem варианта — он в ответе get_product, это НЕ id варианта), locationId (из list_locations) и quantity >= 0. reason — из закрытого словаря Shopify, по умолчанию correction. Историю движений не пишет и резервы не трогает. Провал приходит как ошибка с userErrors — например, если позиция не отслеживается (inventory tracking выключен) или не привязана к локации.',
      inputSchema: {
        quantities: z
          .array(
            z.object({
              inventoryItemId: entityId().describe(
                "Id inventoryItem варианта: число или gid://shopify/InventoryItem/<id> (из get_product, поле variants[].inventoryItem.id).",
              ),
              locationId: entityId().describe("Id локации: число или gid://shopify/Location/<id> (из list_locations)."),
              quantity: z.number().int().min(0).describe("Новый доступный остаток, целое >= 0."),
            }),
          )
          .min(1)
          .max(250)
          .describe("Позиции и их новые абсолютные остатки."),
        reason: inventoryReasonEnum()
          .optional()
          .describe("Причина изменения из словаря Shopify (correction, received, damaged, restock, …). По умолчанию correction."),
      },
    },
    async ({ quantities, reason }) => {
      try {
        return ok(await client.setInventoryQuantities({ quantities, reason }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
