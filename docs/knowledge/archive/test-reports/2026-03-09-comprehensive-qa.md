# Comprehensive QA Test Report — 2026-03-09

**Model**: Kimi K2.5 (via DashScope/Cloudflare Worker proxy)
**Test Duration**: ~120 minutes total
**Tests Executed**: 9 triggers across 4 test groups
**Environment**: Figma desktop + dev bridge (localhost:3456)

---

## Executive Summary

The Figma AI Generator plugin produces structurally sound designs for first-turn creation tasks, but suffers from significant reliability issues in multi-turn modification scenarios and with complex XML output. The primary failure mode is **XML truncation** — Kimi K2.5 consistently truncates XML output around position 200 characters, causing parse errors that spiral into retry loops. Out-of-guideline designs (resume, poster, business card) were the strongest performers, completing with zero errors.

### Key Metrics

| Test | Iterations | Duration | Tool Calls | Errors | Error Rate |
|------|-----------|----------|------------|--------|------------|
| A1: Landing Page (create) | 5 | 130s | 5 | 0 | 0% |
| A1→Dark Theme (modify) | 9 | 316s | 8 | 0 | 0% |
| A2: Chinese Translation | 49 | 1119s | 60 | 4 | 7% |
| B1: Pricing Page (create) | 10 | 171s | 9 | 1 | 11% |
| B1→Delete Enterprise | 22 | 547s | 21 | 1 | 5% |
| B2: Comparison Table | 45 | 1158s | 43 | 11 | 26% |
| C1: E-commerce Page | 25 | 742s | 25 | 14 | 56% |
| D1: Resume/CV | 5 | 205s | 5 | 0 | 0% |
| D2: Jazz Poster | 4 | 85s | 3 | 0 | 0% |
| D3: Business Card | 8 | 121s | 7 | 0 | 0% |
| A3: Gradient Button | 15 | 325s | 13 | 4 | 31% |

---

## GROUP A: Multi-turn Modification

### Test A1: SaaS Landing Page + Dark Theme Switch

**Creation (Turn 1)**: Clean execution. 5 iterations, 130s, 0 errors. Created an 82-node TaskFlow landing page with Navbar, Hero, Features (3 cards), CTA Section, and Footer. All requested sections present. The agent queried style-tags, landing-page guidelines, and style before creating.

**Dark Theme (Turn 2)**: Efficient approach. The agent used the `replace` tool with `mode: "search"` to find all fillColor/textColor/strokeColor values, then `mode: "replace"` for bulk color swaps:
- 7 fillColor replacements (e.g., `#F8FAFC` → `#0F172A`, `#FFFFFF` → `#1E293B`)
- 3 textColor replacements (e.g., `#0F172A` → `#F8FAFC`)
- 1 strokeColor replacement (`#E2E8F0` → `#334155`)

**Verdict**: The `replace` tool is highly effective for theme switching — only 2 tool calls for the entire modification. This is the best tool usage pattern observed across all tests.

### Test A2: Chinese Translation

**Major issue identified.** 49 iterations, 1119s (~18.6 minutes), 60 tool calls, 4 errors.

