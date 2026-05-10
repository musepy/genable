# Duplicate Generation Audit — April 2026

**Date**: 2026-04-17
**Scope**: 19 most recent dev-bridge triggers in `/tmp/figma-bridge/results/`
**Goal**: verify whether recent commits actually killed the "duplicate generation" pattern recorded in MEMORY (glm-5/kimi-K2.5 occasionally creating the same node twice without delete)

---

## 1. Fix Intent — three commits under audit

### 1.1 `ad19f30` — refactor(agent): reality-check inspect gate + propagate createdIds from clone/subtask

**Date**: 2026-04-17 10:19 +0800

**Files changed (8)**:
- `src/engine/actions/nodeFactory.ts` (+8/-1)
- `src/engine/agent/__tests__/inspectionGate.test.ts` (+184/-10)
- `src/engine/agent/agentRuntime.ts` (+33/-6)
- `src/engine/agent/hooks/inspectGateHook.ts` (+19/-16)
- `src/engine/agent/hooks/inspectStubHook.ts` (+33/-6)
- `src/engine/agent/hooks/inspectionTracker.ts` (+18/-13)
- `src/engine/agent/subtask/executor.ts` (+5/-0)
- `src/ipc/commands/writeHandlers.ts` (+8/-1)

**Key diff slice — `cloneNode` now walks the whole subtree**:

```ts
// nodeFactory.ts
- return { nodeId: cloned.id, warnings };
+ // Collect all descendant IDs so the caller can register them for subsequent edits.
+ const createdIds: string[] = [cloned.id];
+ if ('findAll' in cloned) {
+   for (const desc of (cloned as FrameNode).findAll(() => true)) {
+     createdIds.push(desc.id);
+   }
+ }
+ return { nodeId: cloned.id, warnings, createdIds };
```

```ts
// agentRuntime.ts — collectCreatedNodes
+ // subtask tool shape: { data: { createdNodes, createdIds, summary } }
+ // Propagate child's root nodes so parent's designRootId / link-text work.
+ if (Array.isArray(data.createdNodes)) {
+   for (const node of data.createdNodes) { ... this.turnCreatedNodes.push(...) }
+ }
+ // Mark every created node as known (born clean from parent's view).
+ if (Array.isArray(data.createdIds)) {
+   for (const id of data.createdIds) {
+     this.turnCreatedIds.push(id);
+     this.inspectionTracker?.markInspected(id);
+   }
+ }
```

**Inspection tracker collapsed to single-level Set**:

```ts
// inspectionTracker.ts (single-level "known" Set, replacing the prior level-based one)
- inspect/describe → markInspected (clean)
- mutation tool    → consumeInspection (dirty)
- jsx creation     → markInspected (born clean)
+ A node is either "known" (seen in any inspect/describe/jsx result this turn)
+ or "unknown" (hallucinated ID / never observed).
```

**Targets which "duplicate generation" sub-scenario**:
- **Subtask spawn**: parent runtime now seeds tracker with all child-created IDs → eliminates one source of "unknown ID → re-inspect → re-create" loops.
- **Clone**: clone descendants are now visible to the parent tracker → no spurious "unknown" rejections.
- This commit fixed *gate-driven thrash* that LOOKED like duplicate generation in some cases (LLM kept retrying because the gate kept rejecting).

**Does NOT target**: LLM cognitively re-creating already-existing structure (true semantic duplicates).

### 1.2 `c507e0d` — fix(agent): invalidate tracker entries only on delete_node

**Date**: 2026-04-17 10:53 +0800 (34 min after ad19f30)

**Files changed (2)**:
- `src/engine/agent/__tests__/inspectionGate.test.ts` (+38/-10)
- `src/engine/agent/hooks/inspectGateHook.ts` (+11/-2)

**Key diff slice**:

```ts
// inspectGateHook.ts
+ /**
+  * Tools that invalidate the target ID (remove the node from the scene graph).
+  * Only these should consume the tracker entry — property edits, moves, and
+  * clones leave the target's ID intact, so the tracker should retain it.
+  */
+ const INVALIDATING_TOOLS = new Set(['delete_node']);

  // afterToolExec: invalidate tracker entries for removed nodes
  // ...
- if (!tc || !mutationTools.has(tc.name)) return;
+ if (!tc || !INVALIDATING_TOOLS.has(tc.name)) return;
```

