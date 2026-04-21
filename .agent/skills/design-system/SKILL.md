---
id: design-system
name: Design System Creation
description: Use when creating or managing Figma design systems — variable collections, modes (light/dark), component variants, and variable bindings for brand tokens and themes.
---

## DESIGN SYSTEM — Variables, Modes & Component Variants

When creating a design system (brand guidelines, token system, theme), use `var` and `comp` commands instead of creating flat text/frame representations.

### Workflow: Complete Design System from Brand Guide

1. **Create variable collections** with modes:
```
var mk --collection Colors
var mk --collection Theme --modes Light,Dark
var mk --collection Spacing
var mk --collection Typography
```

2. **Create primitive color variables**:
```
var mk Colors/primary COLOR #1A1A1A
var mk Colors/secondary COLOR #666666
var mk Colors/muted COLOR #999999
var mk Colors/surface COLOR #F5F5F5
var mk Colors/border COLOR #E5E7EB
```

3. **Create semantic tokens as aliases** (reference primitives):
```
var alias Theme/text-primary Colors/primary
var alias Theme/text-secondary Colors/secondary
var alias Theme/bg-surface Colors/surface
var alias Theme/border-default Colors/border
```

4. **Create spacing scale**:
```
var mk Spacing/xs FLOAT 8
var mk Spacing/sm FLOAT 16
var mk Spacing/md FLOAT 32
var mk Spacing/lg FLOAT 60
var mk Spacing/xl FLOAT 80
```

5. **Create typography tokens**:
```
var mk Typography/h1-size FLOAT 48
var mk Typography/h2-size FLOAT 36
var mk Typography/h3-size FLOAT 24
var mk Typography/body-size FLOAT 16
var mk Typography/caption-size FLOAT 12
```

6. **Create components** with proper structure:
```
mk /Button/Primary frame layout:row alignMain:center alignCross:center p:'16 32' bg:#1A1A1A
mk /Button/Primary/Label text size:16 weight:Medium fill:#FFF -- Primary Button

mk /Button/Secondary frame layout:row alignMain:center alignCross:center p:'16 32' stroke:#1A1A1A strokeW:1
mk /Button/Secondary/Label text size:16 weight:Medium fill:#1A1A1A -- Secondary Button

comp create /Button/Primary
comp create /Button/Secondary
comp combine /Button/Primary /Button/Secondary --name Button
comp prop /Button/ Label TEXT "Button"
```

7. **Bind variables to design nodes**:
```
var bind /Card/ fills Theme/bg-surface
var bind /Card/ itemSpacing Spacing/md
var bind /Card/Title fontSize Typography/h3-size
var bind /Card/Title fills Theme/text-primary
```

### Variable Types Reference

| Type    | Value Format | Example |
|---------|-------------|---------|
| COLOR   | #hex, rgb(), rgba() | `#1A1A1A`, `rgb(26,26,26)` |
| FLOAT   | number (px) | `16`, `24px` |
| BOOLEAN | true/false  | `true` |
| STRING  | text        | `Inter` |

### Bind Property Names

| Shorthand | Figma Property | Variable Type |
|-----------|---------------|---------------|
| fills, bg | fills (paint) | COLOR |
| strokes, stroke | strokes (paint) | COLOR |
| fontSize, font-size | fontSize | FLOAT |
| gap | itemSpacing | FLOAT |
| padding | paddingTop | FLOAT |
| padding-top/right/bottom/left | paddingTop/Right/Bottom/Left | FLOAT |
| corner, corner-radius | cornerRadius | FLOAT |
| opacity | opacity | FLOAT |
| visible | visible | BOOLEAN |
| width, height | width, height | FLOAT |

### Theme Modes (Light/Dark)

For multi-mode variables, set values per mode:
```
var mk --collection Theme --modes Light,Dark
var mk Theme/bg-primary COLOR #FFFFFF --mode Light
var mk Theme/bg-primary COLOR #1A1A1A --mode Dark
var mk Theme/text-primary COLOR #1A1A1A --mode Light
var mk Theme/text-primary COLOR #FFFFFF --mode Dark
```

### Component Variant Workflow

1. Create individual variant frames with `mk`
2. Convert each to component: `comp create /path/`
3. Combine into variant set: `comp combine /path1/ /path2/ --name Name`
4. Add configurable properties: `comp prop /Set/ PropName TYPE default`
5. Create instances: `comp instance /Set/ --parent /target/`

### STRING Variable Binding (i18n / Language Switching)

STRING variables bound to text `characters` **auto-render on mode switch** — confirmed working.

```
// Bind text node to a STRING variable
var bind /Hero/H1 characters Lang/hero-title

// When LP-Lang mode switches EN→CN, text auto-updates
```

