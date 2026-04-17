---
name: httpbridge-api-test
description: Test Figma plugin API features directly via HTTP bridge — create nodes, screenshot, visual verify, property verify, report issues. Use after adding new API support, changing tool/executor/nodeFactory logic, or before shipping feature changes.
triggers:
  - "测试新 API"
  - "http bridge 测试"
  - "API 功能测试"
  - "test new feature"
  - "bridge test"
  - "验证 API 支持"
  - "跑一下看看效果"
---

# HTTP Bridge API Test

Direct Figma API feature testing via HTTP bridge. Claude Code creates nodes, takes screenshots, verifies visual output, then checks properties. NOT the same as E2E agent testing (that's `dogfood-batch-run` / `prompt-iteration-e2e`).

## When to use

- New Figma API support added (e.g. grid layout, arc/ring, vectorPaths, star/polygon)
- Changed nodeFactory, executor, shorthand expanders, or property registry
- Changed tool definitions (parameters, validation, output format)
- Before shipping: "does this actually render correctly on the Figma canvas?"

## When NOT to use

- Testing agent behavior / prompt quality → `dogfood-batch-run` or `prompt-iteration-e2e`
- Testing LLM tool call patterns → `trigger-log-audit`
- One-off design creation → `figma-http-bridge` skill directly

## Prerequisites

```bash
# 1. HTTP bridge running
curl -s http://localhost:3460/health | python3 -m json.tool

# 2. Figma file connected
curl -s http://localhost:3460/clients
# → must show at least one client
```

If bridge not running: `npx tsx tools/mcp-server/httpBridge.ts`

## The Golden Rule

> **Property pass ≠ visual pass.** JSON says the attribute was written. Screenshot shows whether it rendered.

Every test follows: **Create → Screenshot → See → Verify → Report**

## Step 1 — Create test nodes

Use `jsx` to create test cases. Design for **visibility**:

```bash
curl -s -X POST "http://localhost:3460/tool/jsx" \
  -H "Content-Type: application/json" \
  -d '{"markup": "<frame name=\"Test\" w={400} h={300} layout=\"col\" gap={16} p={24} bg=\"#FFFFFF\" cornerRadius={12}>...</frame>"}'
```

### Visibility checklist (BEFORE creating)

- [ ] Shapes large enough to see: **minimum 80px** for shapes, 120px+ preferred
- [ ] Has visible fill OR stroke with weight ≥ 3px (thin strokes vanish at normal zoom)
- [ ] Text labels have contrasting fill color
- [ ] Container has background color to show boundaries
- [ ] Container uses auto-layout (layout="col"/"row") with gap and padding — not absolute positioning

### Sizing guidelines

| Node type | Minimum | Recommended |
|---|---|---|
| Vector/Star/Polygon | 80×80 | 120×120 |
| Ellipse (arc/ring) | 80×80 | 120×120 |
| Text label | size ≥ 12 | size ≥ 14 |
| Test container | 400 wide | 600-800 wide |
| Stroke weight | ≥ 2 | ≥ 3 |

## Step 2 — Screenshot (MANDATORY)

Every created node must be screenshotted. No exceptions.

```bash
# Screenshot a node — mode: "detail" is REQUIRED for screenshot to work
curl -s -X POST "http://localhost:3460/tool/inspect" \
  -H "Content-Type: application/json" \
  -d '{"node": "<ID>", "mode": "detail", "screenshot": true}' \
  | python3 -c "
import json, sys, base64
d = json.loads(sys.stdin.read())
img = d['data']['__image']  # Field name is __image, NOT screenshot
raw = base64.b64decode(img['data'])
path = '/tmp/test_screenshot.png'
with open(path, 'wb') as f: f.write(raw)
print(f'Saved: {len(raw)} bytes → {path}')
"
```

Then **read the screenshot file** to actually look at it:

```
Read /tmp/test_screenshot.png
```

### Screenshot gotchas

| Gotcha | Fix |
|---|---|
| `screenshot: true` but no `__image` in response | Must add `mode: "detail"` — screenshot only works in detail mode |
| Field name is `__image`, not `screenshot` | `d['data']['__image']['data']` = base64, `mimeType` = "image/png" |
| Screenshot fails silently | Check response keys first before parsing |

## Step 3 — Self-check (STOP and answer these)

After viewing the screenshot, answer each question honestly:

1. **Can I see all the nodes I created?** If not → sizing/fill/stroke issue
2. **Are they inside their container?** If not → parent parameter or layout issue
3. **Is the layout reasonable?** No overlapping, no overflow, proper spacing?
4. **Do the shapes look correct?** Arc is actually an arc? Star has points? Vector path has the right shape?
5. **Are labels readable?** Not clipped, not overlapping shapes?

If ANY answer is "no" → fix before proceeding to property verification.

## Step 4 — Property verification

Only AFTER visual pass. Use `inspect` detail mode or `js` tool for properties not in inspect output.

```bash
# inspect for standard properties
curl -s -X POST "http://localhost:3460/tool/inspect" \
  -H "Content-Type: application/json" \
  -d '{"node": "<ID>", "mode": "detail"}'

# js tool for properties inspect doesn't expose
# IMPORTANT: use Async API (getNodeByIdAsync, not getNodeById)
curl -s -X POST "http://localhost:3460/tool/js" \
  -H "Content-Type: application/json" \
  -d '{"code": "const n = await figma.getNodeByIdAsync(\"<ID>\"); return { arcData: n.arcData, pointCount: n.pointCount }"}'
```

### js tool gotchas

| Gotcha | Fix |
|---|---|
| `getNodeById` throws "Cannot call with documentAccess: dynamic-page" | Use `figma.getNodeByIdAsync()` (async version) |
| Object properties serialize as `[object Object]` | Manually map: `.map(p => ({key: p.key, val: p.val}))` |

## Step 5 — Report

Produce a results table:

| Feature | Visual | Properties | Status | Issue |
|---|---|---|---|---|
| Grid 3×2 | ✅ cells visible, proper layout | layoutMode=GRID, cols=3, rows=2 | PASS | — |
| Arc 270° | ✅ pie slice visible | arcData.endingAngle=4.71 | PASS | — |
| Star 5pt | ❌ empty, not visible | type=VECTOR (wrong) | FAIL | createShape missing STAR support |

**Both columns (Visual + Properties) must pass for the feature to pass.**

## Step 6 — Optimization suggestions

After testing, identify and report:

### For HTTP bridge (中间件层)
- API ergonomics issues: parameters that silently fail, unintuitive field names, missing defaults
- Pit-of-success violations: correct usage requires hidden knowledge

### For plugin tools (工具层)
- Missing property coverage in inspect output
- Node types not supported in creation pipeline
- Serialization issues in tool responses

### For prompt/knowledge (LLM 指导层)
- New API features that need knowledge entries or prompt examples
- JSX syntax that needs documenting in tool descriptions

## Known issues (as of 2026-04-17)

| Issue | Layer | Status |
|---|---|---|
| `screenshot` requires `mode: "detail"` — silently ignored otherwise | bridge | open |
| Response uses `__image` instead of `screenshot` | bridge | open |
| `getNodeById` fails, must use async | js tool | open |
| inspect detail doesn't expose arcData, pointCount, innerRadius, vectorPaths | inspect tool | open |
| vectorPaths serializes as [object Object] | inspect tool | open |
| Star/Polygon: createShape() missing figma.createStar()/createPolygon() | nodeFactory | open |
| jsx `parent` parameter may not work via HTTP bridge | bridge/jsx | needs investigation |

## Anti-patterns

- **"JSON pass = test pass"** — the #1 failure mode. Property written ≠ visually correct.
- **Skipping screenshot because it "failed"** — investigate WHY it failed. Usually a parameter issue.
- **48px vectors with 1px stroke** — invisible at normal zoom. Design for visibility.
- **Creating all test nodes then verifying all at once** — screenshot each group right after creation.
- **Using absolute positioning in test layouts** — use auto-layout (layout="col"/"row") so children don't overlap.

## Related

- `figma-http-bridge` — API reference for HTTP bridge tools
- `dogfood-batch-run` — E2E agent testing via dev bridge
- `prompt-iteration-e2e` — single-prompt agent rule-compliance loop
- `tool-change-checklist` — checklist when modifying tool definitions
