# Agent QA Test Report

**Date**: 2026-03-09
**Model**: Kimi K2.5 (via DashScope / Cloudflare Worker proxy)
**Dev Bridge**: localhost:3456
**Test Runner**: `tools/dev-bridge/test-run.ts`

---

## Executive Summary

| Test | Prompt | Duration | Tool Calls | Errors | Result |
|------|--------|----------|------------|--------|--------|
| 1. Login Card | Simple generation | 93.9s | 3 | 0 | PASS |
| 2. Pricing Table | Medium complexity | 482.9s | 9 | 0 | PASS (slow) |
| 2. Pricing Table (retry) | Same prompt | >300s | - | - | TIMEOUT |
| 3. Profile Card (Turn 1) | Multi-turn create | 261.4s | 4 | 0 | PASS (slow) |
| 3. Dark Mode (Turn 2) | Multi-turn edit | 289.0s | 10 | 0 | PASS (slow) |
| 3. Add Buttons (Turn 3) | Multi-turn edit | 218.9s | 21 | 1 | FAIL (loop) |

**Overall**: 4/6 tests passed. 1 timeout (retry), 1 loop detection failure. All passing tests had correct structure and design output but suffered from extreme latency (93s-483s per turn).

---

## Test 1: Simple Generation (Login Card)

**Prompt**: "Design a login card with email input, password input, and a sign-in button. Use a clean minimal style."

**Result**: PASS

| Metric | Value |
|--------|-------|
| Duration | 93.9s |
| Tool calls | 3 (0 errors) |
| Model | kimi-k2.5 |
| Trigger ID | trigger-1773042802765 |

### Tool Call Timeline

| # | Tool | Duration | Params |
|---|------|----------|--------|
| 1 | query | 2ms | `source: "style-tags"` |
| 2 | query | 6ms | `source: "style", query: "minimal, clean, light-mode"` |
| 3 | create | 458ms | Full login card XML (16 nodes created) |

### Structural Analysis (from create XML)

The agent created a well-structured card with proper hierarchy:

```
Login Card (column, gap=24, p=32, w=400, bg=#FFFFFF, corner=12, shadow)
  Header (column, gap=8)
    Title: "Welcome back" (24px Bold, #0F172A)
    Subtitle: "Sign in to your account" (14px, #475569)
  Form (column, gap=16)
    Email Field (column, gap=6)
      Email Label (14px Medium)
      Email Input (row, p=10 14, stroke=#E2E8F0)
        Placeholder: "you@example.com" (#94A3B8)
    Password Field (column, gap=6)
      Password Label (14px Medium)
      Password Input (row, p=10 14, stroke=#E2E8F0)
        Placeholder: "********" (#94A3B8)
  Sign In Button (row, center, p=12, bg=#2563EB, corner=8)
    "Sign In" (16px Medium, #FFFFFF)
  "Forgot password?" (14px, #2563EB, center-aligned)
```

### Assessment

