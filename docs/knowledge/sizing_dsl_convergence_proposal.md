# Sizing DSL Convergence Proposal

> Companion to commit `58656a4` (layout DSL fail-fast). Same disease in the sizing dimension; this doc maps the entry-point sprawl and proposes three convergence tiers. **Analysis only — no code changes.**

---

## 1. Sizing Entry Point Inventory

### 1.1 Expander entries (the DSL surface)

| DSL key       | Accepted value forms                                        | Figma target property                            | Code location                                            | Fallback / silent coercion |
|---------------|-------------------------------------------------------------|--------------------------------------------------|----------------------------------------------------------|----------------------------|
| `w`           | delegates to `width`                                        | →                                                | `expandShorthands.ts:303` (`w: (v, all) => width(v, all)`) | inherits from `width`     |
| `h`           | delegates to `height`                                       | →                                                | `expandShorthands.ts:304`                                | inherits from `height`    |
| `width`       | `'fill' \| '100%' \| 'hug' \| number \| numeric-string('200', '200px') \| any other string`  | `layoutSizingHorizontal: FILL/HUG` **or** `width: number` **or** `width: <raw string>` (silent passthrough) | `expandShorthands.ts:190-200` | YES — line 199 `return { width: v }` for unknown strings; no enum/range check before Figma |
| `height`      | same as `width` (vertical)                                  | `layoutSizingVertical` or `height`               | `expandShorthands.ts:202-212`                            | YES — same                 |
| `sizing`      | `'fill' \| 'hug' \| 'fixed' \| any string` (single → both axes) **or** `[h, v]` array                | `layoutSizingHorizontal + layoutSizingVertical`  | `expandShorthands.ts:214-223`                            | YES — `String(v).toUpperCase()` (line 216, 220); unknown values reach Figma as e.g. `'FJLL'`, dropped by enum validator at `node-normalizers.ts:147` with a warning, not fail-fast |
| `sizingH`     | `'FILL' \| 'HUG' \| 'FIXED' \| 'AUTO' \| 'STRETCH' \| any string` | `layoutSizingHorizontal`                         | `expandShorthands.ts:353`                                | YES — `String(v).toUpperCase()`; same path as `sizing`. **Identical to the layout-fix anti-pattern** |
| `sizingV`     | same as `sizingH`                                           | `layoutSizingVertical`                           | `expandShorthands.ts:354`                                | YES — same                 |
| `layoutSizingHorizontal` | raw enum (`FILL/HUG/FIXED/AUTO/STRETCH`)         | passthrough; enum validation in node-normalizers | listed in `STRING_VALUE_PROPS` `prop-dsl.ts:40` and as enum in `figma-property-registry.ts:1231` | tolerant — `AUTO`→`HUG`, `STRETCH`→`FILL` aliasing baked in at registry `:1232,1237` |
| `layoutSizingVertical`   | same                                              | passthrough                                      | `prop-dsl.ts:41`, `figma-property-registry.ts:1236-1240`   | tolerant — same |
| `minW`        | `number \| variable-ref ($var)`                             | `minWidth`                                       | `expandShorthands.ts:359`                                | none (but **no** unit-string handling — `minW:'200px'` would yield `NaN`) |
| `maxW`        | same                                                        | `maxWidth`                                       | `expandShorthands.ts:360`                                | none, same caveat |
| `minH`        | same                                                        | `minHeight`                                      | `expandShorthands.ts:361`                                | none, same |
| `maxH`        | same                                                        | `maxHeight`                                      | `expandShorthands.ts:362`                                | none, same |
| `minWidth/maxWidth/minHeight/maxHeight` | raw passthrough (numeric)                            | direct                                           | listed `NUMERIC_PROPS` `prop-dsl.ts:59`                  | none |
| `lockRatio`   | `bool \| 'true'/'false'`                                    | `constrainProportions: bool`                     | `expandShorthands.ts:357`                                | none |
| `layoutGrow`  | `number 0..1` raw passthrough                               | direct                                           | `figma-property-registry.ts:1250`                        | none (clamped by scalar range in `node-normalizers.ts:178`) |
| `layoutAlign` | raw enum (`MIN/CENTER/MAX/STRETCH/INHERIT`) passthrough     | direct                                           | `figma-property-registry.ts:1251`                        | enum validated, drops on miss |

