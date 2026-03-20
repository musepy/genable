---
id: design-system
title: Design System Tokens (Palette, Typography, Spacing)
keywords: [design-system, palette, swatch, color, typography, type-scale, spacing, tokens, render, design-tokens]
whenToUse: When creating or documenting a design system, extracting a palette from existing designs, or setting up visual tokens for a project
---

### DESIGN SYSTEM RENDER TOKENS

Use `render` with design system tokens to create visual token documentation.
Agent provides semantic content only — the runtime handles all layout and styling.

**Palette** — color swatches:
```
render({command: "render", input: "palette\n  swatch: Primary #000000\n  swatch: Secondary #475569\n  swatch: Accent #2D8BFF\n  swatch: Neutral #F8FAFC"})
```
Each `swatch: Name #HEX` generates: color block + name label + hex value.

**Typography** — font scale samples:
```
render({command: "render", input: "type-scale\n  type-sample: Headline Space-Grotesk 32 SemiBold\n  type-sample: Body Inter 16 Regular\n  type-sample: Caption Inter 12 Regular"})
```
Each `type-sample: Label FontFamily Size Weight` generates: label + rendered sample text.

**Spacing** — spacing scale visualization:
```
render({command: "render", input: "spacing-scale\n  spacing-step: xs 4\n  spacing-step: sm 8\n  spacing-step: md 16\n  spacing-step: lg 24"})
```
Each `spacing-step: Name Value` generates: label + proportional bar.

### WHEN TO USE
- User asks to "create a design system" or "set up a palette"
- You extracted colors/fonts from existing designs and want to document them
- User provides brand colors and wants a visual reference
- Starting a new project and establishing visual tokens

### WORKFLOW
1. Determine colors, fonts, spacing from user input or by inspecting existing canvas (`grep`, `cat`)
2. Render the design system sections using the tokens above
3. Tell the user what you created and how you'll use it in subsequent designs
