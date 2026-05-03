# Variable Resolver Redesign — 2026-05

**Status**: Design proposal. Not yet implemented.
**Trigger**: 31 silent wrong-bindings observed across 3 E2E triggers (banking flow, 2026-05-03). Stale `Text/Primary` / `Text/Secondary` from prior session bleeding into new bindings; bug invisible in Default mode, screen-breaking in Midnight mode.
**Predecessor memory**: `project_stale_variable_reuse.md` flagged the pattern; this design closes it.

---

## 1. Problem

Figma variables are **file-scoped persistent state** with no automatic cleanup. The plugin treats them as ephemeral. Result: every E2E run leaves orphan variables in the test file, and the next run's `set_fill fill="$Text/Primary"` token resolver silently picks an orphan instead of the just-created variable.

The bug is **invisible in Light mode and screen-breaking in Dark mode** — every Light-only smoke test passes; users / E2E reviewers only catch it when they manually flip mode.

### Evidence

- `trigger-1777742177567` (Mobile Banking): greeting bound to `VariableID:1870:3106` (orphan). Expected `1894:4930`. 1 wrong binding.
- `trigger-1777742280329` (Transaction Item): 16 text nodes bound to `1870:3106`/`1870:3107`. All wrong.
- `trigger-1777742414332` (Transfer Money): 15 text nodes wrong. Entire screen unusable in Midnight.
- `trigger-1777743815422` (Buttons docs): 0 stale, but exposed adjacent bug — `set_stroke "1 $Brand/600"` shorthand silently drops binding (returns `changed:true`, leaves `boundVariables:{}`).

Total: 32 wrong bindings + 1 missing binding from shorthand parser. Concentrated in `Text/*` namespace.

### Root cause

1. **No collection scoping at resolution time** — `$Text/Primary` looks up by name across all collections in the file.
2. **No deduplication at creation time** — `create_variable("Text/Primary")` with same name as an existing one in another collection is silently allowed.
3. **No "read-your-own-writes" hint to LLM** — agent creates V42, then on next call passes bare `$Text/Primary`, resolver picks ancient V17.
4. **Silent-pick semantics on ambiguity** — multi-match returns first found, no error, no warning.

---

## 2. Architecture — Three layers + symbol-resolution phase

```
LLM tool call
   │
   ▼
[Phase 0: SYMBOL RESOLUTION]      ← PER tool call (NOT batch-level): resolve any
   │                                 (collection_id, name, type) triple to an ID
   │                                 immediately before that call's mutation.
   │                                 Batch-level resolution is unsafe because a
   │                                 batch may contain ensure_variable calls that
   │                                 change the resolution space — see §8 #1.
   ▼
[Phase 1: WRITE-TIME GUARDS]      ← ensure_variable dedup, mode-coverage check
   │                                 (write-time validation before set_fill commits)
   ▼
[Phase 2: EXECUTE]                ← actual Figma API call
   │
   ▼
[Phase 3: AUDIT-TIME]             ← post-hoc: derive from current scene state,
                                     no persistent manifest
```

The architecture maps directly to canonical patterns:

| Layer | Pattern | Source |
|---|---|---|
| Symbol resolution | Compile-time symbol binding (LSP / IDE) | round-0 |
| Write-time dedup | `INSERT … ON CONFLICT (collection_id, name) DO UPDATE` | Postgres |
| Write-time scoping | Kubernetes namespace; DI ambiguous-binding error | K8s / Guice |
| Read-time strict resolver | Guice/Spring strict bindings | DI |
| RYOW context block | Read-your-own-writes consistency | distributed systems |
| Audit-time | Stateless validator (walk current state) | (rejected: persistent manifest) |

---

## 3. Tool API changes

### 3.1 Collection / variable creation — strict ID, idempotent

```ts
ensure_collection({
  name: string,
  modes: Array<{name: string}>,
  idempotency_key: string,         // stable hash of name+modes from caller
}): { ok: true, collection_id: string, modes: ModeMap, warnings?: Warning[] }
 | ErrorEnvelope

ensure_variable({
  collection_id: string,            // strict — no name-string accepted here
  name: string,
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN',
  values_by_mode: Record<string, unknown>,
  idempotency_key: string,
}): { ok: true, variable_id: string, warnings?: Warning[] }
 | ErrorEnvelope
```

