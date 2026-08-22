# Publishing and listing the server

This guide covers shipping a version and preparing listings in MCP catalogs. The canonical source is the **official MCP Registry** (`registry.modelcontextprotocol.io`). This repository's documentation and checks can be prepared without publishing; publishing is a separate release action.

## Version sync

The version lives in three places and must match byte for byte:

- `package.json` → `version`;
- `server.json` → root `version`;
- `server.json` → `packages[0].version`.

`package.json.mcpName` must equal `server.json.name` (`io.github.A1-x-Tech/mcp-shopify-admin`). Check all values before publishing:

`CODE
grep -n '"version"' package.json server.json
grep -n 'mcpName' package.json
grep -n '"name"' server.json
`

> `mcp-publisher` publishes the root `server.json.version`. If npm and `packages[0].version` are bumped while the root version is stale, npm can succeed while the registry reports the misleading `400 cannot publish duplicate version`.

> The root `server.json.description` must be 100 characters or fewer. Keep it shorter than the package description.

## Release sequence

Publishing to npm alone drifts from the other channels: `git push --follow-tags` pushes a tag but does not create a GitHub Release, and the registry treats each version as immutable.

1. Bump the version in all three places and move `[Unreleased]` into a dated `CHANGELOG.md` section.
2. Run `npm publish`; `prepublishOnly` runs typecheck and tests, and `prepare` builds the package.
3. Commit, create an annotated tag, and push it:

   `CODE
   git commit -m "Release vX.Y.Z"
   git tag -a vX.Y.Z -m vX.Y.Z
   git push origin main --follow-tags
   `

4. Create the GitHub Release:

   `CODE
   gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag
   `

5. Publish `server.json` to the official registry:

   `CODE
   brew install mcp-publisher
   mcp-publisher logout
   mcp-publisher login github --token "$(gh auth token)"
   mcp-publisher publish
   `

Run the registry login immediately before publishing: its JWT expires after roughly an hour. Log in with a GitHub token rather than the device flow so the `A1-x-Tech` namespace is visible to the registry.

## What the registry checks

- **Namespace.** `io.github.A1-x-Tech/*` is case-sensitive and requires a GitHub account with access to the organization.
- **npm ownership.** The published package's `mcpName` must match `server.json.name` character for character. The npm package must exist before the registry publish.
- **Package metadata.** The package identifier, version, stdio transport, and environment variables must agree with `server.json`.

## LobeHub

Open [lobehub.com/mcp](https://lobehub.com/mcp) → **Submit MCP** and provide `https://github.com/A1-x-Tech/mcp-shopify-admin`. LobeHub can pull the README, tool list, and installation command (`npx -y mcp-shopify-admin`) from the repository.