### 1.2 Entries that look sizing-related but are not in scope here

- `aspectRatio` / `ratio` — **not implemented**. Only `targetAspectRatio` exists in `figma-property-registry.ts:132,236,...` and it is `readonly: true, role: 'computed'`. No DSL entry.
- `autoResize` — **not a DSL entry**. `textAutoResize` is the Figma-native property; `node-normalizers.ts:97-114` synthesizes it from `w`/`h` for text nodes. Per the task's "do not touch text" hard constraint, kept out of scope.
- `primaryAxisSizingMode` / `counterAxisSizingMode` — **legacy Figma API**. Marked `role: 'deprecated'` in `figma-property-registry.ts:116-117, 755-756, 880-881, 1002-1003`. `KNOWN_PROP_KEYS` only includes `role: 'visual'` properties (`figma-api.ts:64-66`), so `deprecated`-role props are **never** accepted from the LLM. They appear in `EXECUTION_ORDER` (`propertyDependencies.ts:199-200`) only for ordering — no write entry. **Safe to ignore in this proposal.**

### 1.3 Counts

- **6 distinct DSL entries** that write into the sizing-mode axes: `w`, `h`, `width`, `height`, `sizingH`, `sizingV`, `sizing`, plus 2 raw passthroughs `layoutSizingHorizontal/Vertical`. Total: **9 ways** to set "is this fill or hug or fixed".
- **3 silent-coercion fallbacks** identical to the pre-`58656a4` layout pattern: `sizing(v)` (line 216), `sizingH(v)` (line 353), `sizingV(v)` (line 354) — all do `String(v).toUpperCase()`.
- **2 silent-passthrough fallbacks**: `width(v)`/`height(v)` lines 199/211 — unknown string → `{ width: <raw> }`, no fail-fast.
- **2 alias-coercions**: registry maps `AUTO→HUG`, `STRETCH→FILL` for `layoutSizingHorizontal/Vertical` (`figma-property-registry.ts:1232,1237`).

---

## 2. Figma API Alignment Matrix

For each Figma sizing-related property, where can it currently be written from?

| Figma API property              | Native enum / type                                    | Reachable via DSL keys                                                                 | Risk |
|---------------------------------|--------------------------------------------------------|----------------------------------------------------------------------------------------|------|
| `width: number`                 | scalar                                                 | `w`, `width`, `width:'200'`, `width:'200px'`                                           | low (parser strips `px`) |
| `height: number`                | scalar                                                 | `h`, `height`, same patterns                                                            | low |
| `minWidth/maxWidth/minHeight/maxHeight` | scalar                                         | `minW/maxW/minH/maxH` (preferred) **and** raw `minWidth/...` (also numeric in `prop-dsl.ts:59`) | low; double-entry but no semantic conflict |
| `layoutSizingHorizontal`        | `'FIXED' \| 'HUG' \| 'FILL'` (Figma)                   | `w:'fill'/'hug'/'100%'`, `width:'fill'/'hug'/'100%'`, `sizing:'fill'`/`['fill','hug']`, `sizingH:'FILL'/'HUG'/'FIXED'/'AUTO'/'STRETCH'`, raw `layoutSizingHorizontal:'...'` | HIGH — 5 different keys, 5 value vocabularies (`fill`/`100%`/`FILL`/`STRETCH`/case-insensitive), 3 silent fallbacks |
| `layoutSizingVertical`          | same                                                   | symmetric (`h`, `height`, `sizing`, `sizingV`, raw `layoutSizingVertical`)              | HIGH — same |
| `layoutAlign`                   | `'MIN'\|'CENTER'\|'MAX'\|'STRETCH'\|'INHERIT'`         | raw `layoutAlign:` passthrough; enum-validated                                          | low (no shorthand) |
| `layoutGrow`                    | `0..1` scalar                                          | raw `layoutGrow:`; clamped 0–1 in registry `:1250`                                       | low (no shorthand) |
| `primaryAxisSizingMode` / `counterAxisSizingMode` (legacy) | `'FIXED'\|'AUTO'`                  | NONE — filtered out by `KNOWN_PROP_KEYS` whitelist                                      | none |
| `textAutoResize` (text)         | `'NONE'\|'WIDTH_AND_HEIGHT'\|'HEIGHT'\|'TRUNCATE'`     | (out of scope) — synthesized from `w`/`h` in `node-normalizers.ts:97-114`               | n/a |
| `targetAspectRatio` (computed)  | readonly                                                | NONE — `role: 'computed'`, never written                                                | none |
| `constrainProportions`          | bool                                                   | `lockRatio` shorthand + raw passthrough                                                  | low |

