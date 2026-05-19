# Changelog

## genable-mcp (npm)

### 0.2.0 — 2026-05-19

**Marketplace plugin connectivity unlocked + tool surface +1.** Companion plugin release moves `ws://localhost:3458` from `devAllowedDomains` to `allowedDomains` so users of the published Figma Community plugin (not just dev installs) can reach this MCP server. Older plugin versions (pre-May-2026 marketplace builds) cannot connect — Figma's CSP blocks the localhost WS.

New tool surface: 42 (was 41). `add_component_prop` now supports VARIANT and SLOT property types in addition to TEXT/BOOLEAN/INSTANCE_SWAP, with `variantOptions`, `description`, and `preferredValues` parameters.

> ⚠️ Users on `0.1.x` should upgrade. The wire protocol is unchanged, but the tool list is a strict superset, so `0.1.x` clients will silently miss VARIANT/SLOT capability. All `0.1.x` versions are deprecated on npm.

### 0.1.3 — 2026-05-12

**Tool description quality.** Rewrote `create_instance` and `replace_props` descriptions following the Tool Definition Quality template (Use when / Returns / Skip when / Parameters beyond schema). Both tools now disclose mutation semantics, return shapes, parent auto-layout interaction, exact-match vs substring behavior, and concrete alternatives (`clone_node`, single-intent setters).

No behavior change. Same wire protocol, same WebSocket bridge, same 41 tools — descriptions only.

### 0.1.2 — 2026-05-12

**Repository metadata fix.** Corrected `repository.url`, `homepage`, `bugs.url`, and `mcpName` to point to `musepy/genable` (previous versions pointed to a non-existent GitHub account, causing 404s on npm-rendered package pages).

Also published to the official [MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.musepy/genable-mcp`.

### 0.1.1 — 2026-05-12

**README + GEO polish.** Synced README with current tool surface (41 tools), added badges and FAQ, expanded npm keywords (figma-mcp, claude, cursor, design-system, design-tokens, ai-agent, llm, jsx, anthropic).

> ⚠️ Repository URL was incorrect in this version — use 0.1.2+. Will be deprecated.

### 0.1.0 — 2026-05-10

Initial standalone release. 39 tools (since extended). Plugin-bridge architecture: stdio MCP server → WebSocket relay (localhost:3458) → Genable plugin in Figma desktop.

## Plugin (Figma Community)

Plugin versioning tracked in [Figma Community](https://www.figma.com/community/plugin/1583731690321161934). MCP server (`genable-mcp` on npm) and plugin ship independently.
