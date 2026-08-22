# MCP capability documentation contract

This contract defines the public format for the methods an MCP server exposes to AI applications. The canonical folder is `docs/capabilities/`; it works for repositories with tools, skills, and other user-facing capabilities.

## When to apply it

When a registered MCP tool is added, renamed, or removed, update its page, the index, and the coverage test in the same change. The work is complete when every tool has exactly one page, the documented impact matches runtime annotations, and every local link resolves.

## How to write a page

1. Name the page after the user's task; use the exact category phrase **MCP tool** in the H1 and opening paragraph.
2. State the user's transition in one line beginning `> I want to`.
3. Explain when to use the tool, required inputs, result, limitations, and exact impact on data.
4. Separate reads, writes, and dangerous operations. Creation, confirmation, publication, payment, cancellation, and deletion must not look like reading.
5. Verify facts in this order: tool registration and runtime annotations → client and tests → `docs/TOOLS.md` → README. Do not publish unsupported promises.

## Required sections

- “What problem it solves”
- “When to use it”
- “What to provide”
- “What it returns”
- “What changes in Shopify”
- “Example request”
- “Errors and limitations”
- “Related MCP tools”
- “Technical details”

## Web publication

Markdown in `docs/capabilities/` is the single source for public capability pages. HTML is generated from it without a second copy. The web layer should expose an equivalent `.md` route, advertise it with `Link: rel="alternate"; type="text/markdown"`, support `Accept: text/markdown` with correct q-value comparison, and return `Vary: Accept` plus mutual `Link` headers for both formats.

The site index and `llms.txt` should link to the catalog as a selected collection rather than copying page text. This keeps one source for search engines, people, and AI clients.