### 2.1 Specific semantic questions

**Q: `layoutSizingHorizontal: 'FIXED'` vs `width: 240` — do they conflict?**
A: They cooperate. `FIXED` only declares "the size is locked"; the actual pixel value comes from `width`. `nodeFactory.ts:770-778` explicitly tops up a default `width` when `FIXED` is set without one (defaults: 360 root, 200 child, or inherits target/parent). Same logic for `height`/Vertical at `:780-788`. **No "one wins over the other"** — they target different fields.

**Q: `width: 240` alone (no sizing mode) — what happens?**
A: `resizeHandler.ts:13` calls `node.resize(240, currentH)`. Figma's `resize()` **silently sets layoutSizing to FIXED** (per `figma-plugin-api-gotchas.md` and the comments at `propertyDependencies.ts:197-200`). That's why `EXECUTION_ORDER` puts `width`/`height` BEFORE `layoutSizingHorizontal/Vertical`: write the size first, then explicitly re-assert `FILL`/`HUG` if needed. So `width: 240` alone yields effective FIXED. This is well-defined; the issue is that the LLM might write `w:240, sizingH:'FILL'` and reasonably expect FILL — and it works because of the ordering rule.

**Q: `counterAxisSizingMode` / `primaryAxisSizingMode` — legacy double-write or independent?**
A: Legacy. The Figma docs deprecated them in favor of `layoutSizingHorizontal/Vertical`. Confirmed in this codebase: `role: 'deprecated'` in registry (5 sites), filtered out by `KNOWN_PROP_KEYS`. They appear only in `EXECUTION_ORDER` for the rare case they are written by some legacy path — no current path writes them. **Effectively dead from the LLM's perspective.**

**Q: `textAutoResize` vs frame `layoutSizingHorizontal/Vertical` — same system?**
A: Independent systems. Text nodes don't have `layoutSizingHorizontal`. `textAutoResize` controls whether the text bounding box auto-grows (`WIDTH_AND_HEIGHT` = both, `HEIGHT` = wrap horizontally, `NONE` = fully fixed, `TRUNCATE` = clip). The DSL's `w`/`h` on a text node still parse into `width`/`height`/`layoutSizing*`, then `node-normalizers.ts:97-114` derives `textAutoResize` from "is width locked? is height locked?" — a *synthesis layer*, not a duplicate. Out of scope per task constraint.

---

## 3. Convergence Proposals (3 tiers)

### Tier A — most aggressive (narrow single-entry)

**Surface kept:** only `w` and `h`.
**Value vocabulary:**
```
w: number | 'fill' | 'hug' | '100%'   // '100%' is alias for 'fill' (LLM training prior)
h: number | 'fill' | 'hug' | '100%'
```
**Removed:** `width`, `height`, `sizing`, `sizingH`, `sizingV`, raw `layoutSizingHorizontal`, raw `layoutSizingVertical`. Plus `String(v).toUpperCase()` and silent passthrough fallbacks all gone.
**Min/max kept:** `minW`/`maxW`/`minH`/`maxH` (with px parse to support `minW:'200px'`).
**Behavior on unknown:** throw the same `unknown sizing value "filll"; valid: number|fill|hug|100%` from inside the expander (mirrors `expandShorthands.ts:96-99`).

