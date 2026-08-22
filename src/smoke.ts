#!/usr/bin/env node
/**
 * Live READ-ONLY smoke check against the configured Shopify store.
 *
 * Two of the cheapest calls the API has — the shop and one short page of
 * products — and not a single mutation: nothing is created, cancelled or
 * repriced. Orders and customers are deliberately not touched: their scopes
 * (read_orders, read_customers) are often absent on a fresh token, and the
 * smoke must prove the connection, not the widest grant. Run it with your own
 * credentials in the environment.
 *
 * Every call spends from the GraphQL cost bucket, so the remaining points are
 * printed after each step and again at the end — the bucket refills at
 * restoreRate points per second, so a passing smoke costs nothing lasting.
 */
import { ShopifyAdminClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { CredentialsError, ShopifyAdminError, type ApiResponse } from "./types.js";

/** Last bucket state the API reported, so the summary line can show where we landed. */
let lastAvailable: number | null = null;

/** Runs one step, printing the bucket state it came back with. */
async function step<T>(label: string, call: Promise<ApiResponse<T>>): Promise<T> {
  const res = await call;
  if (res.cost !== null) lastAvailable = res.cost.currentlyAvailable;
  const points = res.cost === null ? "не сообщён" : `${res.cost.currentlyAvailable}/${res.cost.maximumAvailable}`;
  console.log(`${label} — остаток cost-бакета: ${points}`);
  return res.data;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new ShopifyAdminClient(config);
  console.log(
    `Проверка Shopify Admin (только чтение) — магазин ${config.storeDomain ?? config.endpoint}, API ${config.apiVersion}\n`,
  );

  const shopData = await step("магазин  ", client.getShop());
  const shop = (shopData.shop ?? {}) as Record<string, unknown>;
  console.log(`           ${shop.name ?? "?"} (${shop.myshopifyDomain ?? "?"}, ${shop.currencyCode ?? "?"})`);
  console.log(`           товаров: ${shopData.productsCount ?? "?"}`);

  const products = await step("товары   ", client.listProducts({ first: 3 }));
  console.log(`           возвращено ${products.items.length} из ${products.count ?? "?"}`);
  for (const product of products.items) {
    console.log(`           - [${product.id ?? "?"}] ${product.title ?? ""} (${product.status ?? "?"})`);
  }

  const left = lastAvailable === null ? "не сообщён API" : `${lastAvailable} очков`;
  console.log(`\nПроверка пройдена. Остаток cost-бакета: ${left} (восстанавливается каждую секунду).`);
}

main().catch((err) => {
  // Missing or malformed credentials are a user error, not a bug: report them
  // without a stack. (Missing ones no longer fail loadConfig — they surface as
  // a CredentialsError on the first call instead.)
  if (err instanceof ConfigError || err instanceof CredentialsError) {
    console.error(`Проверку не запустить: ${err.message}`);
    console.error(
        "Нужно задать SHOPIFY_STORE_DOMAIN (домен вида my-store.myshopify.com) и SHOPIFY_ACCESS_TOKEN " +
        "(готовый Admin API access token Shopify).",
    );
    process.exit(1);
  }
  console.error(`\nПроверка ПРОВАЛЕНА: ${err instanceof Error ? err.message : String(err)}`);
  // The two failures that read wrong: a 404 is the store host (not a missing
  // entity), and ACCESS_DENIED is a scope (not the token).
  if (err instanceof ShopifyAdminError && err.status === 404) {
    console.error(
      "404 означает, что магазин не найден: SHOPIFY_STORE_DOMAIN должен быть постоянным доменом " +
        "вида my-store.myshopify.com, а не витринным доменом.",
    );
  }
  if (err instanceof ShopifyAdminError && err.code === "ACCESS_DENIED") {
    console.error(
      "ACCESS_DENIED означает, что у приложения нет scope read_products: выдайте его и переустановите приложение.",
    );
  }
  process.exit(1);
});
