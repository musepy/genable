---
id: agent-page
name: Agent Page — Visual Design System Dashboard
description: Use when initializing or managing the .agent Figma page that holds the visual design system dashboard — Palette (color/spacing/typography) and Guide (usage docs) via component templates.
---

## AGENT PAGE — Visual Design System Dashboard

The `.agent` page is a dedicated Figma page that serves as:
1. **Agent context** — read Palette to know available tokens
2. **User editing surface** — users add/remove tokens directly on canvas
3. **Persistent memory** — Figma saves it across sessions

### Architecture: Template-First

**NEVER build layout structure from scratch.** Use component templates + fill values.

Component templates (stored on .agent page, name prefixed with `.`):

| Component | Properties | Purpose |
|-----------|-----------|---------|
| `.ColorScale` | ScaleName | Row of 12 color swatches |
| `.GuideHeader` | Title, Description | Dark header card |
| `.GuideSection` | Number, Title, Body | Documentation section with divider |
| `.SpacingBar` | Label, Value | Spacing visualization bar |
| `.TypoSample` | Label, Sample, Spec | Typography sample with spec |

### Workflow: Initialize .agent Page

#### Phase 1 — Create page and layout skeleton

```js
// Create .agent page (if not exists)
const existing = figma.root.children.find(p => p.name === '.agent')
if (!existing) {
  const page = figma.createPage()
  page.name = '.agent'
  await figma.setCurrentPageAsync(page)
}
```

```jsx
<frame name="Dashboard" layout="row" gap={80} p={40} w="hug" h="hug">
  <frame name="Palette" layout="column" gap={24} w="hug" h="hug">
    <frame name="Colors" layout="column" gap={2} p={16} corner={8} bg="$Colors/Gray/2" w="hug" h="hug" />
  </frame>
  <frame name="Guide" layout="column" gap={0} w={640} corner={12} h="hug" overflow="hidden" />
</frame>
```

This creates a two-column auto-layout:
- Left: Palette (Colors + Spacing + Typography)
- Right: Guide (Header + Sections)

No manual x/y positioning — auto-layout handles arrangement.

#### Phase 2 — Populate Colors from existing variables

For each color scale, instantiate `.ColorScale` and bind swatches to variables:

```js
const colorScaleComp = figma.currentPage.findOne(n => n.name === '.ColorScale' && n.type === 'COMPONENT')
const colorsContainer = figma.currentPage.findOne(n => n.name === 'Colors')
const allVars = await figma.variables.getLocalVariablesAsync()
const varMap = new Map(allVars.map(v => [v.name, v]))

const scales = ['Gray','Slate','Blue','Red','Green'] // adapt to file's actual scales

for (const scale of scales) {
  const inst = colorScaleComp.createInstance()
  inst.name = scale
  colorsContainer.appendChild(inst)

  // Set label
  const propKey = Object.keys(inst.componentProperties).find(k => k.startsWith('ScaleName'))
  if (propKey) inst.setProperties({ [propKey]: scale })

  // Bind swatches 1-12 to variables
  for (const child of inst.children) {
    const step = parseInt(child.name)
    if (isNaN(step)) continue
    const v = varMap.get(`Colors/${scale}/${step}`)
    if (v) {
      child.fills = [figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', v)]
    }
  }
}
```

Key rule: **swatch name = step number, parent name = scale name**.
Path `/Dashboard/Palette/Colors/Blue/9` maps to variable `Colors/Blue/9`.

#### Phase 3 — Populate Guide

Instance `.GuideHeader` and `.GuideSection` templates, fill text via properties:

```js
const headerComp = figma.currentPage.findOne(n => n.name === '.GuideHeader' && n.type === 'COMPONENT')
const sectionComp = figma.currentPage.findOne(n => n.name === '.GuideSection' && n.type === 'COMPONENT')
const guideContainer = figma.currentPage.findOne(n => n.name === 'Guide')

// Header
const header = headerComp.createInstance()
guideContainer.appendChild(header)
header.layoutSizingHorizontal = 'FILL'
header.setProperties({
  [findProp(header, 'Title')]: 'Design System Guide',
  [findProp(header, 'Description')]: 'Radix Themes v3.0 · 31 scales × 12 steps · Light / Dark'
})

// Section — repeat for each section
const s = sectionComp.createInstance()
guideContainer.appendChild(s)
s.layoutSizingHorizontal = 'FILL'
s.setProperties({
  [findProp(s, 'Number')]: '01',
  [findProp(s, 'Title')]: 'Scale Semantics',
  [findProp(s, 'Body')]: 'Step 1–2 Backgrounds...'
})

function findProp(inst, prefix) {
  return Object.keys(inst.componentProperties).find(k => k.startsWith(prefix))
}
```