| Aspect | Value |
|---|---|
| Code lines deleted | ~30 lines in `expandShorthands.ts` (sizing/sizingH/sizingV/width/height duplication), ~6 in `prop-dsl.ts` (`layoutSizingHorizontal/Vertical` removed from `STRING_VALUE_PROPS`), ~4 in `templateCompiler.ts` `applyLayoutDefaults` (drop `sizingH/V/layoutSizingH/V` checks), ~2 in `writeHandlers.ts:90-91` likewise. **~45 LOC.** |
| Code added | ~10 lines: tightened `width`/`height` expanders with explicit error-throwing for unknown strings; `w`/`h` keep delegating. |
| Migration: prompts | **0 files.** Prompts already use `w`/`h` exclusively (verified: `grep` of `src/prompts/**/*.md` shows 20×`w="fill"`, 4×`h="fill"`, ~13×`w={N}`, 0×`width`, 0×`sizingH`, 0×`sizingV`, 0×`layoutSizing`). |
| Migration: knowledge entries | **1 stale entry** (`.agent/skills/agent-page/SKILL.md:46-49` — uses `mk` tool with `sizingH:hug sizingV:hug`). The `mk` tool was deleted; this is dead text. Either rewrite to `jsx`+`w/h`, or delete the example block. |
| Migration: component anatomies | `.agent/knowledge/components/*.yaml` use raw `layoutSizingHorizontal: FILL` as **descriptive metadata**, not as DSL writes. They feed templates and reads, not LLM tool calls. **No change needed** unless we also tighten the template generator. |
| LLM learning cost | Near zero — the primary surface (`w`/`h`) is unchanged and is what the LLM already prefers. |
| Risk | Low — but external integrations (E2E harnesses, dev-bridge consumers) that send `width`/`height` as keys would break. |

### Tier B — reasonable convergence

**Surface kept:** `w`, `h` (canonical) + `width`, `height` (alias, strong train prior).
**Value vocabulary:** same as Tier A (`number | 'fill' | 'hug' | '100%'`).
**Removed:** `sizing`, `sizingH`, `sizingV`, raw `layoutSizingHorizontal`, raw `layoutSizingVertical`.
**Behavior on unknown:** fail-fast throw, same message style.

| Aspect | Value |
|---|---|
| Code lines deleted | ~15 lines (drop 3 sizing/sizingH/sizingV expanders + their fallbacks, drop `layoutSizingHorizontal/Vertical` from `STRING_VALUE_PROPS`). |
| Code added | ~6 lines: tightened `width`/`height` with throw on unknown string. |
| Migration: prompts | **0 files.** No prompt uses `sizingH`/`sizingV` or raw `layoutSizing*`. |
| Migration: knowledge entries | Same 1 stale `agent-page/SKILL.md` block. |
| Migration: tests | `expandShorthands.test.ts:157-168` (`describe('sizing')`) — delete. `shorthandPipeline.test.ts:156-160` (`sizingH:FILL / sizingV:HUG`) — delete. |
| LLM learning cost | Near zero — these aliases (`sizingH`, `sizing`) have weak train prior and we authored them. |
| Risk | Very low. `templateCompiler.ts:529,536` and `writeHandlers.ts:90-91` still defensively check `sizingH/V` for "is sizing already set?" — would need to drop those checks too (a few lines). |

### Tier C — minimum drop-in (matches `58656a4` exactly)

**Surface kept:** all current entries.
**Change:** only convert `sizingH`, `sizingV`, `sizing` from `String(v).toUpperCase()` to white-list fail-fast (throw `unknown sizing value "X"; valid: fill|hug|fixed`). `width`/`height` similarly throw on unparseable strings instead of silent passthrough on line 199/211.

| Aspect | Value |
|---|---|
| Code lines deleted | 0 |
| Code added | ~12 lines (3 narrow vocab maps + throw clauses on the 4 expanders) |
| Migration: prompts/knowledge | none |
| LLM learning cost | none — only failure mode changes (warn-then-drop → loud throw) |
| Risk | minimal; equivalent to the layout fix governance level |

---

## 4. Figma API Semantics — Background for the Decision

Figma's sizing model is a **two-layer system**:

1. **Mode:** `layoutSizingHorizontal/Vertical ∈ {FIXED, HUG, FILL}` declares the *intent*. HUG/FILL only make sense in an auto-layout context — HUG requires `layoutMode != NONE` on the node itself; FILL requires the parent to have an auto-layout. Outside auto-layout, only FIXED is legal. `LayoutValidator.normalizeSizing` (`LayoutValidator.ts:29-80`) enforces this with five cascading rules and demotes invalid combinations to FIXED with a console warning.