**Behavior on cross-collection name clash** (regime `A: soft success`, ratified Round 2):
- If exactly one variable with `(collection_id, name, type)` exists → return it (idempotent).
- If none exist → create, return new ID.
- If same `name+type` exists in OTHER collections → still create in target, return new ID, attach `warnings[]` with `NAME_EXISTS_OUTSIDE_TARGET_COLLECTION` and the candidate list.
- If same `name+type` exists IN target collection more than once (Figma allows this) → **fail loudly**, require explicit `variable_id`.

Rationale for soft success: in the common case, leftover same-name vars in unrelated collections are harmless; hard-fail would block legitimate fresh-namespace creation. Future bindings flow through the strict read-time resolver, which catches mistakes downstream — the warning here is informational, the safety net is in §3.3.

**`idempotency_key` formula (mandatory)**:

```
idempotency_key = sha256(collection_id + "|" + name + "|" + type + "|" + canonical_json(values_by_mode))
```

Properties this gives us:
- Same call with same values → idempotent reuse, returns existing variable_id.
- Same call with NEW `values_by_mode` → key changes → wrapper does NOT silently reuse the old variable. Caller must explicitly call `set_variable_value` to update an existing variable's mode values, or accept that a new variable will be created.
- Random / caller-chosen keys are rejected (validated against the formula). This prevents two failure modes codex flagged: random keys break dedup on retry; partial-key hashes silently skip value updates.

`canonical_json` is JSON with sorted keys and no whitespace, so semantically-equal value maps produce identical keys regardless of insertion order.

### 3.2 Mutation tools — discriminated union for binding target

```ts
set_fill({
  node_id: string,
  fill: { variable_id: string,
          expected_name?: string,           // optional ID-stability assertion
          expected_fingerprint?: string }   // optional stronger assertion
      | { collection_id: string, name: string, type: 'COLOR' }  // structured-name form
      | { color: string }                                       // raw hex
}): MutationResult
```

Bare `$Name` strings are **rejected** at the tool boundary. The agent must pass either an ID (from RYOW context) or a `(collection_id, name, type)` triple. The triple goes through Phase 0 symbol resolution; if ambiguous, fails before any mutation.

**ID stability check** (closes Critical 1 from codex round): when the ID-form is used with `expected_name` or `expected_fingerprint`, the wrapper re-reads the variable's current `name` / fingerprint and compares. If the variable was renamed, mutated (values changed), or reassigned to a different collection by an intervening call (e.g., `js` tool, subtask, or external designer edit) the assertion fails with `STALE_VARIABLE_ID`. Without the assertion, ID-form bindings trust the ID is stable — that's a footgun the doc previously didn't address.

Recommended convention: agents that hold a variable reference across multiple tool calls in the same turn SHOULD always pass `expected_fingerprint`. Agents binding a freshly-created variable in the very next call MAY skip the assertion (low risk window).

Same pattern applies to `set_stroke`, `set_text` color binding, `bind_variable`. Fixes the round-2 shorthand parser bug (`"1 $Brand/600"`) by deleting that code path entirely.

### 3.3 Read-your-own-writes context block

Variable-related tool responses include a compact `_ryow` block:

```ts
{
  ok: true,
  data: { ... },
  _ryow: {
    collections: [{name, id, modes, fingerprint}],
    variables:   [{name, id, collection_id, type, mode_coverage, fingerprint}],
  }
}
```

`fingerprint` is the same `idempotency_key` formula from §3.1, recomputed on every `ensure_*` call. The fingerprint is what makes ID-form bindings detectable-stale (§3.2): if the same `variable_id` later returns a different fingerprint, something mutated it.

**Response scoping** (closes codex Medium 9): `_ryow` is attached only to responses from variable-related tools — `ensure_collection`, `ensure_variable`, `set_variable_value`, `set_fill`, `set_stroke`, `set_text` (when binding), `bind_variable`, `list_variables`. Errors and successful responses from non-variable tools (`set_layout`, `jsx`, `inspect`, etc.) do NOT include `_ryow`. This prevents the agent from following stale IDs that surface incidentally on unrelated errors.

**Lifecycle**: built per-turn, cleared at `turn_end`. Capped at 50 most-recent entries (LIFO). Stored in `agentRuntime` instance memory, not persistent — survives within a turn, gone across turns.

The agent uses `_ryow` to back-reference its own creations without needing to scroll through prior tool results. This is the primary defense against the bug: if the LLM wants to bind to "Text/Primary it just created", the ID is *right there* in the most recent tool result.