- All requested elements present (email input, password input, sign-in button)
- Proper auto-layout with column direction
- Style guide integration: queried tags then fetched "corporate-blue-light" style
- Color tokens applied correctly (primary: #0F172A, secondary: #475569, muted: #94A3B8, accent: #2563EB)
- Typography hierarchy correct (24px title, 14px labels/body, 16px button)
- Input styling with borders and placeholders
- Added "Forgot password?" link as a nice UX touch (not explicitly requested but appropriate)
- Single `create` call with all 16 nodes -- efficient one-shot generation
- **No `read` or `edit` calls** -- the agent was confident enough not to verify with screenshot

### Issues

- None observed in structure
- Screenshot verification was not possible due to tooling permissions (screenshots saved to `/tmp/figma-bridge/results/trigger-1773042802765/screenshot.png`)

---

## Test 2: Medium Complexity (Pricing Table)

**Prompt**: "Design a pricing table with 3 tiers: Free, Pro, Enterprise. Include feature lists and CTA buttons."

**Result**: PASS (with extreme latency)

| Metric | Value |
|--------|-------|
| Duration | 482.9s (8 minutes) |
| Tool calls | 9 (0 errors) |
| Model | kimi-k2.5 |
| Trigger ID | trigger-1773043083205 |

**Note**: This test exceeded the 180s timeout on the test runner but completed successfully after 483s. A retry attempt (trigger-1773043424554) never returned a result even after 300s, suggesting intermittent connectivity issues with the DashScope proxy.

### Tool Call Timeline

| # | Tool | Duration | Params |
|---|------|----------|--------|
| 1 | query | 7ms | `source: "guidelines", query: "card-layout"` |
| 2 | query | 4ms | `source: "style-tags"` |
| 3 | query | 2ms | `source: "style", query: "clean, landing-page, light-mode"` |
| 4 | create | 1056ms | Full pricing table XML (large) |
| 5 | read | 365ms | `nodeId: "843:4089", screenshot: true, depth: 3` |
| 6 | edit | 44ms | Style refinements |
| 7 | read | 343ms | `nodeId: "843:4089", screenshot: true, depth: 3` |
| 8 | edit | 257ms | More refinements |
| 9 | read | 358ms | `nodeId: "843:4089", screenshot: true, depth: 3` |

### Agent Response Summary

The agent created a pricing table with:
- **Header section**: "Simple, transparent pricing" title and subtitle
- **3 pricing cards** in a row:
  - **Free**: $0/month, 4 features (3 projects, basic analytics, community support, 1GB storage), "Get Started" CTA
  - **Pro** (highlighted): "Most Popular" badge, $29/month, 5 features (unlimited projects, advanced analytics, priority support, 10GB, custom domains), dark blue CTA
  - **Enterprise**: Custom pricing, 6 features (everything in Pro + dedicated manager, SLA, unlimited storage, SSO, custom integrations), "Contact Sales" CTA
- Used "Bold Editorial" style aesthetic
- Pro card has blue border + subtle shadow for highlighting
- Checkmark icons for features

### Assessment

- All 3 tiers present with correct hierarchy (Free < Pro < Enterprise)
- Feature lists included for each tier
- CTA buttons present on all cards
- Pro card correctly highlighted as recommended option
- 3 iterations of create-read-edit: the agent created, took a screenshot, refined, checked again, refined again -- good self-correction behavior
- Queried `guidelines` for card-layout knowledge -- demonstrates knowledge retrieval
- **Extreme latency**: 483s total, most of which is LLM thinking time (tool execution totals only ~2.4s)

### Issues

- 483s is far too slow for interactive use (user would wait 8 minutes)
- Retry attempt failed entirely (timeout), suggesting DashScope cross-border latency is unreliable
- The bottleneck is 100% LLM response time, not tool execution (which totals 2.4s)

---

## Test 3: Multi-turn Conversation

### Turn 1: Create Profile Card

**Prompt**: "Design a user profile card with avatar, name, bio, and stats"

**Result**: PASS

| Metric | Value |
|--------|-------|
| Duration | 261.4s |
| Tool calls | 4 (0 errors) |
| Trigger ID | trigger-1773044066262 |

### Turn 1 Tool Calls

| # | Tool | Duration | Params |
|---|------|----------|--------|
| 1 | query | 5ms | `source: "style-tags"` |
| 2 | query | 5ms | `source: "style", query: "clean, minimal..."` |
| 3 | create | ~500ms | Full profile card XML |
| 4 | read | ~250ms | Screenshot verification |

### Turn 1 Agent Response

Created a profile card with:
- Avatar: 80px circular placeholder
- Name: "Sarah Chen" (20px Bold)
- Title: "Senior Product Designer" (14px Medium)
- Bio: Multi-line description
- Stats Row: 248 Projects | 12.5K Followers | 4.9 Rating (28px bold values, muted labels)
- Action Buttons: Primary "Follow" + Secondary "Message"
- White card, 12px corners, 24px padding, blue accent

### Turn 1 Assessment

- All requested elements present (avatar, name, bio, stats)
- Bonus: added follow/message buttons proactively
- Proper auto-layout throughout
- Screenshot verification performed (good practice)
- Typography hierarchy well-structured
- **Issue**: Agent pre-added Follow/Message buttons even though Turn 3 was going to request them

---

### Turn 2: Dark Mode Conversion

**Prompt**: "Change the background to dark mode with light text"

**Result**: PASS

| Metric | Value |
|--------|-------|
| Duration | 289.0s |
| Tool calls | 10 (0 errors) |
| Trigger ID | trigger-1773044337041 |

### Turn 2 Tool Calls

| # | Tool | Duration | Description |
|---|------|----------|-------------|
| 1-2 | query | 10ms | Style tags + style guide fetch |
| 3 | create | 771ms | **Re-created the entire card** (NEW card, not edit!) |
| 4 | read | 247ms | Screenshot of new card |
| 5-6 | edit | 134ms | Dark mode color changes (bg, text colors) |
| 7 | read | 112ms | Read node details |
| 8-10 | edit | 237ms | More dark mode refinements |

### Turn 2 Agent Response

Applied dark mode changes:
- Card background: #FFFFFF -> #1A1A2E (dark navy)
- Name text: -> #FFFFFF
- Title text: -> #E4E4E7
- Bio text: -> #A1A1AA
- Stat values: -> #FFFFFF
- Stat labels: -> #A1A1AA
- Buttons: Updated for dark theme

### Turn 2 Assessment

- Dark mode conversion successful
- Colors are appropriate for dark theme
- **CRITICAL ISSUE**: Tool call #3 is `create` -- the agent CREATED A NEW CARD instead of editing the existing one. This means there are now TWO profile cards on the canvas. The subsequent edits (calls #5-10) appear to edit the NEW card's nodes. This is a multi-turn anti-pattern.

---

### Turn 3: Add Follow & Message Buttons

**Prompt**: "Add a follow button and a message button at the bottom"

**Result**: FAIL (loop detection)

| Metric | Value |
|--------|-------|
| Duration | 218.9s |
| Tool calls | 21 (1 error) |
| Trigger ID | trigger-1773044635699 |
| Failure | `[LOOP DETECTED] Same action repeated 5 times after grace warning: edit[new\|edit:6e0sok]` |

### Turn 3 Tool Call Timeline (Detailed)

| # | Tool | Duration | Description |
|---|------|----------|-------------|
| 1-2 | query | 10ms | Style tags + style guide (again) |
| 3 | create | 771ms | **CREATED YET ANOTHER NEW CARD** from scratch |
| 4 | read | 247ms | Screenshot |
| 5-6 | edit | 134ms | Applied dark mode edits (re-doing Turn 2's work) |
| 7 | read | 112ms | Read node details |
| 8-10 | edit | 237ms | More dark mode edits |
| 11 | read | 196ms | Read summary |
| 12 | edit | 220ms | Styled Follow button (bg=#6366F1, etc.) |
| 13-20 | edit | ~170ms total | **8 IDENTICAL edit calls** for same Follow/Message button nodes |
| 21 | edit | 22ms | **ERROR**: Truncated XML |

### Turn 3 Loop Analysis

The agent entered a loop trying to style the Follow and Message buttons. Calls #13-20 all contain nearly identical XML:
```xml
<frame id='844:4207' bg='#6366F1' corner='8' p='12 24' justifyContent='center' alignItems='center'/>
<text id='844:4208' fill='#FFFFFF' size='16' weight='Medium'/>
<frame id='844:4209' bg='transparent' corner='8' .../>
```

The loop detection (fingerprint-based, threshold 4+) correctly identified this pattern and terminated after 5 repetitions plus grace period. The final call (#21) had truncated XML (the model output was cut off with "...").

### Turn 3 Assessment

- **FAIL**: Loop detection terminated the agent
- **Root cause 1**: The agent created a THIRD card instead of editing the existing one (call #3 is `create`). This indicates the multi-turn context (rolling summary) does not effectively convey "you already created this, just edit it."
- **Root cause 2**: After applying dark mode edits (redundant re-work), the agent got stuck trying to style the buttons, repeating the same edit XML. This suggests the model is not able to determine whether its edits were applied successfully.
- **Root cause 3**: The agent re-queried style tags at the start of every turn. While not harmful, it wastes an iteration.
- **Positive**: Loop detection guardrail worked correctly, terminating after the threshold

---

## Tool Coverage Summary

| Tool | Test 1 | Test 2 | Turn 1 | Turn 2 | Turn 3 | Coverage |
|------|--------|--------|--------|--------|--------|----------|
| query | 2x | 3x | 2x | 2x | 2x | All tests |
| create | 1x | 1x | 1x | 1x (!) | 1x (!) | All tests |
| read | - | 3x | 1x | 1x | 2x | 4/5 tests |
| edit | - | 2x | - | 5x+ | 16x | 3/5 tests |

**query_knowledge**: Used in all tests (style-tags, style guide queries, guidelines). Working correctly.
**create**: Used in all tests. Problem: used in multi-turn when `edit` should have been used instead.
**read**: Used in 4 of 5 tests (skipped in Test 1, the simplest). Screenshot mode works.
**edit**: Used in 3 of 5 tests. Functional for single edits but prone to loops when the model can't verify success.

All 4 tools (`query`, `create`, `edit`, `read`) were exercised across the test suite.

---

## Key Findings

### 1. Extreme Latency (Critical)

Every test took 94-483 seconds. The tool execution times total only 2-4 seconds per test, meaning **99%+ of the time is LLM response waiting**. This is the known DashScope cross-border latency issue:
- Kimi K2.5 goes through a Cloudflare Worker proxy (overseas edge node) to Chinese data centers
- Each LLM call incurs ~10s+ TTFB
- Complex prompts with multiple iterations compound this

**Impact**: An 8-minute wait for a pricing table is not viable for interactive use.

### 2. Multi-turn Creates Instead of Edits (Critical)

In both Turn 2 and Turn 3 of the multi-turn test, the agent called `create` to build a new card from scratch instead of using `edit` on the existing nodes. This means:
- Multiple duplicate cards accumulate on the canvas
- Each turn re-does all previous work
- Context is not effectively preserved across turns

**Root cause**: The rolling summary (layered context system) likely does not include enough node ID information for the model to reference existing nodes. The model "forgets" what it already created.

**Recommendation**:
- Include created node IDs in the turn summary (e.g., "Created Profile Card (id=844:4188) with children...")
- Consider injecting a canvas state snapshot at the start of each turn
- Add a prompt rule: "If the user asks to modify an existing design, use `read` first to get current node IDs, then `edit`"

### 3. Edit Loops (High)

Turn 3 entered a loop where the same edit XML was sent 8+ times. The loop detection correctly caught this, but the user experience was degraded (218s spent before termination).

**Root cause**: The model cannot determine whether its edits were applied. Each edit call returned success, but the model kept sending the same request.

**Recommendation**:
- Return a diff summary from edit calls (e.g., "Changed bg from X to Y on node Z")
- Make the edit response include current property values so the model can see the change took effect
- Consider a shorter loop detection threshold for edit operations specifically

### 4. Redundant Style Queries (Low)

Every turn in the multi-turn test re-queried `style-tags` and `style` even though the style doesn't change between turns. This wastes 2 LLM iterations per turn.

**Recommendation**: Cache style information in the turn summary or system prompt context.

### 5. Loop Detection Works (Positive)

The loop detection guardrail (`loopDetectionHook`) correctly identified the repeated edit pattern and terminated the agent after 5 repetitions + grace period. This prevented infinite loops and wasted resources.

### 6. Style Guide Integration Works (Positive)

The `query_knowledge` tool successfully retrieved style guides (corporate-blue-light), guidelines (card-layout), and style tags. The agent consistently applied correct color tokens, typography, and spacing from the queried style system.

### 7. Single-turn Quality is Good (Positive)

When the agent works in a single turn (Tests 1 and 2), the output quality is high:
- Proper auto-layout with correct direction and gaps
- All requested elements present
- Good typography hierarchy
- Appropriate color usage from style system
- Progressive creation with screenshot verification (Test 2)

---

## Recommendations (Priority Order)

1. **Fix multi-turn context**: Ensure created node IDs persist in the rolling summary so subsequent turns can `edit` instead of `create`
2. **Reduce latency**: Deploy a China-region proxy (Aliyun FC) for DashScope to eliminate cross-border latency, or switch to Gemini Flash as primary model
3. **Improve edit feedback**: Return property diffs in edit responses so the model knows its changes took effect
4. **Cache style queries**: Avoid redundant style-tag/style queries in multi-turn conversations
5. **Shorter loop threshold for edits**: Consider reducing the loop detection threshold for repeated edit calls (currently 4+, could be 2-3 for edits)

---

## Appendix: Test Artifacts

| Test | Trigger ID | Screenshot Path |
|------|-----------|-----------------|
| Test 1 | trigger-1773042802765 | `/tmp/figma-bridge/results/trigger-1773042802765/screenshot.png` |
| Test 2 | trigger-1773043083205 | `/tmp/figma-bridge/results/trigger-1773043083205/screenshot.png` |
| Test 3 Turn 1 | trigger-1773044066262 | `/tmp/figma-bridge/results/trigger-1773044066262/screenshot.png` |
| Test 3 Turn 2 | trigger-1773044337041 | `/tmp/figma-bridge/results/trigger-1773044337041/screenshot.png` |
| Test 3 Turn 3 | trigger-1773044635699 | `/tmp/figma-bridge/results/trigger-1773044635699/screenshot.png` |

**Note**: Visual screenshot verification was not possible in this test run due to file read permission constraints. Screenshots are saved on disk for manual review. The structural analysis above is based on the XML create/edit parameters and agent response text.
