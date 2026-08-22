# <img src="./assets/a1-logo.svg" alt="A1" width="40"> Shopify Admin MCP

**English** | [Русский](./README.ru.md)

[![npm](https://img.shields.io/npm/v/mcp-shopify-admin)](https://www.npmjs.com/package/mcp-shopify-admin)
[![CI](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-shopify-admin/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin/badges/score.svg)](https://glama.ai/mcp/servers/A1-x-Tech/mcp-shopify-admin)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A1 Shopify Admin MCP** connects AI applications to one Shopify store through the Admin GraphQL API. Ask in plain language about products, orders, customers, inventory, discounts, and shop data; the assistant uses the server's ready-made tools and shows the result.

- **One store per server.** The store domain and access token come from configuration; tools cannot switch to another store.
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

You need Node.js 20+, a store domain such as `my-store.myshopify.com`, and a valid Shopify Admin API access token. This server accepts a ready-to-use token through `SHOPIFY_ACCESS_TOKEN`; it does not perform OAuth, client-credentials exchange, or token refresh.

1. [Get access](#getting-access) and prepare a current Admin API access token.
2. Add the MCP server to your AI application.
3. Send the safe request from the opening section.

The server runs locally over stdio through `npx`. Browser-only ChatGPT and Claude web sessions cannot start a local stdio process directly.

<details open>
<summary><strong>Codex</strong></summary>

<br>

**Through the app:**

1. Open **Settings → Plugins → MCP servers**.
2. Select **Add server**.
3. Add `npx -y mcp-shopify-admin@latest` and set `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ACCESS_TOKEN`.

**Through the CLI:**

```bash
codex mcp add shopify-admin \
  --env SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  --env SHOPIFY_ACCESS_TOKEN=shpat_your_token \
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
  --env SHOPIFY_ACCESS_TOKEN=shpat_your_token \
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
        "SHOPIFY_ACCESS_TOKEN": "shpat_your_token"
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
        "SHOPIFY_ACCESS_TOKEN": "shpat_your_token"
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
      "id": "shopify_access_token",
      "description": "Shopify Admin API access token",
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
        "SHOPIFY_ACCESS_TOKEN": "${input:shopify_access_token}"
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

This server currently takes a ready-to-use Admin API access token. It does not accept a client ID and secret, and it does not refresh expiring tokens.

### Existing admin-created custom apps

Existing admin-created custom apps continue to work, but Shopify no longer allows new admin-created custom apps to be created in the Shopify admin. If you already maintain one:

1. Open the app in the Shopify admin.
2. Confirm the required Admin API access scopes, such as `read_products`, `write_products`, `read_orders`, `read_customers`, `read_locations`, `write_inventory`, `read_discounts`, and `write_discounts`.
3. Install or reinstall the app if Shopify asks you to generate credentials.
4. Use the issued Admin API access token as `SHOPIFY_ACCESS_TOKEN`.

See Shopify's [legacy admin-created custom app documentation](https://shopify.dev/docs/apps/build/authentication-authorization/legacy/admin-custom-apps).

### New apps

For a new integration, use the [Shopify Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard) or [Shopify CLI](https://shopify.dev/docs/apps/build/scaffold-app). Dev Dashboard apps use an OAuth-based flow; for stores in your own Shopify organization, the [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant?lang=node) exchanges a client ID and secret for an access token that expires after 24 hours. Token acquisition and refresh are outside this MCP server, so renew the token externally before restarting the server.

Treat every token as a password and never commit it to Git. For safe testing, use a [Shopify development store](https://shopify.dev/docs/apps/build/dev-dashboard/stores/development-stores).

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | Yes* | Permanent store host such as `my-store.myshopify.com`; a bare store name also works. |
| `SHOPIFY_ACCESS_TOKEN` | Yes* | Ready-to-use Shopify Admin API access token. The server sends it in `X-Shopify-Access-Token` and does not refresh it. |
| `SHOPIFY_API_VERSION` | No | Quarterly `YYYY-MM` release or `unstable`; default: `2026-01`. |
| `SHOPIFY_API_BASE` | No | Full `http`/`https` GraphQL endpoint override, useful for a local mock. |
| `SHOPIFY_TIMEOUT_MS` | No | Per-request timeout; default: `30000` ms. |
| `SHOPIFY_MAX_RETRIES` | No | Retries for `THROTTLED`/429 and for 5xx/network errors on reads; default: `4`. |

\* `SHOPIFY_API_BASE` can replace the store domain for local tests, but a real Shopify request still needs `SHOPIFY_ACCESS_TOKEN`.

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