2. **Value:** `width`/`height` (numbers) carry the actual pixel dimension. The kicker: Figma's `node.resize()` **side-effects layoutSizing back to FIXED**. That's why this codebase forces a strict order — `width/height` written first, then `layoutSizingHorizontal/Vertical` re-asserted to FILL/HUG (`propertyDependencies.ts:197-200`). The two are not redundant; FIXED+width together define a locked size, FILL+width gives a starting size that grows to fit parent.

For non-auto-layout (legacy) frames the only knobs are `width/height` plus `constraints` (which controls how the child reflows when the parent resizes). `layoutSizing*` doesn't apply.

For text the system is parallel but separate: `textAutoResize` ∈ {NONE, WIDTH_AND_HEIGHT, HEIGHT, TRUNCATE} controls whether the text bounding box hugs its content. `node-normalizers.ts:97-114` derives this from "is width or height locked", which is itself derived from the same `w`/`h` DSL — single LLM input, multiple Figma writes downstream. Independent system, same DSL surface.

---

## 5. What Canonical Sizing DSL Looks Like (under Tier B)

**Today** (multiple paths to the same Figma state):

```jsx
<frame layout='row' w='fill' h='hug'>           // canonical
<frame layout='row' width='fill' height='hug'>  // verbose alias
<frame layout='row' sizingH='FILL' sizingV='HUG'>   // shouty alias
<frame layout='row' sizing='fill'>              // ambiguous (both axes)
<frame layout='row' layoutSizingHorizontal='FILL' layoutSizingVertical='HUG'>  // raw native
<frame layout='row' w='100%' h='hug'>           // CSS alias
<frame layout='row' w='STRETCH' h='AUTO'>       // accepted via registry alias map
<frame layout='row' w='filll' h='hug'>          // typo silently passthrough/dropped, partial render
```

**Under Tier B** (one canonical + one alias, fail-fast on typos):

```jsx
<frame layout='row' w='fill' h='hug'>            // primary
<frame layout='row' width='fill' height='hug'>   // verbose alias kept (train prior)
<frame layout='row' w={240} h={120}>             // fixed dimensions
<frame layout='row' w='hug' h={44}>              // mixed — hug width, fixed height
<frame layout='row' w='100%' h='hug'>            // '100%' alias for 'fill'

<!-- These now throw at expander, surfacing to LLM as ToolResponse.error: -->
<frame layout='row' sizingH='FILL'>              // ERROR: sizingH removed, use w
<frame layout='row' layoutSizingHorizontal='FILL'>  // ERROR: raw layoutSizing* removed
<frame layout='row' w='filll'>                   // ERROR: unknown sizing value "filll"; valid: number|fill|hug|100%
```

The "five fingers, all do the same thing" gets pruned to "one canonical, one verbose alias, all unknowns are typos."

---

## Recommendation

**Go with Tier B.** Rationale:
- Tier A is theoretically purer but breaks `width`/`height` which has the strongest LLM train prior — high blast radius for negligible code savings vs Tier B.
- Tier C matches `58656a4` precedent but leaves 3 redundant entry keys (`sizing`, `sizingH`, `sizingV`) that have no value beyond historical accident — they'll keep showing up in trigger logs and confuse future audits.
- Tier B kills exactly the 4 pieces of misinformation (`sizing`, `sizingH`, `sizingV`, raw `layoutSizing*`) without breaking anything the LLM actually uses. **0 prompt files to touch, 1 stale skill block to clean up, ~21 LOC delta total.**

The `(LLM never used → not in prompts → no train prior to preserve)` triangle covers all four removed entries. The only real cost is removing the 2 unit tests for `sizing` / `sizingH/V`.

---

## Out of Scope (per task constraints)

- `nodeFactory.ts:770-788` width/height fallback when sizing mode demoted to FIXED — separate concern, kept.
- `textAutoResize` and text-node sizing synthesis at `node-normalizers.ts:97-114` — text dimension semantics out of scope.
- `LayoutValidator.normalizeSizing` cascading demotion rules — already audited in commit `cdadde0`.
- `applyLayoutDefaults` defaults (`templateCompiler.ts:507-541`, `writeHandlers.ts:84-92`) — defaults logic stays; only the conditional checks against deprecated keys would be trimmed during Tier B execution.