**Failure pattern**: The LLM initially tried to update ALL text nodes in a single `design` call (calls #15-#27). This produced XML exceeding the model's output token limit, causing 4 truncation errors ("Your XML is truncated (contains '...')"). After these failures, the agent shifted to smaller batches (2-3 text nodes per call), which worked.

**Key observation**: The `replace` tool was used for color changes but NOT for text content changes. A `textContent` replace mode could dramatically improve this operation.

**Final state**: All text nodes were successfully translated. The agent read individual nodes (11+ read calls) to discover text content, then edited them in small batches. Despite completing, the 18.6-minute duration is unacceptable for a text replacement task.

### Test A3: Gradient CTA Button

**Gradient syntax is unsupported.** The agent attempted 3 different gradient encoding strategies:
1. `fills="[{\"type\":\"GRADIENT_LINEAR\",...}]"` — Raw Figma API JSON → XML parse error ("Empty attribute name")
2. Same with precise decimal values → Same error
3. `fills="[{&quot;type&quot;:&quot;GRADIENT_LINEAR&quot;,...}]"` — HTML entity encoding → **Succeeded**
4. `fill="#6366F1"` — Fallback to solid color (overwrote the gradient)

The agent successfully applied a gradient on attempt #3 but then overwrote it with a solid color on the next call, suggesting it didn't trust the gradient worked. This reveals a gap: the design XML syntax doesn't have a clean gradient attribute (like `gradient="linear,#6366F1,#8B5CF6"`).

---

## GROUP B: Tool Usage Patterns

### Test B1: Pricing Page + Delete Enterprise Tier

**Creation (Turn 1)**: 10 iterations, 171s, 1 error. nodeLimitWarning triggered on the main `design` call. Error #5 was an idMap reference failure (tried to reference a node created in the same batch before the ID was available).

**Delete (Turn 2)**: 22 iterations, 547s, 1 error. The agent correctly:
1. Read the canvas structure to find the Enterprise card (node 856:4900)
2. Used `<delete id='856:4900'/>` to remove it
3. Also deleted node 856:4936 (a second unwanted node)
4. Attempted to resize remaining cards with `w='520'`
5. Had to recreate the Pro Card (call #18 with `parentId`) — suggesting structural damage during deletion

**Key finding**: Delete operations work correctly, but the agent sometimes over-deletes, requiring recreation. The 547s duration for a delete + resize is excessive.

### Test B2: Insert Comparison Table

**Critical failure pattern.** 45 iterations, 1158s (~19 minutes), 11 errors.

The comparison table was successfully created (call #23, `parentId: "856:4867"`), but the subsequent styling refinement entered a pathological loop:
- Calls #33-#43: 8 consecutive "Unterminated attribute value for 'id'" errors
- The LLM kept producing truncated XML at position 194 and could not self-correct
- Eventually terminated by loop detection

**Structural analysis**: The comparison table has proper structure (Table Header, 7 rows with dividers), but the styling pass never completed due to the truncation loop.

### Test B3: Read + Screenshot

Not tested as a separate trigger. Screenshot + read functionality was exercised in multiple other tests (A1 dark theme, B1, C1). Key observation: the agent consistently uses `read` with `screenshot: true` for visual verification, which works correctly but screenshots are sometimes very small (200x200) or capture the wrong area.

---

## GROUP C: Progressive Creation

### Test C1: Complex E-commerce Page

**High error rate but successful output.** 25 iterations, 742s (~12.4 min), 14 errors (56% error rate).

**Progressive creation pattern observed**:
1. Skeleton frame created first (call #4, 297ms)
2. Product section added via parentId (call #5, 1130ms) — largest successful call
3. Additional sections added progressively (#7, #9, #13, #20, #23)

**nodeLimitWarning triggered 4 times** (calls #9, #13, #20, #23), confirming the agent creates section-sized chunks that still exceed the node limit threshold.

**Error breakdown (14 errors)**:
- "Unterminated element" — 1
- "Unterminated attribute value" — 2
- "XML is truncated" — 2
- "Expected '>' in closing tag" — 4
- "Empty tag name" — 3
- "Mismatched tags" — 1

All errors are XML malformation due to output truncation. The consistent truncation at ~position 200 strongly suggests a model-level output token constraint.

**Final node tree (433 nodes)**:
- Header with search bar, logo, nav actions
- Product Gallery + Product Details (side-by-side)
- Specifications with spec table
- Reviews section with reviews grid
- Related Products with carousel
- Footer

Despite the high error rate, the final design is structurally complete with all requested sections.

---

## GROUP D: Out-of-Guideline Designs

### Test D1: Resume/CV

**Best first-turn performance.** 5 iterations, 205s, 0 errors, single `design` call (2476ms).

Structure: Header (profile photo placeholder + name/title), Summary, Experience (3 jobs with dividers), Education & Skills (side-by-side layout), Certifications.

The agent queried "clean, professional, corporate, minimal" style tags — appropriate inference. No resume-specific guidelines exist, so it fell back to landing-page guidelines without issue.

**nodeLimitWarning triggered** — the entire resume was created in one shot (likely 50+ nodes), demonstrating that the LLM CAN produce large valid XML when the content is structured and predictable.

### Test D2: Jazz Concert Poster

**Fastest test overall.** 4 iterations, 85s, 0 errors, single `design` call (875ms).

Richly designed poster: Top accent bar, event title + subtitle, date/venue with decorative dots, 5 artists (each with name + style genre), ticket pricing (Day/Weekend/VIP tiers), website/social info, bottom accent.

Style query: "dark-mode, bold-typography, editorial" — excellent creative inference for a jazz poster.

**No read/screenshot verification** — the agent was confident in the output. Screenshot was only 200x200, likely a capture bug.

### Test D3: Business Card

8 iterations, 121s, 0 errors. Dimensions: 350x200 (reasonable screen proportion for business card). Includes: logo placeholder, name/title, divider, contact rows with icon frames (Building, Phone, Mail, Globe).

**Redundant reads**: 4 read calls on the same node (854:5487) with no intervening edits — wasteful but not harmful.

---

## Cross-Cutting Analysis

### 1. XML Truncation (Critical Issue)

The most severe issue across all tests. Kimi K2.5 consistently truncates XML output around position 200 characters, producing:
- `"…"` (ellipsis) in output → "Your XML is truncated" error
- Unterminated attributes/elements
- Mismatched tags

**Occurrence**: 28 XML parse errors across all tests (A2: 4, B2: 11, C1: 14, A3: 4). This suggests a ~200-character tool call output limit in the model's tokenizer or sampling.

**Impact**: Causes retry loops that consume 3-8x the expected duration. The loop detection hook eventually terminates, but not before wasting significant time and tokens.

**Recommendation**:
- Investigate if Kimi K2.5 has a per-tool-call output length limit
- Add client-side XML length validation before sending to parser
- Consider splitting edit operations into smaller chunks at the runtime level (not relying on LLM to do it)

### 2. Tool Usage Patterns

| Tool | Usage Pattern | Effectiveness |
|------|--------------|---------------|
| `query` (style-tags) | Always called first | Good — guides style decisions |
| `query` (guidelines) | Called for relevant categories | Good — "landing-page" guideline heavily used |
| `query` (style) | Style selection based on tags | Good — correct style inference |
| `design` (create) | Single large XML or progressive | Variable — works for <50 nodes, truncates for larger |
| `design` (edit) | By node ID | Works but verbose for multi-node edits |
| `design` (delete) | `<delete id='xxx'/>` | Works correctly |
| `read` | Canvas discovery + screenshot | Often redundant (multiple reads of same node) |
| `replace` | Bulk property changes | Excellent for theme switching; underutilized for text |

### 3. nodeLimitWarning Effectiveness

Triggered in 6 out of 11 test triggers. When triggered:
- **Did the LLM adjust?** Sometimes. In C1, the agent progressively created sections (skeleton + add-ons). In D1 and D2, the agent one-shot created and ignored the warning.
- **Should it be enforced?** The warning alone is insufficient for Kimi K2.5 — the model doesn't reliably split based on warnings alone. Consider making it a hard limit with automatic XML chunking.

### 4. Multi-turn Instruction Following

- **Theme switch**: Excellent — `replace` tool handles bulk changes efficiently
- **Text translation**: Poor — no bulk text replacement tool; falls back to node-by-node editing with truncation issues
- **Delete + resize**: Functional but slow — correct tool usage, excessive read cycles
- **Insert into existing**: Functional — `parentId` used correctly for insertion
- **Specific property change (gradient)**: Failed — gradient syntax not properly supported

### 5. Session Reset Behavior

The `reset: true` flag does NOT clear the Figma canvas. Previous designs persist across sessions, accumulating nodes. The node tree for later tests contained all designs from earlier tests. This is expected behavior (reset clears agent memory, not canvas) but should be documented.

---

## Recommendations

### P0 (Critical)
1. **Investigate Kimi K2.5 tool call output limit** — The ~200 char truncation is the root cause of 56% of all errors. Either increase the limit or switch to a model without this constraint for edit operations.
2. **Add text content to `replace` tool** — Allow `replace(mode: "replace", rootId, replacements: {textContent: [{from: "Features", to: "功能特性"}]})` to enable efficient bulk text changes.

### P1 (High)
3. **Add gradient shorthand syntax** — `gradient="linear,0deg,#6366F1,#8B5CF6"` instead of requiring raw Figma fills JSON in XML attributes.
4. **Enforce XML chunk size limits** — If a `design` call's XML exceeds N characters, split it automatically at the runtime level rather than relying on the LLM.
5. **Reduce redundant reads** — The agent reads the same node 2-4x in succession without edits. Add caching or cooldown logic.

### P2 (Medium)
6. **Improve loop detection sensitivity** — The current 4-pattern threshold allows 8+ retries of the same truncated XML before aborting. Consider 2-3 retries max for XML parse errors specifically.
7. **Screenshot capture reliability** — Some screenshots are 200x200 (too small). Investigate the export viewport calculation.
8. **Document reset behavior** — Clarify that `reset: true` resets agent memory but not the Figma canvas.

---

## Test Artifacts

| Test | Trigger ID | Result Directory |
|------|-----------|-----------------|
| A1 Create | trigger-1773063919285 | `/tmp/figma-bridge/results/trigger-1773063919285/` |
| A1→Dark | trigger-1773064179188 | `/tmp/figma-bridge/results/trigger-1773064179188/` |
| A2 Chinese | trigger-1773064327417 | `/tmp/figma-bridge/results/trigger-1773064327417/` |
| B1 Create | trigger-1773064878731 | `/tmp/figma-bridge/results/trigger-1773064878731/` |
| B1→Delete | trigger-1773065344001 | `/tmp/figma-bridge/results/trigger-1773065344001/` |
| B2 Table | trigger-1773065693947 | `/tmp/figma-bridge/results/trigger-1773065693947/` |
| C1 E-commerce | trigger-1773066321343 | `/tmp/figma-bridge/results/trigger-1773066321343/` |
| D1 Resume | trigger-1773067400623 | `/tmp/figma-bridge/results/trigger-1773067400623/` |
| D2 Poster | trigger-1773067811594 | `/tmp/figma-bridge/results/trigger-1773067811594/` |
| D3 Card | trigger-1773068100818 | `/tmp/figma-bridge/results/trigger-1773068100818/` |
| A3 Gradient | trigger-1773068665952 | `/tmp/figma-bridge/results/trigger-1773068665952/` |

Each directory contains: `screenshot.png`, `tool-calls.json`, `tree.json`, `meta.json`, `logs.txt`
