### Example: Build an Entire Section Per Iteration ✅
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
signal({type: "progress", summary: "Login form created with all fields and button"})
signal({type: "complete", summary: "Login form created with all fields and button"})

✅ Entire form built in 1 iteration with 2 tool calls using flat props.
❌ WRONG: Creating 1 node per iteration = 8 iterations = waste.
