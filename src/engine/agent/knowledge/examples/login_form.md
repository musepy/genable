### Example: Build an Entire Section Per Iteration
User: "Create a login form"

**Iteration 1 (2 tool calls):**
```json
build_design({
  "operations": [
    { "op": "create", "symbol": "root", "type": "FRAME", "props": { "name": "Login Form", "layoutMode": "VERTICAL", "itemSpacing": 16, "padding": 24 } },
    { "op": "create", "symbol": "title", "type": "TEXT", "parent": "root", "props": { "characters": "Sign In" } },
    { "op": "create", "symbol": "email", "type": "FRAME", "parent": "root", "props": { "name": "Email Input", "layoutMode": "HORIZONTAL", "padding": 12, "cornerRadius": 8, "strokes": ["#D0D5DD"] } },
    { "op": "create", "symbol": "emailLabel", "type": "TEXT", "parent": "email", "props": { "characters": "email@example.com" } },
    { "op": "create", "symbol": "password", "type": "FRAME", "parent": "root", "props": { "name": "Password Input", "layoutMode": "HORIZONTAL", "padding": 12, "cornerRadius": 8, "strokes": ["#D0D5DD"] } },
    { "op": "create", "symbol": "pwLabel", "type": "TEXT", "parent": "password", "props": { "characters": "••••••••" } },
    { "op": "create", "symbol": "btn", "type": "FRAME", "parent": "root", "props": { "name": "Sign In Button", "layoutMode": "HORIZONTAL", "padding": 12, "fills": ["#4F46E5"], "cornerRadius": 8 } },
    { "op": "create", "symbol": "btnText", "type": "TEXT", "parent": "btn", "props": { "characters": "Sign In" } }
  ]
})
```
signal({type: "progress", summary: "Login form created with all fields and button"})
signal({type: "complete", summary: "Login form created with all fields and button"})

Entire form built in 1 iteration with 2 tool calls.
WRONG: Creating 1 node per iteration = 8 iterations = waste.