**Subtask runtime boundary** (closes codex High 5): subtasks run a child `AgentRuntime` with isolated memory. The child does NOT inherit parent's `_ryow`. Decision: child runtime operates in **strict-name-only mode** for variable bindings — must pass `(collection_id, name, type)` triples, ID-form is rejected at the tool boundary for cross-runtime calls.

Rationale: propagating `_ryow` across runtime boundaries is fragile (parent could mutate the variable between child invocation and child's binding call), and child agents typically operate in narrower scope where re-resolving by name is cheap. Strict-name-only forces the child through Phase 0, which is exactly the safety net we already trust.

---

## 4. Error envelope spec

All errors share this shape:

```ts
{
  ok: false,
  changed: false,
  code: ErrorCode,
  message: string,                        // human-readable, includes IDs
  recommended_next_action: {              // structured, NOT colon-delimited string
    tool: string,
    args: Record<string, any>
  } | null,
  read_your_own_writes: RYOWEntry[],      // relevant subset of _ryow
  candidates: CandidateRef[]              // all matches with full metadata
}
```

### 4.1 Four canonical scenarios

**(a) ensure_variable: name clash in OTHER collection** → `ok:true, changed:true` (per §3.1 regime A) — not an error path.

**(b) Bare name resolution finds 0 or 2+ matches** → `AMBIGUOUS_VARIABLE_REFERENCE`:
```json
{
  "ok": false, "changed": false,
  "code": "AMBIGUOUS_VARIABLE_REFERENCE",
  "message": "Cannot bind fill: 3 COLOR variables match name 'Text/Primary'. No binding applied.",
  "recommended_next_action": {
    "tool": "set_fill",
    "args": {"node_id": "...", "fill": {"variable_id": "V42"}}
  },
  "read_your_own_writes": [
    {"kind":"variable","id":"V42","name":"Text/Primary","collection_id":"C1","collection_name":"Finance/Theme","type":"COLOR","mode_coverage":["Default","Midnight"]}
  ],
  "candidates": [
    {"variable_id":"V42","name":"Text/Primary","collection_id":"C1","collection_name":"Finance/Theme","type":"COLOR","mode_coverage":["Default","Midnight"],"source":"created_this_turn"},
    {"variable_id":"V17","name":"Text/Primary","collection_id":"C0","collection_name":"Old Theme","type":"COLOR","mode_coverage":["Default"],"source":"preexisting"},
    {"variable_id":"V33","name":"Text/Primary","collection_id":"C9","collection_name":"Marketing","type":"COLOR","mode_coverage":["Default","Holiday"],"source":"preexisting"}
  ]
}
```

**(c) `variable_id` no longer exists** → `STALE_VARIABLE_ID`:
```json
{
  "ok": false, "changed": false,
  "code": "STALE_VARIABLE_ID",
  "message": "Variable V42 not found. Possibly deleted between turns. No binding applied.",
  "recommended_next_action": {
    "tool": "ensure_variable",
    "args": {"collection_id":"C1","name":"Text/Primary","type":"COLOR","values_by_mode":{...}}
  },
  "read_your_own_writes": [{"kind":"variable","id":"V42","status":"missing", ...}],
  "candidates": []
}
```

**(d) Mode coverage missing** → `MISSING_MODE_VALUES` (write-time, see §6):
```json
{
  "ok": false, "changed": false,
  "code": "MISSING_MODE_VALUES",
  "message": "Variable V42 lacks values for modes: ['Midnight']. Node 1894:4815 will render in Midnight via mode chain. No binding applied.",
  "recommended_next_action": {
    "tool": "ensure_variable",
    "args": {"collection_id":"C1","name":"Text/Primary","values_by_mode":{"Midnight":"#F0F0F0"}}
  },
  "read_your_own_writes": [{"kind":"variable","id":"V42","mode_coverage":["Default"]}],
  "candidates": []
}
```

### 4.2 Field rules

- `recommended_next_action` is **structured object**, never a colon/comma-delimited string. The LLM consumes `args` directly as the next tool's input.
- `read_your_own_writes` returns ONLY entries relevant to this error (filter by name/collection match), not the entire _ryow.
- `candidates[].source` is one of `"created_this_turn" | "created_this_session" | "preexisting"`. The agent should prefer `created_this_turn` candidates.
- `candidates[].mode_coverage` is an array of mode names — empty array means the variable has no per-mode values (still allowed, but mode coverage will fail downstream).

---

## 5. Migration plan (dogfood-scale)

The strict resolver breaks every existing `$Name` callsite. Production-scale migration plans (% thresholds, sliding windows, telemetry pipelines) don't fit this codebase — we have ~50–200 binding calls/day across 1–2 dev users, no telemetry, only dev-bridge logs as signal.

### 5.1 Phase 1 — `warn_pick_record`

Wrapper preserves current silent-pick behavior but **emits warnings into tool result**:

```ts
{
  ok: true,
  changed: true,
  data: { ... },
  warnings: [{
    code: "AMBIGUOUS_NAME_AUTOPICK",        // NEW — not in current event taxonomy
    picked_variable_id: "V17",
    candidates: [/* full list */],
    suggested_id: "V42"                     // from _ryow if available
  }]
}
```

The warning rides in the LLM-visible `tool_result` and is also emitted as a new `AgentRuntimeAmbiguousAutopickEvent` (added to `src/shared/protocol/agentRuntimeEvents.ts`). Both surfaces are necessary: tool result lets LLM self-correct; runtime event lets us audit historical triggers.

### 5.2 Phase 1 → Phase 2 advance condition

- **5 consecutive E2E runs that exercise variable binding via BOTH name-form AND ID-form** (definition: each run's `tool-calls.json` must contain ≥1 successful binding with `fill: {collection_id, name, type}` AND ≥1 with `fill: {variable_id}`). Phase 1 silent-pick still controls the name-form path; ID-form is exercised but unrestricted by Phase 1.
- **Zero confirmed wrong-binding cases** in those 5 runs. Confirmation procedure: for each binding in `tree.json`, compare bound `var_id` against the `_ryow` block of the same trigger. If `var_id` is not in `_ryow` for the matching name+type+collection, flag manually. **ID-form bindings whose `var_id` came from compressed transcript history (i.e., not in same-turn `_ryow`) count as failures, not "clean"** — this catches the codex Critical 3 case where the agent reuses a stale ID from earlier in the conversation.
- **Decision is manual review**, not automated counter. We do not have the volume to automate this safely.

### 5.3 Phase 2 — strict mode

- Phase 2 enables strict resolver: `set_fill` rejects bare-name forms, requires either `variable_id` or `(collection_id, name, type)` triple.
- **Per-tool rollout, in this order**: `set_fill` → `set_stroke` → `set_text` color binding. `bind_variable` is already ID-only, no migration needed. 1-week gap between each tool's cutover.

### 5.4 Rollback (Phase 2 → Phase 1)

A single `AMBIGUOUS_VARIABLE_REFERENCE` strict-fail is **NOT a rollback signal** by itself — that's the protection working as intended. Rollback only triggers when the failure is a regression, defined as:

- Strict-fail occurred → check the failure's `candidates[]`.
- If `candidates[]` contains an entry with `source: "created_this_turn"` → **legitimate protection**, log + continue. Not a rollback.
- If `candidates[]` does NOT contain a `created_this_turn` entry, AND `_ryow` for the relevant turn shows a variable that *should* have been a candidate but wasn't → **resolver bug or false positive**, flag for manual review.
- If 3 such false-positive cases occur within one E2E session → that tool reverts to Phase 1 mode for the rest of the session, plus the next 7 days. Re-cutover requires a new 5-run advance cycle.

Settings flag for emergency manual rollback: `agentBehaviorConfig.strictVariableResolution: 'phase1' | 'phase2' | 'auto'`.

---

## 6. Mode coverage — write-time, primary

Mode coverage validation lives in `set_fill` (and peers), not in the resolver, not in audit:

- **Resolver doesn't have target node info** → can't know which modes will render.
- **Audit is post-hoc** → too late to refuse.
- **set_fill has both** → variable's `values_by_mode` + node's resolved mode chain via `node.resolvedVariableModes`.

### 6.1 Default behavior

Mode coverage applies to **all variable types** — COLOR, FLOAT, STRING, BOOLEAN — not just COLOR (closes codex Medium 7). Invisible failure modes exist for every type:
- COLOR: dark-on-dark text (the bug we found).
- FLOAT: `Typography/bodySize` missing Mobile mode → desktop value used → mobile layout breaks.
- STRING: i18n token missing a locale → falls back to base language → wrong text shown.
- BOOLEAN: visibility flag missing a mode → flag reverts to base → wrong elements shown.

For every binding call:
1. Read `node.resolvedVariableModes` for the target collection.
2. Read variable's `values_by_mode` keys.
3. If any mode in the resolved chain is missing from values → fail with `MISSING_MODE_VALUES` (envelope §4.1.d).

### 6.2 Caveat — Figma fallback semantics

Figma allows variables to inherit/fallback when a mode lacks an explicit value. Strict "every mode must be explicit" is **stricter than Figma itself** and would block legitimate designer patterns where fallback is intended.

Resolution: split variables into two classes via two new fields:

```ts
ensure_variable({
  ...,
  mode_coverage_required: 'all' | 'opt-in-fallback',   // default: 'all'
  fallback_reason?: string                              // REQUIRED iff opt-in-fallback
})
```

- `'all'` (default): every mode in collection must have explicit value. set_fill blocks bindings on incomplete coverage.
- `'opt-in-fallback'`: explicit acknowledgment that fallback is intended. set_fill allows binding even if coverage is partial; instead emits a `warnings[].code: "FALLBACK_BINDING"` so the audit trail shows the choice was deliberate.

**Structured `fallback_reason` requirement** (closes codex Medium 8): when `mode_coverage_required: 'opt-in-fallback'`, the caller MUST provide `fallback_reason` containing the structured phrase `"fallback to <mode_name>"` (machine-greppable). Calls that pass `'opt-in-fallback'` without a structured reason are rejected — this prevents the LLM from using opt-in as a one-click bypass for `MISSING_MODE_VALUES`.

The reason is logged in audit trail and surfaced as `warnings[].fallback_reason`. It does NOT prove correctness, but it forces the agent to articulate intent — which raises the bar from "silent bypass" to "deliberate, attributable choice".

Theme primitives (Bg/*, Text/*, Brand/*) should be `'all'`. Derived/experimental tokens can be `'opt-in-fallback'`.

---

## 7. Out of scope

This design does **not** address:

1. **Existing orphan cleanup**. Variables already in test files (the `1870:*` orphans we found) are not auto-deleted. Manual cleanup is a one-time operation, not part of this design.
2. **Remote library variables**. If a variable comes from a published library, we cannot mutate `values_by_mode` to fix mode coverage. set_fill will fail with `MISSING_MODE_VALUES` and the LLM must instruct the user to update the library — out-of-band.
3. **Designer manual edits between turns**. If a designer deletes/renames variables in Figma between agent turns, the agent's RYOW will be stale. Detection happens at resolve-time (STALE_VARIABLE_ID), but recovery requires the LLM to re-discover state via list_variables — no automatic resync.
4. **Shadow modes / mode aliases**. Figma supports complex mode chains via `explicitVariableModes`. This design only validates against `resolvedVariableModes` (the effective chain). Edge cases involving overrides not yet enumerated.
5. **Persistent audit log**. Round 1's "manifest" idea is rejected. Audit pass is stateless: walk current scene + variable state, derive issues fresh each time.
6. **Semantic role mismatch** (codex Critical 2). A binding can be technically correct (resolved variable exists, has full mode coverage, ID matches name) yet semantically wrong — e.g., binding a button label on a brand-filled button to `Text/Primary` instead of `Text/OnBrand`, where contrast fails in one theme. The resolver layer cannot detect role misuse; that judgment belongs in prompt engineering and skill knowledge (e.g., "label on accent fill → use OnBrand"). This design closes identity ambiguity, not LLM design judgment. A separate effort (skill: `design-system` knowledge entries; prompt: explicit role→token mapping rules) is needed.

---

## 8. Decisions resolved (post-codex challenge)

The Round 2 doc had 5 open questions; the codex challenge round (2026-05-03) made each concrete via a failure scenario. Closures:

1. **Phase 0 timing → PER-CALL, not batch.** Codex scenario: a batch `[ensure_variable(NewTheme/Text/Primary), set_fill(NewTheme/Text/Primary)]` with batch-level Phase 0 either fails the second call (no new var visible yet) or resolves to an older same-name var (stale state). Per-call resolution sees the post-mutation state of prior calls in the batch and is the only safe choice. Reflected in §2.

2. **`_ryow` on errors → SCOPED.** Attached only to responses from variable-related tools. Codex scenario: agent following an ID surfaced incidentally on a `set_layout` error → ID still exists but values mutated since last variable touch → silent wrong binding. Reflected in §3.3 ("Response scoping").

3. **Idempotency key → FULL CONTENT HASH.** Formula in §3.1. Codex scenarios: random keys break dedup on retry (orphan ramp); partial-key (`hash(collection+name+type)` only) silently returns old variable when caller intended to update values. Full content hash forces the caller to either truly idempotent reuse OR explicit `set_variable_value` update.

4. **Subtask boundary → STRICT-NAME-ONLY in child runtime.** No `_ryow` propagation. Codex scenario: child inherits parent _ryow → parent mutates V42 between child invocation and child's bind call → child binds stale ID. Strict-name-only forces child through Phase 0 every time. Reflected in §3.3.

5. **Mode coverage scope → ALL TYPES.** FLOAT/STRING/BOOLEAN have invisible mode-fallback failure modes too. Reflected in §6.1.

Two new decisions (codex Critical findings absorbed):

6. **ID stability check → FINGERPRINT in `_ryow` + optional `expected_*` assertions.** Codex Critical 1: agent creates V42 = "Text/Primary"; intra-turn tool (`js`/subtask/edit) mutates V42's values or renames it; agent later binds `{variable_id: V42}` thinking it's still Text/Primary; all phases pass; wrong binding shipped. Reflected in §3.2 + §3.3.

7. **Phase 2 advance condition → BOTH name-form and ID-form coverage required.** Codex Critical 3: 5-clean-runs gate using only name-form silent-pick never tests Phase 2's preferred path; on cutover the agent reuses a stale ID from compressed transcript history; gate never saw it; wrong binding ships. Reflected in §5.2.

---

## 9. Implementation order

Sequenced for minimum blast radius per change:

1. **`ensure_variable` + dedup** (write-time guard) — closes the orphan-creation faucet. No callsite changes; existing `create_variable` callers keep working but get warnings on dup-name.
2. **`_ryow` block + new event type** — additive, breaks nothing.
3. **Strict resolver in `set_fill` Phase 1 (`warn_pick_record`)** — silent-pick stays but logs warnings.
4. **Mode coverage check (default `'all'`)** — new failure path; needs prompt update so LLM knows about `MISSING_MODE_VALUES`.
5. **`set_fill` discriminated union** — breaks bare-name callsites; gated by Phase 2 cutover.
6. **`set_stroke` shorthand parser fix** — bundle with (5).
7. **Rollback infrastructure + settings flag** — ship before (5)/(6) cutover.

Files affected (rough inventory):
- `src/engine/agent/tools/unified/varTools.ts` — ensure_variable, ensure_collection
- `src/engine/agent/tools/unified/setterTools.ts` — set_fill, set_stroke discriminated union
- `src/engine/agent/tools/expandShorthands.ts` — bare-name resolution path (delete or gate)
- `src/ipc/commands/varHandlers.ts` — execution side, dedup logic
- `src/shared/protocol/agentRuntimeEvents.ts` — new event types
- `src/engine/agent/agentRuntime.ts` — `_ryow` lifecycle (turn_start/turn_end hooks)
- `src/engine/agent/agentBehaviorConfig.ts` — strictVariableResolution flag
- `src/prompts/CORE.md` + `src/prompts/EXAMPLES.md` — teach LLM the new error envelope + recommended_next_action format
- New: `src/engine/agent/symbolResolver.ts` — Phase 0 layer

Test surface: unit tests for resolver branches, dev-bridge E2E for cross-turn behavior, integration test that reproduces the original 31-bug scenario and verifies all 31 are caught.

---

## 10. Provenance

This design synthesizes:
- Round 0 (problem framing + database mapping)
- Round 1 (3-layer architecture + concrete error envelopes)
- Round 2 (dogfood-scale migration + write-time mode coverage)
- Round 3 — codex adversarial challenge (2026-05-03). Surfaced 9 findings: 3 Critical, 3 High, 3 Medium. All Critical findings absorbed into design (ID fingerprint check in §3.2/§3.3; advance condition strengthened in §5.2; semantic-role mismatch acknowledged as out-of-scope in §7.6). All 5 Round 2 open questions closed via High findings — see §8. Medium findings extended scope: non-COLOR mode coverage (§6.1), opt-in-fallback structured `fallback_reason` (§6.2), `_ryow` response scoping (§3.3).
- Local fixes: scoped advance condition, RYOW lifecycle, structured `recommended_next_action`, mode-coverage opt-in fallback.

Status: ready to implement per §9 sequencing. Next pending review: post-implementation pass once Phase 1 is in place — verify the originally-observed 32 wrong bindings are caught, plus a regression test for the codex Critical 1 (intra-turn variable mutation) scenario.
