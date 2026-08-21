# <img src="./assets/a1-logo.svg" alt="A1" width="40"> Shopify Admin MCP

[![npm](https://img.shields.io/npm/v/mcp-shopify-admin)](https://www.npmjs.com/package/mcp-shopify-admin)
[![CI](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin/badges/score.svg)](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A1 Shopify Admin MCP** подключает AI-приложение к админке магазина Shopify через Admin API (GraphQL). Он помогает работать с товарами и ценами, заказами, клиентами, остатками и промокодами — на естественном языке.

Сервер привязан к одному магазину: домен задан конфигурацией, токен — Admin API access token кастомного приложения, и ни один инструмент не может уйти в чужой магазин.

- **16 инструментов.** Магазин, товары и варианты, заказы, клиенты, локации и остатки, скидки — плюс произвольный GraphQL-запрос для всего остального.
- **Честные HTTP 200.** Мутации Shopify возвращают 200 даже при провале; сервер читает `userErrors` и превращает отказ в понятную ошибку.
- **Необратимые операции видны.** Отмена заказа (с решениями о возврате денег и товара) и произвольный GraphQL помечены как destructive.
- **Cost-бакет под контролем.** Каждый ответ несёт `cost`: сколько стоил запрос и сколько очков осталось в бакете GraphQL.

Начните с запроса, который только читает данные:

> Покажи последние заказы магазина и топ товаров с остатками.

[Подключить сервер](#быстрый-старт) · [Посмотреть сценарии](#что-можно-поручить) · [Открыть техническую документацию](#техническая-документация)

---

## Увидеть работу за минуту

> **Вы:** Покажи последние заказы магазина и топ товаров с остатками.
>
> **Ассистент:** Показывает заказы со статусами и суммами, товары с ценами и остатками. Ничего не меняется.
>
> **Вы:** Подготовь скидку 20% по промокоду SUMMER на две недели.
>
> **Ассистент:** Показывает параметры будущего промокода — код, размер, срок, лимиты — и запрашивает подтверждение.
>
> **Вы:** Подтверждаю.

- [Быстрый старт](#быстрый-старт)
- [Что можно поручить](#что-можно-поручить)
- [Что может измениться](#что-может-измениться)
- [Получение доступа](#получение-доступа)
- [Настройка](#настройка)
- [Данные, лимиты и работа в фоне](#данные-лимиты-и-работа-в-фоне)
- [Техническая документация](#техническая-документация)
- [Поддержка](#поддержка)

## Быстрый старт

Нужны Node.js 20+, домен магазина вида `my-store.myshopify.com` и Admin API access token кастомного приложения (`shpat_…`). Для создания приложения нужны права владельца магазина или staff-права на разработку приложений.

1. [Получите доступ](#получение-доступа).
2. Добавьте сервер в AI-приложение.
3. Отправьте безопасный первый запрос выше.

<details open><summary><strong>Codex</strong></summary>

<br>

В **Settings → Plugins → MCP servers** нажмите **Add server**, затем добавьте `npx -y mcp-shopify-admin@latest` с `SHOPIFY_STORE_DOMAIN` и `SHOPIFY_ACCESS_TOKEN`.

```bash
codex mcp add shopify-admin \
  --env SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  --env SHOPIFY_ACCESS_TOKEN=shpat_your_token \
  -- npx -y mcp-shopify-admin@latest
codex mcp list
```

[Документация Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

</details>

<details><summary><strong>Claude Code</strong></summary>

<br>

```bash
claude mcp add \
  --env SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  --env SHOPIFY_ACCESS_TOKEN=shpat_your_token \
  --transport stdio --scope user shopify-admin \
  -- npx -y mcp-shopify-admin@latest
claude mcp list
```

[Документация Claude Code MCP](https://code.claude.com/docs/en/mcp)

</details>

<details><summary><strong>Claude Desktop</strong></summary>

<br>

Откройте **Settings → Developer → Edit Config** и добавьте:

```json
{"mcpServers":{"shopify-admin":{"command":"npx","args":["-y","mcp-shopify-admin@latest"],"env":{"SHOPIFY_STORE_DOMAIN":"my-store.myshopify.com","SHOPIFY_ACCESS_TOKEN":"shpat_your_token"}}}}
```

Если **Edit Config** недоступна, отредактируйте `~/Library/Application Support/Claude/claude_desktop_config.json` на macOS или `%APPDATA%\Claude\claude_desktop_config.json` на Windows. [Документация Claude Desktop MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

</details>

<details><summary><strong>Cursor</strong></summary>

<br>

Добавьте `{"mcpServers":{"shopify-admin":{"type":"stdio","command":"npx","args":["-y","mcp-shopify-admin@latest"],"env":{"SHOPIFY_STORE_DOMAIN":"my-store.myshopify.com","SHOPIFY_ACCESS_TOKEN":"shpat_your_token"}}}}` в `~/.cursor/mcp.json` на macOS/Linux или `%USERPROFILE%\.cursor\mcp.json` на Windows. [Документация Cursor MCP](https://cursor.com/docs/mcp)

</details>

<details><summary><strong>VS Code</strong></summary>

<br>

Запустите **MCP: Open User Configuration** и добавьте:

```json
{"servers":{"shopify-admin":{"type":"stdio","command":"npx","args":["-y","mcp-shopify-admin@latest"],"env":{"SHOPIFY_STORE_DOMAIN":"${input:shopify_store_domain}","SHOPIFY_ACCESS_TOKEN":"${input:shopify_access_token}"}}},"inputs":[{"type":"promptString","id":"shopify_store_domain","description":"Домен магазина my-store.myshopify.com"},{"type":"promptString","id":"shopify_access_token","description":"Admin API access token (shpat_…)","password":true}]}
```

Проверьте сервер командой **MCP: List Servers**. [Документация VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers)

</details>

## Что можно поручить

- Покажи заказы за неделю, их статусы оплаты и выдачи.
- Найди товары без остатков и подними цены выбранных вариантов.
- Заведи новый товар черновиком и заполни описание.
- Поставь фактические остатки после инвентаризации.
- Создай промокод на распродажу с лимитом применений.
- Найди клиента по email и покажи его последние заказы.

## Что может измениться

| Операция | Что происходит | Граница подтверждения |
|---|---|---|
| Магазин, товары, заказы, клиенты, локации, скидки | Читает данные магазина | Ничего не меняет |
| Изменение товара или цен вариантов | Перезаписывает переданные поля | Меняет витрину |
| Установка остатков | Задаёт абсолютный доступный остаток | Меняет доступность товаров |
| Создание товара или промокода | Создаёт новую запись | Необратимо создаёт объект |
| Отмена заказа | Отменяет заказ, опционально возвращая деньги и товар | Разрушительно и необратимо |
| GraphQL-запрос | Может выполнить любую мутацию Admin API | Потенциально разрушительно |

Создание заказов, выполнение отгрузок, изменение клиентов и удаление объектов не входят в набор инструментов — при необходимости это делается через `graphql_request` с явным подтверждением.

## Получение доступа

1. Откройте админку магазина: **Settings → Apps and sales channels → Develop apps** (включите разработку приложений, если она выключена).
2. Создайте приложение и на вкладке **Configuration** выдайте нужные Admin API access scopes: `read_products`/`write_products`, `read_orders`, `read_customers`, `read_locations`/`write_inventory`, `read_discounts`/`write_discounts` — по вашим сценариям.
3. Установите приложение и на вкладке **API credentials** скопируйте **Admin API access token** (`shpat_…`; показывается один раз).
4. Передайте домен и токен как `SHOPIFY_STORE_DOMAIN` и `SHOPIFY_ACCESS_TOKEN`.

Токен статический и привязан к магазину. Храните его как пароль. Если позже выдать приложению новые scopes, Shopify выпустит новый токен — обновите переменную и перезапустите сервер. Для безопасных репетиций удобен [development store](https://shopify.dev/docs/api/development-stores).

## Настройка

| Переменная | Обязательна | Описание |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | Да | Домен `my-store.myshopify.com` (можно просто `my-store`). |
| `SHOPIFY_ACCESS_TOKEN` | Да | Admin API access token кастомного приложения. |
| `SHOPIFY_API_VERSION` | Нет | Квартальная версия `YYYY-MM` или `unstable`; по умолчанию `2026-01`. |
| `SHOPIFY_TIMEOUT_MS` | Нет | Тайм-аут запроса; по умолчанию `30000` мс. |
| `SHOPIFY_MAX_RETRIES` | Нет | Повторы THROTTLED/429; по умолчанию `4`. |

## Данные, лимиты и работа в фоне

- **Cost-бакет GraphQL.** Каждый запрос стоит очков по сложности; бакет восстанавливается каждую секунду. Одна страница `first` до 250 экономнее серии мелких; сервер показывает `cost` с каждым результатом.
- **Временные ошибки.** THROTTLED повторяется автоматически с ожиданием из математики бакета. Мутации не повторяются после сетевой или 5xx ошибки, чтобы не применить изменение дважды.
- **Заказы старше 60 дней** требуют scope `read_all_orders`, который Shopify выдаёт по запросу; без него старые заказы просто не приходят.
- **Постоянного наблюдения нет.** Сервер работает только при вызове. Если AI-приложение поддерживает задания по расписанию, оно может периодически проверять заказы и остатки.
- **Анонимная телеметрия.** В неё не попадают секреты, данные магазина, аргументы и промпты; отключение: `ASKADS_TELEMETRY=0`.

## Техническая документация

- [Каталог MCP-возможностей](./docs/capabilities/index.md) — страницы по пользовательским задачам для каждого инструмента.
- [Все инструменты и параметры](./docs/TOOLS.md)
- [Документация по разработке](./docs/DEVELOPMENT.md)
- [Документация по публикации](./docs/PUBLISHING.md)
- [Документация Shopify Admin API (GraphQL)](https://shopify.dev/docs/api/admin-graphql)

## Поддержка

Нашли ошибку или не хватает сценария? [Создайте issue](https://github.com/A1-x-Tech/mcp-shopify-admin/issues) или напишите в [Telegram](https://t.me/a1_mcp).

<br>

<p align="center">
  <img src="https://github.com/ztemerbekov/a1-yandex-kit-skills/raw/main/assets/images/mona-hifive-yandex-kit-warm.gif" alt="Две Моны дают пять" width="256">
</p>

<p align="center">
  Вы дочитали до конца!
</p>