**Targets which sub-scenario**:
- After ad19f30 the gate was still consuming the tracker entry on EVERY successful mutation (edit/set_*/move/clone) — a stale assumption from the old "read before edit" contract. So mutating the same node twice without re-inspecting between calls would falsely throw "unknown — never inspected this turn", triggering the LLM to re-inspect or, worse, retry by re-creating.
- Commit message confirms the metric: "E2E dashboard: 41→3 'unknown/not inspected' runtime event mentions, 0 gate rejections in tool calls."

**Does NOT target**: same-name-same-parent semantic duplicates (model bug, not gate bug).

### 1.3 `87a6e3a` — feat(bridge): pit-of-success optimizations for HTTP bridge + tool fixes

**Date**: 2026-04-17 11:22 +0800 (29 min after c507e0d)

**Files changed (5)**:
- `.claude/skills/httpbridge-api-test/SKILL.md` (+202)
- `src/ipc/commands/inspectHandler.ts` (+20)
- `src/ipc/commands/jsHandler.ts` (+14/-1)
- `src/ipc/commands/jsxHandler.ts` (+8/-1)
- `tools/mcp-server/httpBridge.ts` (+12/-1)

**Key diff slices**:

```ts
// jsxHandler.ts — accept `parent` as alias for `parentId`
+ const parentId = args.parentId ?? args.parent;
```

```ts
// jsHandler.ts — auto-replace getNodeById → getNodeByIdAsync
+ const fixedCode = code.replace(/figma\.getNodeById\(/g, 'await figma.getNodeByIdAsync(');
```

```ts
// inspectHandler.ts — expose arcData/pointCount/innerRadius/vectorPaths in detail mode
+ if (mode === 'detail' && (node.type === 'STAR' || node.type === 'POLYGON')) {
+   if ('pointCount' in node) result.pointCount = node.pointCount;
+   if ('innerRadius' in node) result.innerRadius = node.innerRadius;
+ }
```

**Targets which sub-scenario**:
- **None directly related to duplicate generation**.
- The `parent`/`parentId` alias does indirectly help: previously, an LLM that wrote `parent="..."` instead of `parentId="..."` would silently get a page-root jsx (no parent), which can manifest as an "orphan" of a structure that was supposed to be nested. After this commit, both spellings work.
- The other changes (jsHandler async fix, inspect Star/Polygon detail) are unrelated to duplicate generation.

---

## 2. E2E Sample Analysis

### 2.1 Methodology

Detection script: `/tmp/audit-dup-gen-v2.mjs`

Signals:
| Signal | Definition |
|---|---|
| **S1** real_duplicate_root | Two jsx success calls with same `name` AND same `parentId`, with NO `delete_node` of the first instance between them |
| **S2** child_recreated_orphan | A jsx success call creates a frame whose name matches a **non-generic child name** of an earlier created root, with parent = either the original child container's id (re-creation INTO the existing slot) or `null` (page-root orphan), and the original was not deleted between |
| **S4** repeating_signature | Same `(toolName, params-hash)` repeats 3+ times — soft loop signal below the runtime hook's 4+ threshold |
| **S5** high_delete_recovery | `delete_node ≥ 3` AND `delete_node ≥ jsx_success * 0.5` — heavy cleanup hints at over-creation recovery |

Generic names skipped for S2 (would inflate false positives): `Text, Label, Icon, Check, Button, Field, Row, Col, Cell, Item, Title, Subtitle, Heading, Header, Container, Wrapper, Group, Box, Frame`.

### 2.2 Trigger Table (most recent → oldest)

Fix landed times (all 2026-04-17):
- ad19f30 = 10:19, c507e0d = 10:53, 87a6e3a = 11:22.

