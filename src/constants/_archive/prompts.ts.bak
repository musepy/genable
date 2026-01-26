/**
 * @file prompts.ts
 * @description Centralized storage for system prompts and templates
 */

export const DSL_V6_TEMPLATE = `
### OUTPUT FORMAT: FigmaDSL (Compact Notation)

You MUST output in FigmaDSL format, NOT JSON. This compact notation reduces token usage by 60-80%.

#### SYNTAX

\`\`\`
TYPE.Name [WxH] :props {
  children...
}
\`\`\`

#### NODE TYPES
| Type | Maps To | Usage |
|------|---------|-------|
| FRAME | Container | Auto Layout containers |
| TEXT | Text | Text nodes with content |
| RECT | Rectangle | Shapes, dividers, backgrounds |
| ICON | Icon | Iconify icons (lucide:star) |

#### PROPERTY SHORTHANDS (Chain with dots after :)
| Shorthand | Meaning | Example |
|-----------|---------|---------|
| v | Vertical layout | :v |
| h | Horizontal layout | :h |
| gap\\<N\\> | Gap in pixels | :gap12 |
| p\\<N\\> | Padding all sides | :p16 |
| px\\<N\\>/py\\<N\\> | Padding x/y axis | :px12.py8 |
| fill-h/fill-v | Fill parent size | :fill-h |
| hug-h/hug-v | Hug content size | :hug-h |
| center | Center align both axes | :center |
| #\\<hex\\> | Fill color | :#fff |
| r\\<N\\> | Corner radius | :r8 |
| \\<weight\\>/\\<size\\> | Font weight/size | :600/16 |
| \\<size\\>/#\\<color\\> | Font size + color | :14/#888 |
| clip | Clip content | :clip |
| @btn/@card/@input | Semantic type | :@btn |

#### TEXT CONTENT
Use = "content" for text:
\`\`\`
TEXT.Title :600/18 = "标题文字"
\`\`\`

#### ICON FORMAT
\`\`\`
ICON [24x24] :lucide:star.#ffc107
\`\`\`

#### COMPLETE EXAMPLE
\`\`\`
FRAME.ProfileCard [320x120] :h.gap16.p16.#fff.r12 {
  FRAME.Avatar [64x64] :r32.clip.center {
    ICON [32x32] :lucide:user.#666
  }
  FRAME.Info :v.gap4.fill-h {
    TEXT.Name :600/16 = "张三"
    TEXT.Bio :14/#888 = "产品设计师"
  }
}
\`\`\`

### CRITICAL RULES
1. **Output FigmaDSL ONLY** - No JSON, no markdown code blocks
2. **Name every node** - Use .Name after TYPE (e.g., FRAME.Card, TEXT.Title)
3. **Chain properties** - Use dots to chain (e.g., :v.gap12.p16.#fff)
4. **Use semantic types** - Add @btn, @card, etc. for components
5. **Base-4 values** - Use 4, 8, 12, 16, 24, 32 for spacing/radius
6. **Flexible layout** - Prefer fill-h over fixed widths
`;

export const ICON_SEMANTIC_TEMPLATE = `
### ICON USAGE (Semantic Naming)
CRITICAL ICON RULES:
1. Only use icons you are confident exist in common icon sets.
2. Use the 'prefix:name' format (e.g., "lucide:arrow-right", "mdi:home") and kebab-case names.
3. If you are not sure, omit the ICON node rather than guessing.`;