#### Phase 4 — Populate Spacing and Typography

```js
const spacingComp = figma.currentPage.findOne(n => n.name === '.SpacingBar' && n.type === 'COMPONENT')
const typoComp = figma.currentPage.findOne(n => n.name === '.TypoSample' && n.type === 'COMPONENT')

// Spacing — instance + fill properties + resize bar
const spacings = [{label:'xs',value:'8'}, {label:'sm',value:'16'}, {label:'md',value:'32'}]
for (const sp of spacings) {
  const inst = spacingComp.createInstance()
  spacingContainer.appendChild(inst)
  inst.setProperties({ [findProp(inst,'Label')]: sp.label, [findProp(inst,'Value')]: sp.value })
  const bar = inst.children.find(c => c.name === 'Bar')
  if (bar) bar.resize(parseInt(sp.value), 20)
}

// Typography — instance + fill properties
const typos = [{label:'H1',sample:'Heading',spec:'48px / Medium'}]
for (const t of typos) {
  const inst = typoComp.createInstance()
  typoContainer.appendChild(inst)
  inst.setProperties({
    [findProp(inst,'Label')]: t.label,
    [findProp(inst,'Sample')]: t.sample,
    [findProp(inst,'Spec')]: t.spec
  })
}
```

### Reading Palette as Context

At the start of each design turn, read the Palette to understand available tokens:

```
tree /Dashboard/Palette/Colors/ -d 1
```

This returns all color scale names (Gray, Blue, Red, etc.). Path = variable name:
- `/Dashboard/Palette/Colors/Blue/9` → use as `fills:$Colors/Blue/9` in `mk`

For full context including spacing and typography:
```
tree /Dashboard/Palette/ -d 2
```

### Color Scale Semantics (Radix Convention)

| Step | Purpose | Usage |
|------|---------|-------|
| 1–2 | Backgrounds | Page bg, card bg (subtle) |
| 3–5 | Interactive | Hover states, active states |
| 6–8 | Borders | Subtle → strong borders |
| 9 | Solid fills | Buttons, badges, indicators |
| 10 | Solid hovered | Hover state for step 9 |
| 11 | Text (low contrast) | Body text, descriptions |
| 12 | Text (high contrast) | Headings, important text |

### Common Variable Patterns

```
Page bg           fills:$Colors/Gray/1
Card bg            fills:$Colors/Gray/2
Card border       stroke:$Colors/Gray/6
Heading text     fills:$Colors/Gray/12
Body text          fills:$Colors/Gray/11
Muted text        fills:$Colors/Gray/9
Primary button  fills:$Colors/{Accent}/9
Primary hover   fills:$Colors/{Accent}/10
Destructive        fills:$Colors/Red/9
Success             fills:$Colors/Green/9
Warning            fills:$Colors/Amber/9
```

Replace `{Accent}` with the project's accent color scale (e.g., Blue, Indigo, Violet).

### Key Rules

1. **Template first** — NEVER hand-build Palette/Guide structure. Instance components + fill values.
2. **Auto-layout only** — Use `layout:row`/`layout:column` containers. No manual x/y positioning.
3. **Path = variable** — `/Palette/Colors/{Scale}/{Step}` maps to `$Colors/{Scale}/{Step}`.
4. **Read before create** — `tree /Dashboard/Palette/` before designing. Use existing tokens.
5. **User editable** — Users can add/remove color scales, spacing bars, guide sections directly on canvas.
6. **Bind, don't hardcode** — Always `fills:$Colors/Blue/9` never `fills:#3E63DD`.

### Discovering Existing Variables

Before initializing, check what variables exist:

```
var ls
```

If a file has Radix color variables (Colors/Gray/1 through Colors/Sky/12), use them directly.
If a file has custom variables, adapt the Palette to show those scales.
Do NOT create duplicate variables — bind to what exists.
