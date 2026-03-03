### Example: build_design — Build a Complete Component in ONE Call (PREFERRED)
User: "创建一个带标题的卡片"

**ONE build_design call creates the entire component:**
```json
build_design({
  "operations": [
    { "op": "create", "symbol": "card", "type": "FRAME", "props": { "name": "Card Container", "width": 360, "layoutSizingVertical": "HUG", "layoutMode": "VERTICAL", "padding": 16, "itemSpacing": 12, "fills": ["#FFFFFF"], "cornerRadius": 12, "effects": [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":4},"radius":16}] } },
    { "op": "create", "symbol": "title", "type": "TEXT", "parent": "card", "props": { "characters": "卡片标题", "layoutSizingHorizontal": "FILL", "fills": ["#111827"] } },
    { "op": "create", "symbol": "subtitle", "type": "TEXT", "parent": "card", "props": { "characters": "描述文字", "layoutSizingHorizontal": "FILL", "fills": ["#6B7280"] } }
  ]
})
```
→ Returns: idMap with symbol → real Figma node ID mappings

All nodes + layout + styles in 1 tool call using flat props.