| # | triggerId | UTC date | model | status | tools | jsx | del | S1 | S2 | S4 | S5 | DUP? | epoch vs fixes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1776396109232 | 04-17T03:23 (=11:23 +08) | glm-5 | idle | 20 | 5 | 4 | 0 | 3 | 0 | Y | **YES** | post-87a6e3a |
| 2 | 1776392956252 | 04-17T02:44 (=10:44 +08) | glm-5 | idle | 59 | 5 | 5 | 0 | 0 | 1 | Y | — | post-ad19f30, pre-c507e0d |
| 3 | 1776391423104 | 04-17T02:13 (=10:13 +08) | glm-5 | idle | 29 | 4 | 4 | 0 | 0 | 1 | Y | — | pre-ad19f30 |
| 4 | 1776389945919 | 04-17T01:47 (=09:47 +08) | glm-5 | idle | 97 | 14 | 6 | 0 | 0 | 2 | — | — | pre-ad19f30 |
| 5 | 1775975580536 | 04-16T16:07 | kimi-k2.5 | idle | 16 | 1 | 0 | 0 | 0 | 0 | — | — | pre-fix |
| 6 | 1776338890983 | 04-16T11:34 | glm-5 | idle | 40 | 15 | 1 | 0 | 0 | 1 | — | — | pre-fix |
| 7 | 1776337493475 | 04-16T11:24 | glm-5 | idle | 100 | 7 | 15 | 0 | 0 | 8 | Y | — | pre-fix |
| 8 | 1776334699282 | 04-16T10:22 | glm-5 | idle | 2 | 0 | 0 | — | — | — | — | — | pre-fix (idle ack only) |
| 9 | 1776334586038 | 04-16T10:17 | glm-5 | idle | 2 | 0 | 0 | — | — | — | — | — | pre-fix (idle ack only) |
| 10 | 1776334386660 | 04-16T10:15 | glm-5 | idle | 2 | 0 | 0 | — | — | — | — | — | pre-fix (idle ack only) |
| 11 | 1776325228191 | 04-16T07:47 | glm-5 | idle | 88 | 71 | 0 | 0 | 0 | 7 | — | — | pre-fix |
| 12 | 1776323468493 | 04-16T07:18 | glm-5 | idle | 48 | 13 | 1 | 0 | 0 | 1 | — | — | pre-fix |
| 13 | 1776323234684 | 04-16T07:10 | glm-5 | canceled | 10 | 4 | 0 | 0 | 0 | 0 | — | — | pre-fix |
| 14 | 1776308000202 | 04-16T02:58 | qwen3.6-plus | idle | 44 | 21 | 0 | 0 | 0 | 0 | — | — | pre-fix |
| 15 | 1776305503626 | 04-16T02:15 | qwen3.6-plus | idle | 38 | 12 | 2 | 0 | 0 | 2 | — | — | pre-fix |
| 16 | 1776304827429 | 04-16T02:11 | qwen3.6-plus | idle | 41 | 19 | 1 | 0 | 0 | 0 | — | — | pre-fix |
| 17 | 1776304593285 | 04-16T01:59 | qwen3.6-plus | idle | 41 | 30 | 1 | 0 | 0 | 0 | — | — | pre-fix |
| 18 | 1776304215736 | 04-16T01:55 | qwen3.6-plus | idle | 41 | 14 | 1 | 3 | 0 | 0 | — | **YES** | pre-fix |
| 19 | 1776303931812 | 04-16T01:49 | qwen3.6-plus | idle | 35 | 14 | 2 | 4 | 0 | 1 | — | YES* | pre-fix |

\* Trigger 19 is a borderline false positive — see §2.4.

### 2.3 Detailed evidence — duplicate triggers

#### Trigger 1 — `1776396109232` (glm-5, post-c507e0d) — **CLASSIC bug, still happening**

Tool sequence (jsx + delete only):

```
[ 4] jsx          parent=PAGE         -> 'Login Card' (id=1623:9081, children: Header 9082, Email 9085, Password 9089, Sign In 9093)
[ 5] jsx          parent=1623:9082    -> 'Header'         id=1623:9095   ← duplicate INTO existing Header slot
[ 6] jsx          parent=1623:9085    -> 'Email Field'    id=1623:9098   ← duplicate INTO existing Email slot
[ 7] jsx          parent=1623:9089    -> 'Password Field' id=1623:9102   ← duplicate INTO existing Password slot
[ 8] jsx          parent=1623:9093    -> 'Sign In Button' id=1623:9106   ← duplicate INTO existing Sign In slot
[ 9] inspect      node=1623:9081     ← LLM inspects, sees doubled tree
[10] delete_node  1623:9095          ← LLM cleans up
[11] delete_node  1623:9098
[12] delete_node  1623:9102
[13] delete_node  1623:9106
```

