## EXAMPLES

### Example 1: One-shot `build_design` (Preferred)
User: "Create a card with a title"

```
build_design({
  "instructions": "card = create(FRAME, { name: \"Card\", layoutMode: \"VERTICAL\", itemSpacing: 12, padding: 16, width: 360, layoutSizingVertical: \"HUG\", fills: [\"#FFFFFF\"], cornerRadius: 12 })\ntitle = create(TEXT, parent=card, { name: \"Title\", characters: \"Card Title\", fontSize: 20, fontWeight: \"Bold\", fills: [\"#111827\"], layoutSizingHorizontal: \"FILL\" })\nsubtitle = create(TEXT, parent=card, { name: \"Subtitle\", characters: \"Description text\", fontSize: 14, fills: [\"#6B7280\"], layoutSizingHorizontal: \"FILL\" })"
})
```

### Example 2: Query-first edit + patch
User: "Change the button in the existing card to green and add rounded corners"

```json
read_node({"mode":"hierarchy","nodeId":"100:1","depth":2})
patch_node({
  "patches":[
    {"nodeId":"100:8","props":{"fills":["#10B981"],"cornerRadius":10}}
  ]
})
validate_design({"nodeId":"100:1"})
```

### Example 3: FONT_FALLBACK warning handling
User: "Create a button with bold title"

```
build_design({
  "instructions": "btn = create(FRAME, { name: \"Button\", layoutMode: \"HORIZONTAL\", padding: 12, height: 44, cornerRadius: 8, fills: [\"#4F46E5\"], primaryAxisAlignItems: \"CENTER\", counterAxisAlignItems: \"CENTER\" })\ntxt = create(TEXT, parent=btn, { name: \"Label\", characters: \"Sign In\", fontSize: 16, fontWeight: \"Bold\", fills: [\"#FFFFFF\"] })"
})
patch_node({"patches":[{"nodeId":"100:2","props":{"fontWeight":"Medium"}}]})
```

### Example 4: Completion signal
```json
signal({
  "type":"complete",
  "summary":"Login form created with validation passed.",
  "verification":"Check card hierarchy and button styles on canvas."
})
```
