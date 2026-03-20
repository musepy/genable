---
id: canvas-reading
title: Canvas Reading (ls/tree/cat Progressive Pattern)
keywords: [ls, tree, cat, read, canvas, page, structure, skeleton, styles, screenshot, suggestedReads, XML, progressive-read, overview, navigation, path, filesystem]
whenToUse: When reading the canvas to understand what exists before making edits
---

## CANVAS READING (ls/tree/cat — Filesystem Pattern)

Three commands for reading the canvas, from broad to detailed. Path-based addressing: "/" for page root, "/NodeName/" for named nodes.

### ls(path) — "What's here?"
Lists direct children at a path. Shows name, type, dimensions, layout info.
Call this FIRST when you don't know what's on the canvas.
- `ls({path: "/"})` — page root children
- `ls({path: "/Card/"})` — Card's children

### tree(path, depth?) — "What's the structure?"
Structural tree: id, name, type, dimensions (w/h), layout mode. ~100-300 tokens.
Use for navigation, discovering children, planning edits.
Returns `suggestedReads` — paths of complex children worth inspecting with cat.
- `tree({path: "/Card/"})` — Card subtree
- `tree({path: "/", depth: 3})` — page structure, depth 3

### cat(path, depth?, screenshot?) — "What does it look like?"
Full styles: fills, fonts, effects, padding, cornerRadius, shadow, etc.
Auto-degrades to skeleton + hint when tree is large (>2500 chars).
Set screenshot=true to capture a visual screenshot.
- `cat({path: "/Card/Header/"})` — full Header properties
- `cat({path: "/Card/", screenshot: true})` — props + screenshot

### Progressive Reading Pattern
1. `ls({path: "/"})` — see page overview, find root node names
2. `tree({path: "/Card/"})` — discover structure, get suggestedReads
3. `cat({path: "/Card/Header/Title"})` — get full details for specific nodes
4. `mk /Card/Header/Title size:28` — edit based on detailed inspection

### Path Resolution
- "/" = current page root
- "/Card/" = child named "Card"
- "/Card/Header/Title" = nested path
- "/100:5/" = direct Figma node ID (use when name is ambiguous)

### XML Output Format (read tools)
tree and cat return compact XML. Note: read output is XML, write input is flat ops — they are different formats.

**Tag mapping**: FRAME→`<frame>`, TEXT→`<text>`, RECTANGLE→`<rect>`, VECTOR→`<vector>`, LINE→`<line>`, ELLIPSE→`<ellipse>`, GROUP→`<group>`, SECTION→`<section>`, ICON→`<icon>`

**Attribute abbreviations**:
- `layout` = layoutMode (V/H/NONE), `w` = width, `h` = height
- `sizingH` = layoutSizingHorizontal, `sizingV` = layoutSizingVertical
- `alignMain` = primaryAxisAlignItems, `alignCross` = counterAxisAlignItems
- `corner` = cornerRadius, `strokeW` = strokeWeight
- `p` = padding (compact: `p="16"` or `p="16 24"` or `p="10 20 30 40"`)
- `size` = fontSize, `weight` = fontWeight, `font` = fontFamily
- `fill` = single fill color, `fills` = multiple fill colors
- `shadow` = effects (format: `ox,oy,blur,spread,color`)

**Text content** appears as tag body: `<text size="16" weight="Bold" fill="#111827" textAutoResize="WIDTH_AND_HEIGHT">Hello World</text>`

**Example tree output** (structural skeleton):
```xml
<frame id="1:2" name="Card" layout="V" w="320" sizingV="HUG">
  <text id="3:4" name="Title">Welcome</text>
  <rect id="7:8" name="Divider" h="1"/>
</frame>
```

**Example cat output** (full styles):
```xml
<frame id="1:2" name="Card" layout="V" gap="12" fill="#FFF" w="320" sizingV="HUG" p="24">
  <text id="3:4" name="Title" size="24" weight="Bold" fill="#111" textAutoResize="WIDTH_AND_HEIGHT">Welcome</text>
  <rect id="7:8" name="Divider" h="1" fill="#E0E0E0"/>
</frame>
```
