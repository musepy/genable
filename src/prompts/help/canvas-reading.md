---
id: canvas-reading
title: Canvas Reading (3-Tool Progressive Pattern)
keywords: [context, outline, inspect, read, canvas, page, structure, skeleton, styles, screenshot, suggestedReads, XML, progressive-read, overview, navigation]
whenToUse: When reading the canvas to understand what exists before making edits
---

## CANVAS READING (3-Tool Progressive Pattern)

Three tools for reading the canvas, from broad to detailed:

### context() — "What's on the canvas?"
No parameters. Returns page name, top-level children (shallow skeleton), and current user selection.
Call this FIRST when you don't know what's on the canvas.

### outline(nodeId, depth?) — "What's the structure?"
Structural skeleton: id, name, type, dimensions (w/h), layout mode, position (x/y). ~100-300 tokens.
Use for navigation, discovering children, planning edits.
Returns `suggestedReads` — IDs of complex children worth inspecting.

### inspect(nodeId, depth?, screenshot?) — "What does it look like?"
Full styles: fills, fonts, effects, padding, cornerRadius, shadow, etc.
Auto-degrades to skeleton + hint when tree is large (>2500 chars).
Set screenshot=true to capture a visual screenshot.

### Progressive Reading Pattern
1. `context()` — see page overview, find root node IDs
2. `outline(rootId)` — discover structure, get child IDs + suggestedReads
3. `inspect(childId)` — get full details for specific subtrees
4. `design(...)` — edit based on detailed inspection

### XML Output Format (read tools)
Read tools return compact XML. Note: read output is XML, write input is flat ops — they are different formats.

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

**Example outline output** (structural skeleton):
```xml
<frame id="1:2" name="Card" layout="V" w="320" sizingV="HUG">
  <text id="3:4" name="Title">Welcome</text>
  <rect id="7:8" name="Divider" h="1"/>
</frame>
```

**Example inspect output** (full styles):
```xml
<frame id="1:2" name="Card" layout="V" gap="12" fill="#FFF" w="320" sizingV="HUG" p="24">
  <text id="3:4" name="Title" size="24" weight="Bold" fill="#111" textAutoResize="WIDTH_AND_HEIGHT">Welcome</text>
  <rect id="7:8" name="Divider" h="1" fill="#E0E0E0"/>
</frame>
```
