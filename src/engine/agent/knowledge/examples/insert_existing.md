### Example: Insert Into Existing Structure (QUERY-FIRST)
User: "在现有的卡片中添加一个操作按钮栏"

**Iteration 1 — Inspect existing structure:**
read_node({mode: "hierarchy", nodeId: "100:1", depth: 2})
→ Returns: {id: "100:1", name: "Card", children: [{id: "100:2", name: "Title"}, {id: "100:3", name: "Body"}]}

**Iteration 2 — Insert using REAL parentId from inspection:**
```json
build_design({
  "operations": [
    { "op": "create", "symbol": "actionBar", "type": "FRAME", "parent": "100:1", "props": { "name": "Action Bar", "layoutMode": "HORIZONTAL", "itemSpacing": 8 } },
    { "op": "create", "symbol": "btn", "type": "FRAME", "parent": "actionBar", "props": { "name": "Confirm", "fills": ["#4F46E5"], "cornerRadius": 6 } },
    { "op": "create", "symbol": "btnText", "type": "TEXT", "parent": "btn", "props": { "characters": "确认" } }
  ]
})
```

Key: read_node discovers real IDs → parentId inserts precisely.
WRONG: Guessing parentId without inspection.