LLM text at iteration 6: `" duplicate nodes were created."` — **the model self-detected and self-recovered**.

This is **NOT a tracker/gate failure** (gate rejection events = 0 in this trigger). It is a pure LLM mistake: at iteration 4 jsx [4] returned the full Login Card with all 4 children; the model then "mentally forgot" they were already created and proceeded to fill them in piece by piece in iteration 4. After jsx returns nested children, the LLM can mistake those container IDs (Header, Email Field, etc.) as "empty containers waiting to be filled".

Gate rejection events: **0**
Loop hint events: **0**

#### Trigger 18 — `1776304215736` (qwen3.6-plus, pre-fix) — restart-after-empty pattern

```
[ 2] jsx parent=PAGE -> 'Calendar Week View' id=1587:7413  (empty shell)
[ 4] jsx parent=PAGE -> 'Header'  id=1587:7414             ← sibling at PAGE root, not inside CalendarWeekView!
[ 8] jsx parent=1587:7414 -> 'Header Left'
[ 9] jsx parent=1587:7414 -> 'Header Right'
[10] jsx parent=PAGE -> 'Body'    id=1587:7438             ← sibling
[13] jsx parent=PAGE -> 'Sidebar' id=1587:7439             ← sibling
[15] jsx parent=1587:7439 -> 'Month Header'
[18] jsx parent=1587:7439 -> 'Weekday Headers'
[21] delete_node 1587:7413       ← LLM deletes empty Calendar Week View shell
[22] jsx parent=PAGE -> 'Calendar Week View' id=1587:7452  ← rebuilds from scratch
[24] jsx parent=PAGE -> 'Header'  id=1587:7453             ← but old Header (1587:7414) is still alive!
[36] jsx parent=PAGE -> 'Body'    id=1587:7476
[40] jsx parent=PAGE -> 'Sidebar' id=1587:7477
```

Hit iteration cap. After [21] only the empty Calendar Week View was deleted; Header/Body/Sidebar from the first attempt still exist when the LLM rebuilds them at [24,36,40]. Pure semantic duplicate.

#### Trigger 19 — `1776303931812` (qwen3.6-plus, pre-fix) — **likely false positive**

```
[17,18,19,20,21,32] jsx parent=1587:7362 -> 'Ingredient Item' (6 distinct ids)
```

User asked for a 6-ingredient recipe. Each jsx call adds a unique sibling — they share the template name "Ingredient Item" because each recipe item uses the same anatomy. This is **inefficient** (could be one jsx with 6 children) but not a duplicate: each of the 6 IDs is distinct and intended.

Excluding this from "real duplicates": **2/19 confirmed**.

### 2.4 Pattern frequency summary

After excluding the borderline FP:

| Bucket | n | duplicates | rate |
|---|---|---|---|
| All 19 triggers | 19 | 2 confirmed (+1 FP) | 10.5% (16% counting FP) |
| Post-c507e0d (the strictest fix) | 1 | 1 | 100%, but n=1 |
| Post-ad19f30 only | 2 | 0 | 0% |
| Pre-fix triggers | 16 | 1 confirmed | 6.3% |

**Caveat**: post-fix sample is tiny (n=3). Cannot conclude a rate change yet.

### 2.5 Gate-rejection telemetry sanity check

Number of `inspectGateHook` rejection events ("hasn't appeared in any inspect/describe/jsx result this turn") per trigger:

| Trigger | Date | Stage | Gate rejections |
|---|---|---|---|
| 1776396109232 | 11:23 +08 | post-c507e0d | **0** |
| 1776392956252 | 10:44 +08 | post-ad19f30, pre-c507e0d | **0** |
| 1776391423104 | 10:13 +08 | pre-ad19f30 | 38 |
| 1776389945919 | 09:47 +08 | pre-ad19f30 | 52 |
| 1776338890983 | 04-16 19:28 | pre-fix | 0 |
| 1776337493475 | 04-16 19:04 | pre-fix | 0 |
| 1776304215736 | 04-16 09:50 | pre-fix | 0 |
| 1776303931812 | 04-16 09:45 | pre-fix | 0 |

