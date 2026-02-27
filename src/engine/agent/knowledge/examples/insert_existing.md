### Example: Insert Into Existing Structure ✅ (QUERY-FIRST)
User: "在现有的卡片中添加一个操作按钮栏"

**Iteration 1 — Inspect existing structure:**
inspectDesign({mode: "hierarchy", nodeId: "100:1", depth: 2})
→ Returns: {id: "100:1", name: "Card", children: [{id: "100:2", name: "Title"}, {id: "100:3", name: "Body"}]}

**Iteration 2 — Insert using REAL parentId from inspection:**
batchOperations({operations: [
  {opId: "action-bar", action: "createNode", params: {type: "FRAME", name: "Action Bar", parentId: "100:1", props: {layoutMode: "HORIZONTAL", gap: 8}}},
  {opId: "btn", action: "createNode", params: {type: "FRAME", name: "Confirm", parentRef: "action-bar", props: {fills: ["#4F46E5"], cornerRadius: 6, children: [
    {opId: "btn-text", action: "createNode", params: {type: "TEXT", props: {characters: "确认"}}}
  ]}}}
]})

✅ Key: inspectDesign discovers real IDs → parentId inserts precisely.
❌ WRONG: Guessing parentId without inspection.
