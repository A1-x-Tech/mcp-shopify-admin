# <img src="./assets/a1-logo.svg" alt="A1" width="40"> Shopify Admin MCP

**English** | [Русский](./README.ru.md)

[![npm](https://img.shields.io/npm/v/mcp-shopify-admin)](https://www.npmjs.com/package/mcp-shopify-admin)
[![CI](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin/badges/score.svg)](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A1 Shopify Admin MCP** connects AI applications to one Shopify store through the Admin GraphQL API. Ask in plain language about products, orders, customers, inventory, discounts, and shop data; the assistant uses the server's ready-made tools and shows the result.

- **One store per server.** The store domain and credentials come from configuration; tools cannot switch to another store.
- **Tokens stay fresh.** Give the server the client ID and secret of a Shopify Dev Dashboard app and it mints the Admin API token itself, keeps it in memory only, and re-mints it before the 24-hour expiry. A ready-made token from an older custom app still works too.
- **16 focused tools.** Read shop data, products, orders, customers, locations, inventory, and discounts, plus create or update the supported records.
- **GraphQL failures are surfaced.** Shopify can return HTTP 200 for a failed mutation, so the server checks `userErrors` and rejects empty or malformed GraphQL responses.
- **Cost-aware responses.** Every result includes the GraphQL cost bucket: the cost of the request and the points currently available for the next calls.
- **Risk is visible.** Reads are read-only; product, price, inventory, and discount writes are explicit; order cancellation and arbitrary GraphQL are marked destructive.

Start with a read-only request:

> Show the latest orders and the products that currently have inventory.

[Connect the server](#quick-start) · [Explore use cases](#what-you-can-ask-it-to-do) · [Open technical documentation](#technical-documentation)

---

## See it work in a minute

> **You:** Show the latest orders and the products that currently have inventory.
>
> **Assistant:** Shows recent orders with their statuses and totals, then products with prices and inventory. Nothing changes.
>
> **You:** Prepare a 20% discount code called `SUMMER` for two weeks.
>
> **Assistant:** Shows the proposed code, percentage, dates, and limits, then asks for confirmation before creating it.
>
> **You:** Confirm.

## Contents

- [Quick start](#quick-start)
- [What you can ask it to do](#what-you-can-ask-it-to-do)
- [What can change in Shopify](#what-can-change-in-shopify)
- [Getting access](#getting-access)
- [Configuration](#configuration)
- [Data, limits, and background work](#data-limits-and-background-work)
- [Technical documentation](#technical-documentation)
- [Support](#support)

## Quick start

You need Node.js 20+, a store domain such as `my-store.myshopify.com`, and Admin API credentials. The recommended set is the client ID and secret of a [Shopify Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard) app: the server exchanges them for an access token itself and keeps that token fresh, which matters because the token Shopify issues for this grant expires after 24 hours. The app and the store must belong to the same Shopify organization.

1. [Get access](#getting-access) and prepare the app's client ID and client secret.
2. Add the MCP server to your AI application.
3. Send the safe request from the opening section.

The server runs locally over stdio through `npx`. Browser-only ChatGPT and Claude web sessions cannot start a local stdio process directly.

Every snippet below uses that pair. If your store still holds a ready-made token from an admin-created custom app, replace `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` with a single `SHOPIFY_ACCESS_TOKEN` — see [Getting access](#getting-access).

<details open>
<summary><strong>Codex</strong></summary>

<br>

**Through the app:**

1. Open **Settings → Plugins → MCP servers**.
2. Select **Add server**.
3. Add `npx -y mcp-shopify-admin@latest` and set `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, and `SHOPIFY_CLIENT_SECRET`.

**Through the CLI:**

```bash
codex mcp add shopify-admin \
  --env SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  --env SHOPIFY_CLIENT_ID=your_client_id \
  --env SHOPIFY_CLIENT_SECRET=your_client_secret \
  -- npx -y mcp-shopify-admin@latest

codex mcp list
```

[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

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

[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

<br>

Open **Settings → Developer → Edit Config** and add:

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

If **Edit Config** is not available, edit `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows.

[Claude Desktop MCP documentation](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

</details>

<details>
<summary><strong>Cursor</strong></summary>

<br>

Add this server to `~/.cursor/mcp.json` on macOS/Linux or `%USERPROFILE%\.cursor\mcp.json` on Windows:

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

[Cursor MCP documentation](https://cursor.com/docs/mcp)

</details>

<details>
<summary><strong>VS Code</strong></summary>

<br>

Run **MCP: Open User Configuration** and add:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "shopify_store_domain",
      "description": "Shopify store domain, for example my-store.myshopify.com"
    },
    {
      "type": "promptString",
      "id": "shopify_client_id",
      "description": "Client ID of the Shopify Dev Dashboard app"
    },
    {
      "type": "promptString",
      "id": "shopify_client_secret",
      "description": "Client secret of that app",
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

Check the server with **MCP: List Servers**.

[VS Code MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers)

</details>

## What you can ask it to do

- **Inspect the store.** Show shop details, locations, products, orders, customers, or discounts.
- **Work with products.** Create a product draft, update product fields, or change variant prices.
- **Track inventory.** Find locations and set the absolute available quantity for inventory items.
- **Review orders.** Search orders, inspect a complete order, or cancel an eligible order with explicit refund and restock choices.
- **Manage discounts.** List existing discounts or create a basic code discount.
- **Use the escape hatch.** Run an arbitrary Admin GraphQL document for capabilities that do not have a dedicated tool.

## What can change in Shopify

| Operation | What happens | Data boundary |
|---|---|---|
| Shop, products, orders, customers, locations, discounts | Reads store data | Read-only |
| Product fields or variant prices | Replaces the fields supplied in the request | Changes the storefront data |
| Inventory quantities | Sets the absolute available quantity | Changes product availability |
| Product or discount creation | Creates a new Shopify object | Creates data and cannot be undone automatically |
| Order cancellation | Cancels an order and can refund and/or restock | Destructive and irreversible |
| `graphql_request` | Can run any Admin API query or mutation | Potentially destructive |

This server does not provide dedicated tools for creating orders, fulfillment, customer writes, variant creation, media, targeted discounts, or publishing products to sales channels. Use `graphql_request` only when you understand the document and its `userErrors` response.

The AI client may ask for confirmation before a write, but confirmation behavior belongs to that client. A clear request to create, update, set, or cancel authorizes the corresponding server operation.

## Getting access

The server authenticates in one of two ways: with the client ID and secret of a Dev Dashboard app, which it exchanges for an access token itself, or with a ready-to-use Admin API access token that it sends as-is. If both are configured, the ready-made token wins.

### Dev Dashboard app (recommended)

Shopify stopped allowing new admin-created custom apps on 2026-01-01, so this is the path for any store being set up today.

1. Create an app in the [Shopify Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard) or with the [Shopify CLI](https://shopify.dev/docs/apps/build/scaffold-app), in the same Shopify organization the store belongs to.
2. Give it the Admin API access scopes you need, such as `read_products`, `write_products`, `read_orders`, `read_customers`, `read_locations`, `write_inventory`, `read_discounts`, and `write_discounts`.
3. Install the app on the store.
4. Use the app's client ID and client secret as `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`.

From there the server runs the [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant?lang=node) against `https://{store}.myshopify.com/admin/oauth/access_token` on its own. The token Shopify returns lives **24 hours**; the server keeps it in memory only — never on disk — re-mints it shortly before it expires, lets parallel tool calls share one exchange, and mints a fresh one if the API answers `401`. Nothing to renew by hand.

The grant works **only when the app and the store belong to the same Shopify organization**. Otherwise Shopify refuses with `shop_not_permitted`, and the server relays that as a hint naming the organization mismatch. Re-issuing the credentials does not help: move the app into the store's organization, or use a store from it.

### Existing admin-created custom apps (legacy)

Apps created in the Shopify admin before 2026-01-01 keep working, and their token is still accepted. If you already maintain one:

1. Open the app in the Shopify admin.
2. Confirm the required Admin API access scopes, such as `read_products`, `write_products`, `read_orders`, `read_customers`, `read_locations`, `write_inventory`, `read_discounts`, and `write_discounts`.
3. Install or reinstall the app if Shopify asks you to generate credentials.
4. Use the issued Admin API access token as `SHOPIFY_ACCESS_TOKEN`.

The server sends this token as-is and never refreshes it, so replacing it when it stops working is yours to do. See Shopify's [legacy admin-created custom app documentation](https://shopify.dev/docs/apps/build/authentication-authorization/legacy/admin-custom-apps).

Treat the access token and the client secret as passwords and never commit them to Git. For safe testing, use a [Shopify development store](https://shopify.dev/docs/apps/build/dev-dashboard/stores/development-stores).

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | Yes* | Permanent store host such as `my-store.myshopify.com`; a bare store name also works. |
| `SHOPIFY_CLIENT_ID` | Yes** | Client ID of a Dev Dashboard app. Together with the secret, the server mints its own 24-hour access token and keeps it fresh. |
| `SHOPIFY_CLIENT_SECRET` | Yes** | Client secret of that app. Sent only to the store's `/admin/oauth/access_token`; the minted token stays in memory. |
| `SHOPIFY_ACCESS_TOKEN` | Yes** | Legacy alternative: a ready-to-use Admin API access token from a pre-2026 custom app. The server sends it in `X-Shopify-Access-Token` and never refreshes it; it wins if the client pair is set too. |
| `SHOPIFY_API_VERSION` | No | Quarterly `YYYY-MM` release or `unstable`; default: `2026-01`. |
| `SHOPIFY_API_BASE` | No | Full `http`/`https` GraphQL endpoint override, useful for a local mock. |
| `SHOPIFY_TIMEOUT_MS` | No | Per-request timeout; default: `30000` ms. |
| `SHOPIFY_MAX_RETRIES` | No | Retries for `THROTTLED`/429 and for 5xx/network errors on reads; default: `4`. |
| `SHOPIFY_TOKEN_LEEWAY_SECONDS` | No | How early a minted token is replaced; default: `300` s. Has no effect with a ready-made token. |

\* `SHOPIFY_API_BASE` can replace the store domain for local tests, but a real Shopify request still needs credentials.

\*\* One of the two authentication paths is required: `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`, or `SHOPIFY_ACCESS_TOKEN`. With neither, the server still starts and answers `initialize`, but every tool call returns an error naming both options. Variables are read at startup, so restart the server after changing them.

## Data, limits, and background work

- **GraphQL cost bucket.** Every result exposes `actualQueryCost`, `currentlyAvailable`, `maximumAvailable`, and `restoreRate` when Shopify provides them. A page with `first` up to 250 is usually cheaper than many small pages.
- **Retries are asymmetric.** `THROTTLED` and HTTP 429 are retried with the wait Shopify reports. 5xx and network errors are retried only for reads; mutations are not replayed after those failures.
- **Order history.** Orders older than 60 days require the `read_all_orders` scope; without it, Shopify does not return them.
- **No background monitoring.** The server works when called. If your AI application supports scheduled tasks, it can periodically check orders or inventory.
- **Anonymous telemetry.** The server sends technical installation and tool-use events without secrets, store data, arguments, or prompts. Disable it for all Ask Ads MCP servers with `ASKADS_TELEMETRY=0`.

## Technical documentation

- [Capability catalog](./docs/capabilities/index.md) — one task-oriented page for each of the 16 tools.
- [All tools and parameters](./docs/TOOLS.md)
- [Development guide](./docs/DEVELOPMENT.md)
- [Publishing guide](./docs/PUBLISHING.md)
- [Shopify Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql/2026-01)

## Support

Found a bug or missing scenario? [Create an issue](https://github.com/A1-x-Tech/mcp-shopify-admin/issues) or contact us on [Telegram](https://t.me/a1_mcp).

<br>

<p align="center">
  <img src="https://github.com/ztemerbekov/a1-yandex-kit-skills/raw/main/assets/images/mona-hifive-yandex-kit-warm.gif" alt="Two Monas giving a high five" width="256">
</p>

<p align="center">
  You made it to the end!
</p>
