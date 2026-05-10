# Stale Variable ID Reuse Across Sessions (2026-04-24)

## Symptom

After running a "design a theme system" prompt in a Figma file that had been
used for **previous E2E tests of the same prompt**, the LLM created new
variables this session but bound the **Light** variant of the Product Card
to a variable ID from a **previous session's** Theme collection, while the
cloned Dark variant bound to the new session's variable.

Result: two side-by-side cards render as expected visually (white + dark),
but they are bound to **two different Surface variables** in two different
collections. `set_variable_mode` on either card only switches one
collection — the other card's color won't change.

## Reproduction

1. Run Prompt A in file F — creates Theme collection `1774:*`, variables
   `1774:23731` (Surface), etc.
2. Later, in the same file F, run Prompt A again (or similar) — LLM creates
   a new Theme collection `1778:*`, new Surface `1778:23833`.
3. Inspect tree: Light card's `Card Surface.fills[0].boundVariables.color.id`
   = `1774:23731` (OLD). Dark card's = `1778:23833` (NEW).

Observed in trigger `trigger-1777003164142` (2026-04-24 regression run).

## Likely root causes (ranked)

1. **`list_variables` returns both old and new collections**. The LLM sees
   the old Surface variable in the list, doesn't notice the name collision,
   picks the first match (old one) when building the Light card via jsx
   `bg="$Surface"` → `variableBindingHandler.findVariable('Surface')` hits
   the cached fallback key `"Surface"` which may point to the older
   variable (see `variableBindingHandler.ts:33` — `if (!varCache.has(v.name))
   varCache.set(v.name, v as unknown as VariableValue);`).
2. **Variable cache built once per session, not invalidated on file change**.
   The cache keys by `"Collection/name"` as primary and `"name"` as fallback.
   First variable to register under bare `"name"` wins. If the old session's
   variable was registered first, subsequent `$Surface` resolves to it.
3. LLM-side bias: seeing `list_variables` output, the model may prefer the
   earliest matching ID out of completion inertia.

## Why this is not a Bug 1 / Bug 2 regression

The two bug fixes landed today (commits `188c81b`, `fb62c5a`) are about
CLI residue removal and `bind_variable` COLOR rejection. Neither touches
variable discovery, caching, or name lookup. This failure mode predates
both fixes and would have occurred identically before them. It surfaces
now only because the dogfood file accumulated stale test collections.

## Impact

- Theme-switching tools (`set_variable_mode`) silently do half the work.
- "Same token" across a design isn't the same token — refactoring via the
  variable panel edits one, not both.
- Hard to detect visually in a one-shot run; only shows when switching
  modes or when reading `boundVariables.color.id` in the tree.

## Mitigations to consider (not implemented)

- **Clear canvas** (or clear just the `1774:*`-era orphan collections)
  before each E2E run. The orphan nodes named `"1771:23401"` in the current
  canvas are a related residue from a pre-fix session.
- **Prefer `"Collection/name"` key** over bare `"name"` in
  `variableBindingHandler.findVariable`. Force the LLM to disambiguate by
  collection, rejecting ambiguous lookups.
- **Invalidate `varCache` on session start**, not just on
  `invalidateVariableCache()` calls from `handleCreateVariable` etc. The
  cache currently persists across `run()` calls.
- **Prompt-layer nudge**: when `list_variables` returns multiple
  same-named variables in different collections, surface that conflict
  to the LLM so it picks deliberately.
- **File-hygiene E2E harness**: wipe the page before each trigger when
  running regression tests, or create a fresh file per scenario.

## Related

- Commits: `188c81b` (CLI cleanup), `fb62c5a` (bind COLOR rejection).
- Previous bug context: `/tmp/figma-bridge/results/trigger-1776997482288/`
  (pre-fix run) and `trigger-1777003164142` (post-fix run, this finding).
- `variableBindingHandler.ts:19-36` — the cache logic.
- `varHandlers.ts handleListVariables` — returns all local variables,
  including orphans from prior sessions.
