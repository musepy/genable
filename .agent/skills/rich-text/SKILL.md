---
id: rich-text
name: Rich Text Styling
description: Use when applying mixed inline styles (bold, color, weight) within a single text node via markdown markup — the runtime parses it and applies per-character ranges.
category: core
priority: 4
enabledByDefault: true
---

## RICH TEXT — Mixed Styles in One Text Node

Text content supports **markdown markup**. The runtime automatically parses it and applies styles per character range. You never need to calculate character offsets.

### Supported Markup

| Syntax | Effect | Example |
|---|---|---|
| `**text**` | Bold | `'Click **here** to continue'` |
| `*text*` | Italic | `'Read the *fine print*'` |
| `***text***` | Bold Italic | `'This is ***critical***'` |
| `~~text~~` | Strikethrough | `'Was ~~$19~~'` |
| `{color:#HEX\|text}` | Color | `'{color:#EF4444\|Error}: something failed'` |
| `{size:N\|text}` | Font Size | `'{size:32\|Big} then normal'` |

### Nesting

Markup can be nested. Inner styles stack on the same character range:

- `**~~$19~~**` → bold + strikethrough
- `{color:#EF4444|**$9**}` → red + bold

### Common Patterns

**Price tag** (old price struck through, new price highlighted):
```
txt = text(parent, {size:16, fill:'#6B7280'}, '~~$19.99~~ {color:#EF4444|**$9.99**}')
```
Result: "$19.99" in gray with strikethrough, "$9.99" in red bold.

**Call to action** (keyword emphasized):
```
txt = text(parent, {size:14, fill:'#374151'}, 'Click **here** to get started')
```
Result: "here" in bold, rest in regular weight.

**Status message** (colored keyword):
```
txt = text(parent, {size:14}, 'Status: {color:#22C55E|Active}')
```
Result: "Active" in green.

**Mixed emphasis**:
```
txt = text(parent, {size:14}, 'This is *important* and this is **critical**')
```

### Rules

1. The base font (from `weight` prop or default 'Regular') applies to unmarked text. Markup overrides only the marked range.
2. `**bold**` uses the same font family — only the style changes (Regular → Bold).
3. Plain text with no markup works exactly as before — zero overhead.
4. Do NOT calculate character offsets yourself — the runtime does it automatically.
5. When the entire text is one style, prefer the prop instead of markup: `weight:'Bold'` not `'**all bold**'`.
