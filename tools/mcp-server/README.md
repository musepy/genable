# genable-mcp

[![npm version](https://img.shields.io/npm/v/genable-mcp.svg)](https://www.npmjs.com/package/genable-mcp)
[![npm downloads](https://img.shields.io/npm/dm/genable-mcp.svg)](https://www.npmjs.com/package/genable-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)

**The write-side MCP server for Figma.** Build, edit, restructure, and search Figma designs from Claude Code, Cursor, Cline, or any MCP-compatible client.

> Figma's official MCP is read-only — perfect for code generation. `genable-mcp` is the complement: **41 write-side tools** so an LLM can actually build and edit your designs.

## What this is

Figma's official MCP is excellent for **reading** designs (`get_design_context`, code generation). But it's mostly read-only — there's no first-class way to write to the canvas, navigate across pages, or run plugin-API code from your MCP client.

`genable-mcp` fills that gap. It exposes **41 tools** focused on the **write** side:

- **Tree creation** — build complete subtrees with JSX-like markup (`jsx`), vector primitives (`create_vector`)
- **Property edits** — text, fills, strokes, layout, all auto-layout aware (`set_text`, `set_fill`, `set_layout`, `set_stroke`, `edit`)
- **Variables / tokens** — collections, modes, bindings (`create_variable`, `bind_variable`, `set_variable_mode`, etc.)
- **Components** — create, combine, expose props, instance (`create_component`, `add_component_prop`, `create_instance`)
- **Cross-page navigation** — `switch_page` (officially the painful gap)
- **Search & inspect** — `find_nodes`, `inspect`, `describe`, `find_references`, `discover_props`
- **Visual verification** — `get_screenshot` returns PNG as MCP image content for vision-capable models
- **Curated knowledge** — design `skill` / `style` / `guideline` readers built into the plugin
- **Agent ergonomics** — `session_note` scratchpad, `subtask` delegation, `ask_user` interactive pause

We **recommend pairing** with Figma's official MCP. They cover read-for-codegen; we cover write-and-edit. The two MCPs together give an LLM full read+write access to a Figma file.

## FAQ

**Is this an alternative to Figma's official MCP?**
No — it's a complement. Use both. Official MCP for "read this design → give me code". `genable-mcp` for "build / edit / restructure this design".

**What MCP clients does it work with?**
Any client that supports STDIO MCP servers: Claude Code, Claude Desktop, Cursor, Cline, Continue, Zed, and others.

**Does it need a Figma plugin?**
Yes. The plugin runs inside Figma desktop and is the only way to actually call `figma.*` API. `genable-mcp` is the bridge between your MCP client (outside Figma) and the plugin (inside Figma).

**How is this different from "Figma to code" plugins?**
Those plugins are one-shot exporters (Figma → React/Vue/HTML). `genable-mcp` is bidirectional and interactive — your AI agent can read, edit, verify visually, and iterate inside Figma.

**Can it build a full design from a prompt?**
Yes. The `jsx` tool accepts JSX-like markup and creates an entire subtree atomically. Pair with `bind_variable` for token-driven designs.

**Is it free?**
Yes. MIT license. The MCP server is free; the Genable plugin in Figma Community is free.

## How it works

```
MCP client (Claude Code / Cursor / etc.)
    ↓ stdio JSON-RPC
genable-mcp (this package, Node.js)
    ↓ WebSocket :3458
Genable plugin (running inside Figma)
    ↓ Figma Plugin API
Figma file
```

The plugin runs in your Figma desktop app. `genable-mcp` is the bridge that lets external MCP clients call into it.

## Setup

### 1. Install the Genable plugin in Figma

Search "Genable" in the Figma Community and install. Open it once in any file — it auto-connects to localhost:3458.

(One-time. Plugin keeps connecting silently after the first run.)

### 2. Add `genable-mcp` to your MCP client config

#### Claude Code

```json
// .mcp.json (project) or ~/.claude.json (global)
{
  "mcpServers": {
    "genable": {
      "command": "npx",
      "args": ["-y", "genable-mcp"]
    }
  }
}
```

#### Cursor / Cline / other MCP clients

Same idea — configure a STDIO server with `command: npx`, `args: ["-y", "genable-mcp"]`.

### 3. Verify

In your MCP client, ask: *"List the pages in my Figma file."* If the plugin is running, you'll see the page roster.

## Pair with the official Figma MCP (recommended)

```json
{
  "mcpServers": {
    "figma": { /* official, read */ },
    "genable": {
      "command": "npx",
      "args": ["-y", "genable-mcp"]
    }
  }
}
```

Rule of thumb:
- **Figma official** → "read this design and give me code" workflows
- **Genable** → "build / edit / restructure this design" workflows
- Both together → end-to-end "code ↔ Figma" round-trips

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MCP_WS_PORT` | `3458` | Port the WebSocket relay listens on |
| `RELAY_SECRET` | (empty) | If set, plugin must send matching secret in `identify` handshake. Use when sharing a host between multiple users. |

## Tool reference

Each tool's full description (parameters, examples, sandbox limits) is exposed via `ListTools` in the MCP protocol — your client surfaces them automatically. Below is a one-line index.

### Tree creation
- `jsx` — Build a complete subtree with JSX-like markup. Single-call atomicity.
- `create_vector` — Create vector primitives from SVG path data.

### Read
- `inspect` — Read a node with selectable property facets (layout, paint, typography, etc.).
- `describe` — Lint-style summary of a subtree.
- `find_nodes` — Search by name/type within current page.
- `discover_props` — Unique property values across a subtree.
- `find_references` — Reverse lookup: who binds this variable?
- `get_selection` — User's current Figma selection.

### Write — properties
- `edit` — Generic property updates on existing nodes.
- `set_text`, `set_fill`, `set_stroke`, `set_layout` — Single-intent setters (font load + fallback included).
- `replace_props` — Bulk find/replace of property values across a subtree.

### Write — structure
- `delete_node`, `move_node`, `clone_node` — Tree mutations.

### Components
- `create_component`, `combine_components` — Promote nodes to components.
- `add_component_prop`, `list_component_props` — Variant / boolean / instance-swap props.
- `create_instance` — Instantiate a component.

### Variables / tokens
- `list_variables` — Inventory of collections + variables in the file.
- `create_collection`, `ensure_collection` — Token collections (idempotent ensure).
- `create_variable`, `ensure_variable`, `set_variable_value`, `set_variable_mode` — Variable lifecycle.
- `bind_variable` — Bind a variable to a node property.

### Knowledge readers
- `skill`, `style`, `guideline`, `help` — Curated design knowledge baked into the plugin.

### Page navigation
- `switch_page` — Switch active page by ID or name. Returns the full page roster.

### Visual verification
- `get_screenshot` — Export a node as PNG, embedded as MCP image content.

### Interaction
- `ask_user` — Pause and ask the user a question (interactive client only).
- `subtask` — Delegate a sub-prompt to a focused agent.
- `session_note` — Scratchpad for the agent to record findings across a session.

### Plugin data
- `read_plugin_data`, `write_plugin_data` — Persist key/value metadata on nodes via Figma's plugin-data API.

## Limitations

- **Plugin must be open** — Figma writes require the plugin runtime. The plugin reconnects silently across files; you only need to launch it once per Figma session.
- **One file at a time per port** — Multi-file workflows: spawn additional relay ports via `MCP_WS_PORTS=3458,3459,…`
- **Sandbox quirks** — Some Figma plugin-API edges are sharp (font loading, frozen `fills` arrays, stale node IDs after reload). High-level tools wrap most of these; the `js` escape hatch description lists the rest.

## License

MIT.

## Repo

Source + issues: [github.com/muse40007/figma-ai-generator-dogfood](https://github.com/muse40007/figma-ai-generator-dogfood) (subdir `tools/mcp-server`).
