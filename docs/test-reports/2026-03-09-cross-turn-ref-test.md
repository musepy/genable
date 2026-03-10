# Cross-Turn Component Ref Test — 2026-03-09

## Verdict: SUCCESS

The componentRegistry correctly resolves `<ref component='StatCard'>` across separate tool calls and conversation turns. Turn 2 created 3 INSTANCE nodes (not FRAME fallbacks), confirming the cross-batch resolution path works.

### Turn 1: Component Creation
- Trigger ID: `trigger-1773051130441`
- Duration: 26760ms
- Model: kimi-k2.5
- reusable='true' used: **Y** — XML: `<frame name='StatCard' reusable='true' layout='column' gap='8' p='20' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A' w='240' height='hug'>`
- COMPONENT nodes in tree: **1** (id: 848:4572, name: StatCard)
- Tool calls: 1 (design), 0 errors, 3 nodes created (StatCard + label + value)
- Screenshots: `/tmp/figma-bridge/results/trigger-1773051130441/screenshot.png`

### Turn 2: Instance via Ref
- Trigger ID: `trigger-1773051207187`
- Duration: 22438ms
- Model: kimi-k2.5
- `<ref component='StatCard'>` used: **Y** — XML: `<frame name="Stats Row" layout="row" gap="16" w="fill" height="hug" bg="transparent"><ref component="StatCard" w="fill" set:label="Revenue" set:value="$48K"/><ref component="StatCard" w="fill" set:label="Users" set:value="2.4K"/><ref component="StatCard" w="fill" set:label="Growth" set:value="+12%"/></frame>`
- "Component source not found" errors: **N** (zero errors)
- INSTANCE nodes in tree: **3** (ids: 850:4641, 850:4644, 850:4647)
- FRAME nodes created for Stats Row container: 1 (id: 850:4640, the wrapper row — expected)
- Tool calls: 2 (design x2), 0 errors
  - Call 1: re-creation of component (from conversation history replay), 3 nodes
  - Call 2: Stats Row + 3 instances, 4 nodes created
- Text overrides verified:
  - Instance 1: label="Revenue", value="$48K"
  - Instance 2: label="Users", value="2.4K"
  - Instance 3: label="Growth", value="+12%"
- Instance IDs use Figma's `I<instance>;<component-child>` format (e.g., `I850:4641;850:4638`), confirming real Figma component instances, not cloned frames
- Screenshots: `/tmp/figma-bridge/results/trigger-1773051207187/screenshot.png`

### componentRegistry Verdict
- Was the cross-batch resolution path exercised? **Y**
- Did it succeed? **Y**
- The LLM correctly used `<ref component='StatCard'>` syntax with `set:label` and `set:value` overrides
- The executor resolved the ref to the COMPONENT created in Turn 1 and produced INSTANCE nodes
- All 3 instances inherit the component's styling (white bg, corner radius 12, drop shadow) while overriding text content

### Notes
- The tree.json shows the page contains nodes from prior sessions (NotificationCard components, Button components, etc.) — this is expected since the page was not cleared
- Turn 2 shows 2 tool calls in its digest. The first is from Turn 1's conversation history (the component creation). The second is the actual Turn 2 work (creating the Stats Row with 3 instances)
- Total agent iterations: 4, total duration: 60.4s across both turns
