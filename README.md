<div align="center">

<img src="./assets/logo.svg" alt="Genable" width="96" />

# Genable

**Hand off the design busywork.**
Detailed prompt in. Fully editable Figma layers out — components typed, variables bound, variants generated, pages laid out.

[![Install on Figma](https://img.shields.io/badge/Install-Figma_Community-black?style=for-the-badge&logo=figma)](https://www.figma.com/community/plugin/1583731690321161934/genable-ai-ui-design-generator-prompt-to-ui-dashboard-landing-page-mobile-app)
[![npm: genable-mcp](https://img.shields.io/npm/v/genable-mcp?style=for-the-badge&logo=npm&label=genable-mcp)](https://www.npmjs.com/package/genable-mcp)
[![Sponsor](https://img.shields.io/badge/Sponsor-Patreon-FF424D?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/c/musec)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](./LICENSE)

<img src="./assets/cover.png" alt="Skip the busywork. Keep the design." width="100%" />

</div>

---

## Why Genable

Most AI design tools ship a flat image or a templated mock. Genable is **agentic** — it plans, executes against Figma's scene graph through typed tools, and verifies its work. The output is real, editable Figma layers, not screenshots.

- **Real layers** — Frames with Auto Layout, real Text, real Components — not flattened images.
- **Variables, not pasted hex** — Color, typography, and spacing bound to variables with light and dark modes.
- **Variants together** — Light, dark, and brand-color themes generated in one pass, switchable in a click.
- **Whole pages** — Hero, pricing, features, FAQ laid out as proper sections — not a slab of nodes.
- **Detailed prompts welcome** — We don't sell prompt brevity. The more specific you are, the better the result.

---

## What you can hand off

<img src="./assets/screenshot-1.png" alt="Six things Genable takes off your plate" width="100%" />

---

## Three steps

<img src="./assets/screenshot-2.png" alt="From describing to designing — three steps" width="100%" />

---

## Two surfaces, one engine

Use Genable as a **Figma plugin** (designers) or as the **`genable-mcp`** MCP server (Claude Code, Cursor, Cline, Continue, Zed, or any MCP-compatible agent). Same engine, same 41 tools.

### Install the plugin

**[Install from Figma Community →](https://www.figma.com/community/plugin/1583731690321161934/genable-ai-ui-design-generator-prompt-to-ui-dashboard-landing-page-mobile-app)**

1. Open Figma.
2. Run `Plugins → Genable`.
3. Paste an API key in Settings (any of the protocols below).
4. Type a detailed prompt. Hit generate.

### Install the MCP server

For agent-driven workflows. Pair with the official Figma MCP for full read + write.

```json
{
  "mcpServers": {
    "genable": { "command": "npx", "args": ["-y", "genable-mcp"] }
  }
}
```

41 tools — JSX tree creation, variables, components, cross-page navigation, visual verification. **[Full docs on npm →](https://www.npmjs.com/package/genable-mcp)**

---

## Bring your own model

Genable speaks three protocols natively. Pick whichever you have keys for — keys stay on your device.

| Protocol | Examples | Get a key |
|---|---|---|
| **Google Gemini** | Gemini 2.5 Pro / Flash | [aistudio.google.com](https://aistudio.google.com) |
| **Anthropic Claude** | Claude 4.7 Sonnet / Opus | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI-compatible** | OpenRouter, DashScope (Qwen), Kimi K2.5, custom endpoints | varies |

Switch models any time from the Settings panel.

---

## Examples

Detail helps. Try prompts like:

- *"SaaS pricing page — 3 tiers, monthly/annual toggle, featured Pro plan, dark mode, brand color bound to variables."*
- *"Analytics dashboard — sidebar, KPI grid with sparklines, a hot-state table row, dark + light variants, bound to brand tokens."*
- *"Mobile onboarding — 3 screens with progress dots, illustrations, brand color blue (#4F90EE)."*
- *"Landing page hero — headline + subline + dual CTA + code preview card, Inter typography, 8pt spacing scale."*

Genable returns a real, editable Figma frame you can drop straight into a design system.

---

## Sponsor

Genable is built and maintained by one developer, in the open. If it saves you time or replaces a paid tool, please consider sponsoring:

**[💖 Sponsor on Patreon](https://www.patreon.com/c/musec)**

Sponsorship pays for development time, model API quotas during testing, and ongoing improvements.

---

## License

[MIT](./LICENSE) — free for personal and commercial use.

---

<div align="center">
<sub>
<a href="https://www.figma.com/community/plugin/1583731690321161934/genable-ai-ui-design-generator-prompt-to-ui-dashboard-landing-page-mobile-app">Figma plugin</a>
 · 
<a href="https://www.npmjs.com/package/genable-mcp">MCP server</a>
 · 
<a href="https://www.patreon.com/c/musec">Sponsor</a>
</sub>
</div>