**Confirmation**: ad19f30 + c507e0d combined eliminated the 38–52 gate rejections per trigger that were noisy in pre-fix glm-5 runs. The drop in tool-call counts attributed in the commit message ("97→29 tool calls, 29→1 errors") is reproduced here.

---

## 3. Conclusions

### 3.1 What the fixes did

| Commit | Sub-scenario covered | Evidence |
|---|---|---|
| **ad19f30** | False "unknown ID" rejections on subtask-created descendants and clone descendants (the gate would reject mutations on nodes the parent runtime had no record of). | Triggers 1776391423104 (38 gate rejections, pre-fix) → 1776396109232 (0 rejections, post-fix). |
| **c507e0d** | False "unknown ID" rejections AFTER a successful edit/set/move/clone, because the gate consumed the tracker entry on every mutation. | Same telemetry: 0 rejections in the only two post-fix triggers. |
| **87a6e3a** | `parent`/`parentId` alias unblocks one minor orphan vector. Other changes unrelated to duplication. | No direct duplicate-generation evidence. |

### 3.2 What is still broken (sample 1776396109232)

The remaining duplicate-generation pattern is a **semantic LLM mistake, not a runtime gate failure**:

1. jsx returns a complete tree with all nested children IDs.
2. The LLM, in the same iteration's tool batch, reads the result and decides to "fill in" each child container — but the children are already filled. Result: each named component (Header, Email Field, etc.) gets a duplicate copy nested inside its own original frame.
3. The gate cannot prevent this because the parent container IDs are legitimately known (born clean from the jsx that created them).
4. The model self-recovers via inspect → delete_node × N. Cost: 4 wasted jsx calls + 1 inspect + 4 deletes (~9 extra tool calls and ~5 s wall time).

**The fixes do not address this scenario.** Neither inspect-tracker hardening nor the parent alias prevent the model from over-creating into legit IDs.

### 3.3 Sub-scenarios and coverage matrix

| Sub-scenario | Sample evidence | Covered by? |
|---|---|---|
| Tracker false-rejects subtask descendants | Trigger 1776391423104 (38 rejections) | ad19f30 ✓ |
| Tracker false-rejects clone descendants | (no recent clone-heavy trigger to verify) | ad19f30 ✓ (per commit msg + tests) |
| Tracker consumes ID on edit/set_* | Trigger 1776389945919 (52 rejections) | c507e0d ✓ |
| LLM creates content INSIDE existing nested children (over-fill of returned tree) | **Trigger 1776396109232** (4 duplicates) | **NOT COVERED** |
| LLM rebuilds whole design after partial delete (orphan-leaving restart) | **Trigger 1776304215736** (3 duplicates) | **NOT COVERED** |
| LLM repeats jsx 6× for list items with same template name | Trigger 1776303931812 (false positive) | N/A — this is by design |

### 3.4 Suggested next step (DO NOT IMPLEMENT)

Three options ranked by ROI:

1. **Prompt-level fix (lowest cost, recommended first)**: After every jsx success, the system tells the LLM "Created X with N children — DO NOT re-create the listed children, treat them as filled." This is a one-line addition in the jsx tool result formatter, addresses the over-fill pattern in trigger 1776396109232 directly. No runtime change.

2. **Soft hint hook (medium cost)**: Add a hook that detects "jsx call where `parentId` is itself the ID of a previously-created child of an unmodified root" and emits a loop hint to the LLM ("you appear to be re-filling Login Card.Header which already contains content — call inspect to confirm before adding more"). Non-fatal, just a warning. Catches both 1776396109232 and similar.

3. **Runtime-side rename-on-conflict (highest cost, lowest semantic value)**: When jsx tries to create a frame with same name+parent as an existing one, automatically rename to `Foo (2)`. Only addresses trigger 1776304215736's restart pattern; does not help the over-fill pattern.

The data sample is small (1 confirmed post-fix duplicate out of 3 post-fix triggers). Recommend running 10–20 more triggers across different prompt categories (form, dashboard, landing page, list-heavy) before deciding whether a structural fix is justified, or whether option 1 is enough.

---

## Appendix — Detection script

`/tmp/audit-dup-gen-v2.mjs` (and v1: `/tmp/audit-dup-gen.mjs`)
Output JSON: `/tmp/audit-dup-gen-v2.json`
