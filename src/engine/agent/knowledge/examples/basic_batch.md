### Example: batchOperations — Build a Complete Component in ONE Call ✅ (PREFERRED)
User: "创建一个带标题的卡片"

**ONE batchOperations call creates the entire component:**
batchOperations({
  operations: [
    { opId: "card", action: "createNode", params: { type: "FRAME", name: "Card Container", props: { layoutMode: "VERTICAL", padding: 16, gap: 12, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", width: 360, fills: ["#FFFFFF"], cornerRadius: 12, effects: [{"type": "DROP_SHADOW", "color": "#0000001A", "offset": {"x": 0, "y": 4}, "blur": 16}] } } },
    { opId: "title", action: "createNode", params: { type: "TEXT", name: "Card Title", parentRef: "card", props: { characters: "卡片标题", layoutSizingHorizontal: "FILL", fills: ["#111827"] } } },
    { opId: "subtitle", action: "createNode", params: { type: "TEXT", name: "Card Subtitle", parentRef: "card", props: { characters: "描述文字", layoutSizingHorizontal: "FILL", fills: ["#6B7280"] } } }
  ]
})
→ Returns: { results: [{opId: "card", nodeId: "100:1"}, {opId: "title", nodeId: "100:2"}, {opId: "subtitle", nodeId: "100:3"}] }

✅ All nodes + layout + styles in 1 tool call using flat props.