**CRITICAL — 覆盖式互斥 (Override Exclusivity)**:
- `setBoundVariable('characters', var)` binds text to variable → auto-renders ✓
- `node.characters = "text"` sets manual text → CLEARS variable binding ✗
- **Last write wins.** For variable-driven text, NEVER call `.characters` after binding.
- If you need to "fix" text content, update the VARIABLE value (`var.setValueForMode()`), not the node's characters.

### Expose Nested Instance Properties

Use `isExposedInstance = true` on instance nodes inside a component to expose their TEXT properties at the parent level:

```javascript
// Inside a Section component variant:
pricingCardInstance.isExposedInstance = true;
// → PricingCard's Tier, Price, F1, F2, F3 TEXT props appear in Section's property panel
```

**Depth rule**: Works on instances at any level in the component tree. Does NOT work on instances inside OTHER instances (inherited, read-only — expose at the inner component level instead).

**Verification gotcha**: `componentPropertyDefinitions` JS query does NOT reflect newly exposed props. Verify via Figma UI screenshot, not programmatic query.

### i18n Edge Case Testing

After binding STRING variables for multi-language support, **test all mode combinations for text overflow**:

1. Narrowest breakpoint (Mobile 375px) × each language
2. Widest breakpoint (Desktop 1440px) × each language
3. Cross with Light/Dark theme

**Rules for overflow-safe text:**
- Paragraph text: `w='fill'` + `textAutoResize: "HEIGHT"` (fills parent width, wraps as needed)
- Inline text (buttons, badges): `w='hug'` (auto-width, parent must accommodate)
- Numbers/metrics: keep format consistent across languages (use "10M+" not "1000万+")
- Avatar initials: single letter in ALL languages
- Never use FIXED width on text that changes with language

### Multi-Dimension Variable Architecture

For systems with responsive + theme + language:

```
Collections (3):
├─ Responsive (Desktop/Tablet/Mobile): FLOAT + BOOLEAN
│  └─ layout/pageWidth, layout/containerPad, typo/heroTitle, visibility/navLinks
├─ Theme (Light/Dark): COLOR
│  └─ bg, surface, primary, text-primary, text-secondary, border
└─ Lang (EN/CN): STRING
   └─ hero-title, hero-subtitle, nav/features, pricing/tier1, ...

Binding Flow:
Atom Components → bind FLOAT/COLOR/BOOLEAN vars at component level
  └─ Molecules (use atom instances) → inherit bindings
    └─ Sections (ComponentSet: Breakpoint=Desktop/Mobile)
       └─ isExposedInstance=true on nested instances
       └─ Section titles: componentPropertyReferences = { characters: propKey }
         └─ Page (section instances stacked) → set collection modes on root
```

### Mass Binding Protocol

When binding tokens to multiple nodes (mass bind):

**① Dry-run before binding**
Before calling `bind_variable`, print the planned mapping and verify each match:
```
node: "Hero/paddingTop" = 64  →  token: "LP-Spacing/3xl" (Tablet mode value = 64, diff = 0%)  ✓
node: "Hero/fontSize"   = 32  →  token: "LP-Type/h2"     (Tablet mode value = 36, diff = 11%) ⚠
```
Rule: `|token_mode_value - node_value| / node_value < 20%` → safe to bind. Exceeds threshold → pause, confirm with user before proceeding.

**② Mode-aware matching**
When the node is a Tablet or Mobile variant (name/variant property contains "Tablet"/"Mobile"), match against the **Tablet/Mobile mode column** from `list_variables` — not Desktop.

**③ Verify immediately after binding**
After binding, read the property back with `inspect`. Do not trust "should be OK". Binding overwrites the original value permanently — there is no undo.

### One-Way Flow: Token → Component → Binding

**Token design → Component design → Binding is strictly one-directional.**

Once nodes are bound to a token, changing that token's scale causes cascade pollution across all bound nodes. After binding begins:
- ✓ Fix: update the binding to point to a different token
- ✓ Fix: create a new token with the correct value and rebind
- ✗ Never: change an existing token's value after it has been bound — all nodes referencing it will shift

If a mismatch is discovered post-binding: **warn and pause**. Do not silently adjust token values. Ask the user to decide: rebind the node, or create a new token.

### Key Rules

- **Variables before nodes**: Create all variables FIRST, then create design nodes, then bind
- **Aliases for semantics**: Use `var alias` for semantic tokens → primitive tokens (not hardcoded values)
- **Verify with `var ls`**: Check created variables are correct before binding
- **Verify with `comp ls`**: Check component properties after creation
- **Collections organize by concern**: Colors, Spacing, Typography, Theme (not by component)
- **Test worst case**: Always test narrowest width × longest text × all themes after completing bindings
- **Never mix .characters with setBoundVariable**: Last write wins, they are mutually exclusive
