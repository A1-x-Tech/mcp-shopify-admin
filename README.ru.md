# <img src="./assets/a1-logo.svg" alt="A1" width="40"> Shopify Admin MCP

[English](./README.md) | **Русский**

[![npm](https://img.shields.io/npm/v/mcp-shopify-admin)](https://www.npmjs.com/package/mcp-shopify-admin)
[![CI](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin/badges/score.svg)](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A1 Shopify Admin MCP** подключает AI-приложения к одному магазину Shopify через Admin API (GraphQL). Вы ставите задачу обычными словами: показать товары, заказы, клиентов, остатки или скидки — ассистент использует готовые инструменты сервера и возвращает результат.

- **Один магазин на сервер.** Домен магазина и учётные данные задаются в конфигурации; инструменты не могут переключиться на другой магазин.
- **Токен обновляется сам.** Укажите client ID и client secret приложения из Shopify Dev Dashboard — сервер сам получит access token, будет держать его только в памяти и заменит новым до истечения 24 часов. Готовый токен приложения, созданного в админке до 2026-01-01, тоже принимается.
- **16 готовых инструментов.** Данные магазина, товары, заказы, клиенты, локации, остатки и скидки — включая поддерживаемые операции создания и изменения.
- **Ошибки GraphQL не маскируются.** Shopify может вернуть HTTP 200 при ошибке мутации, поэтому сервер проверяет `userErrors` и отклоняет пустые или повреждённые ответы.
- **Стоимость вызова видна.** Каждый результат содержит состояние cost-бакета GraphQL: цену запроса и доступный остаток очков.
- **Риск обозначен явно.** Чтение ничего не меняет; изменение товара, цен, остатков и скидок видно отдельно; отмена заказа и произвольный GraphQL помечены как destructive.

Начните с безопасного запроса только на чтение:

> Покажи последние заказы и товары, по которым сейчас есть остатки.

[Подключить сервер](#быстрый-старт) · [Посмотреть сценарии](#что-можно-поручить) · [Открыть техническую документацию](#техническая-документация)

---

## Увидеть работу за минуту

> **Вы:** Покажи последние заказы и товары, по которым сейчас есть остатки.
>
> **Ассистент:** Показывает последние заказы со статусами и суммами, затем товары с ценами и остатками. Ничего не меняется.
>
> **Вы:** Подготовь скидку 20% по промокоду `SUMMER` на две недели.
>
> **Ассистент:** Показывает будущий код, процент, даты и лимиты, затем просит подтверждение перед созданием.
>
> **Вы:** Подтверждаю.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Что можно поручить](#что-можно-поручить)
- [Что может измениться в Shopify](#что-может-измениться-в-shopify)
- [Получение доступа](#получение-доступа)
- [Настройка](#настройка)
- [Данные, лимиты и работа в фоне](#данные-лимиты-и-работа-в-фоне)
- [Техническая документация](#техническая-документация)
- [Поддержка](#поддержка)

## Быстрый старт

Нужны Node.js 20+, домен магазина вида `my-store.myshopify.com` и учётные данные Shopify. Основной путь — client ID и client secret приложения из [Shopify Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard): сервер сам обменивает их на Admin API access token и обновляет его, пока работает, — это важно, потому что выданный по этому гранту токен живёт 24 часа. Приложение и магазин должны принадлежать одной организации Shopify. Если у вас сохранилось приложение, созданное в админке магазина до 2026-01-01, вместо пары можно задать его готовый токен в `SHOPIFY_ACCESS_TOKEN` — обновление тогда остаётся на вас.

1. [Получите доступ](#получение-доступа) и подготовьте client ID и client secret приложения.
2. Добавьте MCP-сервер в AI-приложение.
3. Отправьте безопасный запрос из начала README.

Сервер запускается локально через `npx` по протоколу stdio. Браузерные версии ChatGPT и Claude не могут напрямую запустить локальный stdio-процесс. Во всех примерах ниже указана пара client ID и client secret; если вы работаете с готовым токеном, задайте вместо неё `SHOPIFY_ACCESS_TOKEN` — см. [Получение доступа](#получение-доступа).

<details open>
<summary><strong>Codex</strong></summary>

<br>

**Через приложение:**

1. Откройте **Settings → MCP servers**.
2. Нажмите **Add server**.
3. Выберите **STDIO**, затем укажите `npx -y mcp-shopify-admin@latest` и задайте `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID` и `SHOPIFY_CLIENT_SECRET`.

4. Нажмите **Save**, затем **Restart**.

**Через командную строку:**

```bash
codex mcp add shopify-admin \
  --env SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  --env SHOPIFY_CLIENT_ID=your_client_id \
  --env SHOPIFY_CLIENT_SECRET=your_client_secret \
  -- npx -y mcp-shopify-admin@latest

codex mcp list
```

[Документация Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

</details>

<details>
<summary><strong>Claude Code</strong></summary>

<br>

```bash
claude mcp add \
  --env SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  --env SHOPIFY_CLIENT_ID=your_client_id \
  --env SHOPIFY_CLIENT_SECRET=your_client_secret \
  --transport stdio --scope user shopify-admin \
  -- npx -y mcp-shopify-admin@latest

claude mcp list
```

[Документация Claude Code MCP](https://code.claude.com/docs/en/mcp)

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

<br>

Актуальный официальный путь — **Settings → Extensions**. Для пользовательского desktop extension откройте **Advanced settings → Extension Developer → Install Extension…**, выберите файл `.mcpb` и следуйте подсказкам.

Этот репозиторий сейчас публикует npm-пакет со stdio и пока не содержит `.mcpb`. Поэтому используйте приведённый ниже JSON stdio-конфиг как fallback только в сборках Claude Desktop, где ещё поддерживается локальная конфигурация:

```json
{
  "mcpServers": {
    "shopify-admin": {
      "command": "npx",
      "args": ["-y", "mcp-shopify-admin@latest"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "my-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "your_client_id",
        "SHOPIFY_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

В таких сборках сохраните его в `~/Library/Application Support/Claude/claude_desktop_config.json` на macOS или `%APPDATA%\Claude\claude_desktop_config.json` на Windows.

[Документация Claude Desktop MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

</details>

<details>
<summary><strong>Cursor</strong></summary>

<br>

Добавьте сервер в `~/.cursor/mcp.json` на macOS/Linux или `%USERPROFILE%\.cursor\mcp.json` на Windows:

```json
{
  "mcpServers": {
    "shopify-admin": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-shopify-admin@latest"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "my-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "your_client_id",
        "SHOPIFY_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

[Документация Cursor MCP](https://cursor.com/docs/mcp)

</details>

<details>
<summary><strong>VS Code</strong></summary>

<br>

Выполните **MCP: Open User Configuration** и добавьте:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "shopify_store_domain",
      "description": "Домен Shopify, например my-store.myshopify.com"
    },
    {
      "type": "promptString",
      "id": "shopify_client_id",
      "description": "Client ID приложения Shopify"
    },
    {
      "type": "promptString",
      "id": "shopify_client_secret",
      "description": "Client secret приложения Shopify",
      "password": true
    }
  ],
  "servers": {
    "shopify-admin": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-shopify-admin@latest"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "${input:shopify_store_domain}",
        "SHOPIFY_CLIENT_ID": "${input:shopify_client_id}",
        "SHOPIFY_CLIENT_SECRET": "${input:shopify_client_secret}"
      }
    }
  }
}
```

Проверьте сервер через **MCP: List Servers**.

[Документация VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers)

</details>

## Что можно поручить

- **Посмотреть магазин.** Получить данные магазина, локации, товары, заказы, клиентов или скидки.
- **Работать с товарами.** Создать товар-черновик, изменить поля товара или цены вариантов.
- **Контролировать остатки.** Найти локации и установить абсолютное доступное количество товара.
- **Проверять заказы.** Искать заказы, открыть полную карточку или отменить подходящий заказ с явными решениями о возврате денег и товара.
- **Управлять скидками.** Посмотреть скидки или создать базовую скидку по промокоду.
- **Использовать расширенный доступ.** Выполнить произвольный Admin GraphQL-документ для возможностей без отдельного инструмента.

## Что может измениться в Shopify

| Операция | Что происходит | Граница данных |
|---|---|---|
| Магазин, товары, заказы, клиенты, локации, скидки | Читает данные магазина | Только чтение |
| Поля товара или цены вариантов | Перезаписывает переданные поля | Меняет данные витрины |
| Остатки | Устанавливает абсолютное доступное количество | Меняет доступность товара |
| Создание товара или скидки | Создаёт новый объект Shopify | Создаёт данные и автоматически не отменяется |
| Отмена заказа | Отменяет заказ, при необходимости возвращает деньги и товар | Разрушительно и необратимо |
| `graphql_request` | Может выполнить любой query или mutation Admin API | Потенциально разрушительно |

Отдельных инструментов для создания заказов, отгрузки, изменения клиентов, создания вариантов, медиа, прицельных скидок и публикации товаров в каналах продаж нет. Для таких операций можно использовать `graphql_request`, но нужно понимать документ и самостоятельно проверять `userErrors`.

AI-клиент может запросить подтверждение перед записью, но правила подтверждений зависят от клиента. Явная просьба создать, изменить, установить или отменить разрешает соответствующую операцию сервера.

## Получение доступа

Сервер поддерживает два набора учётных данных. Основной — client ID и client secret приложения из Dev Dashboard: обмен на токен и его обновление сервер берёт на себя. Готовый Admin API access token остаётся для магазинов, у которых сохранилось приложение, созданное в админке. Если заданы оба набора, используется готовый токен.

### Приложение в Dev Dashboard (рекомендуется)

С 2026-01-01 Shopify не позволяет создавать новые custom apps в админке магазина, поэтому для магазина, который настраивают сегодня, это единственный путь.

1. Создайте приложение в [Shopify Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard) или через [Shopify CLI](https://shopify.dev/docs/apps/build/scaffold-app) — в той же организации Shopify, которой принадлежит магазин.
2. Выдайте приложению нужные Admin API access scopes: например, `read_products`, `write_products`, `read_orders`, `read_customers`, `read_locations`, `write_inventory`, `read_discounts`, `write_discounts`.
3. Установите приложение в магазин.
4. Передайте client ID и client secret приложения в `SHOPIFY_CLIENT_ID` и `SHOPIFY_CLIENT_SECRET`.

Дальше сервер работает сам: по [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant?lang=node) он обменивает эту пару на access token по адресу `https://{store}.myshopify.com/admin/oauth/access_token`. Такой токен действует 24 часа, поэтому сервер держит его только в памяти процесса, никогда не пишет на диск, заменяет заранее — до истечения срока — и повторяет обмен один раз, если Shopify ответил 401. Параллельные вызовы инструментов делят один обмен, а не запрашивают токен каждый.

Ограничение: client credentials grant работает, только если приложение и магазин принадлежат одной организации Shopify. Иначе Shopify отвечает `shop_not_permitted`, и сервер добавляет к ошибке подсказку про несовпадение организации; перевыпуск credentials здесь не помогает — нужно перенести приложение в организацию магазина или взять магазин из организации приложения.

### Уже существующие custom apps, созданные в админке

С 2026-01-01 Shopify не позволяет создавать новые admin-created custom apps в админке магазина, но выданные раньше токены продолжают работать. Если у вас уже есть такое приложение:

1. Откройте приложение в админке Shopify.
2. Проверьте нужные Admin API access scopes: например, `read_products`, `write_products`, `read_orders`, `read_customers`, `read_locations`, `write_inventory`, `read_discounts`, `write_discounts`.
3. Установите приложение заново, если Shopify попросит сгенерировать credentials.
4. Передайте выданный Admin API access token в `SHOPIFY_ACCESS_TOKEN`.

Такой токен сервер использует как есть и не обновляет: следить за его сроком жизни и заменять его — задача оператора.

Подробнее — в [документации Shopify по старым admin-created custom apps](https://shopify.dev/docs/apps/build/authentication-authorization/legacy/admin-custom-apps).

Относитесь к токену и client secret как к паролю и никогда не добавляйте их в Git. Для безопасного тестирования используйте [development store Shopify](https://shopify.dev/docs/apps/build/dev-dashboard/stores/development-stores).

## Настройка

| Переменная | Обязательна | Описание |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | Да* | Постоянный домен магазина, например `my-store.myshopify.com`; можно указать только имя магазина. |
| `SHOPIFY_CLIENT_ID` | Да** | Client ID приложения из Dev Dashboard. Вместе с секретом сервер сам получает access token и обновляет его. |
| `SHOPIFY_CLIENT_SECRET` | Да** | Client secret того же приложения. Отправляется только на `/admin/oauth/access_token` магазина; полученный токен остаётся в памяти. |
| `SHOPIFY_ACCESS_TOKEN` | Да** | Устаревшая альтернатива: готовый Admin API access token приложения, созданного в админке до 2026-01-01. Сервер передаёт его в `X-Shopify-Access-Token` и не обновляет; если задан, имеет приоритет над парой client ID и client secret. |
| `SHOPIFY_API_VERSION` | Нет | Квартальный релиз `YYYY-MM` или `unstable`; по умолчанию `2026-01`. |
| `SHOPIFY_API_BASE` | Нет | Полный GraphQL-эндпоинт по `http`/`https`, полезен для локального mock-сервера. |
| `SHOPIFY_TIMEOUT_MS` | Нет | Тайм-аут запроса; по умолчанию `30000` мс. |
| `SHOPIFY_MAX_RETRIES` | Нет | Повторы для `THROTTLED`/429 и для 5xx/сетевых ошибок при чтении; по умолчанию `4`. |
| `SHOPIFY_TOKEN_LEEWAY_SECONDS` | Нет | За сколько секунд до истечения заменять полученный токен; по умолчанию `300`. С готовым токеном ни на что не влияет. |

\* `SHOPIFY_API_BASE` может заменить домен для локальных тестов, но реальному запросу в Shopify всё равно нужны учётные данные.

\*\* Нужен один из двух наборов: пара `SHOPIFY_CLIENT_ID` и `SHOPIFY_CLIENT_SECRET` либо готовый `SHOPIFY_ACCESS_TOKEN`. Без них сервер всё равно запускается, но каждый вызов инструмента возвращает ошибку с обоими вариантами: переменные читаются только при старте, поэтому после правки конфигурации нужен перезапуск сервера.

## Данные, лимиты и работа в фоне

- **Cost-бакет GraphQL.** Каждый ответ показывает `actualQueryCost`, `currentlyAvailable`, `maximumAvailable` и `restoreRate`, если Shopify их прислал. Страница `first` до 250 обычно выгоднее множества маленьких страниц.
- **Асимметричные повторы.** `THROTTLED` и HTTP 429 повторяются с ожиданием от Shopify. 5xx и сетевые ошибки повторяются только для чтения; после такой ошибки мутации не воспроизводятся.
- **История заказов.** Для заказов старше 60 дней нужен scope `read_all_orders`; без него Shopify их не возвращает.
- **Фонового наблюдения нет.** Сервер работает только по вызову. Если AI-приложение поддерживает задания по расписанию, можно периодически проверять заказы или остатки.
- **Анонимная телеметрия.** Сервер отправляет технические события установки и использования инструментов без секретов, данных магазина, аргументов и промптов. Отключение для всех Ask Ads MCP: `ASKADS_TELEMETRY=0`.

## Техническая документация

- [Каталог возможностей](./docs/capabilities/index.md) — отдельная страница для каждого из 16 инструментов.
- [Все инструменты и параметры](./docs/TOOLS.md)
- [Документация по разработке](./docs/DEVELOPMENT.md)
- [Документация по публикации](./docs/PUBLISHING.md)
- [Shopify Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql/2026-01)

## Поддержка

Нашли ошибку или не хватает сценария? [Создайте issue](https://github.com/A1-x-Tech/mcp-shopify-admin/issues) или напишите в [Telegram](https://t.me/a1_mcp).

<br>

<p align="center">
  <img src="https://github.com/ztemerbekov/a1-yandex-kit-skills/raw/main/assets/images/mona-hifive-yandex-kit-warm.gif" alt="Две Моны дают пять" width="256">
</p>

<p align="center">
  Вы дочитали до конца!
</p>
