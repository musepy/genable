## EXAMPLES

### Example 1: batchOperations — Build a Complete Component in ONE Call ✅ (PREFERRED)
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

---

### Example 2: Build an Entire Section Per Iteration ✅
User: "Create a login form"

**Iteration 1 (2 tool calls):**
batchOperations({operations: [
  { opId: "form", action: "createNode", params: { type: "FRAME", name: "Login Form", props: { layoutMode: "VERTICAL", gap: 16, padding: 24 } } },
  { opId: "title", action: "createNode", params: { type: "TEXT", name: "Form Title", parentRef: "form", props: { characters: "Sign In" } } },
  { opId: "email", action: "createNode", params: { type: "FRAME", name: "Email Input", parentRef: "form", props: { layoutMode: "HORIZONTAL", padding: 12, cornerRadius: 8, strokes: ["#D0D5DD"] } } },
  { opId: "emailLabel", action: "createNode", params: { type: "TEXT", name: "Email Text", parentRef: "email", props: { characters: "email@example.com" } } },
  { opId: "password", action: "createNode", params: { type: "FRAME", name: "Password Input", parentRef: "form", props: { layoutMode: "HORIZONTAL", padding: 12, cornerRadius: 8, strokes: ["#D0D5DD"] } } },
  { opId: "pwLabel", action: "createNode", params: { type: "TEXT", name: "Password Text", parentRef: "password", props: { characters: "••••••••" } } },
  { opId: "btn", action: "createNode", params: { type: "FRAME", name: "Sign In Button", parentRef: "form", props: { layoutMode: "HORIZONTAL", padding: 12, fills: ["#4F46E5"], cornerRadius: 8 } } },
  { opId: "btnText", action: "createNode", params: { type: "TEXT", name: "Button Label", parentRef: "btn", props: { characters: "Sign In" } } }
]})
summarize_progress({summary: "Login form created with all fields and button", isComplete: true})

✅ Entire form built in 1 iteration with 2 tool calls using flat props.
❌ WRONG: Creating 1 node per iteration = 8 iterations = waste.

---

### Example 3: Error Recovery
User: "添加 HUG 尺寸"

**Attempt:**
setNodeLayout({nodeId: "100:1", sizing: {horizontal: "HUG"}})
→ Error: {code: "INVALID_SIZING", message: "HUG requires Auto Layout context"}

**Recovery:**
setNodeLayout({nodeId: "100:1", layoutMode: "VERTICAL", sizing: {horizontal: "HUG"}})
→ Success: {success: true}

---

### Example 4: Insert Into Existing Structure ✅ (QUERY-FIRST)
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
