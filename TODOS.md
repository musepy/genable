# TODOS

## P2: Memory Storage Migration — clientStorage → pluginData

**What**: Migrate persistent memory from per-user `figma.clientStorage` to per-file `node.setPluginData()` on the `.agent` page root node.

**Why**: Current `clientStorage` is per-user/per-device. When multiple designers collaborate on the same file, they don't share memory — designer A's brand color preferences are invisible to designer B's agent. `pluginData` is file-scoped and shared across all collaborators.

**Pros**: True "canvas-native" — memory belongs to the file, not the device. Enables multiplayer design system awareness.

**Cons**: Requires `.agent` page to exist first (chicken-and-egg with onboarding). Needs one-time data migration from old `clientStorage` entries. Concurrent writes need optimistic locking (timestamp check).

**Context**: Eng review (2026-03-21) deferred this because multiplayer sharing wasn't in the current Approach B scope. The code architecture supports this cleanly — `memoryStore.ts` is the only file that needs changing (swap `clientStorage` calls for `pluginData` calls). Migration path: read old `clientStorage` keys → write to `pluginData` → delete old keys.

**Effort**: M (human ~3d / CC ~30min)
**Depends on**: Confirmed user demand for multiplayer memory sharing.

---

## P3: Memory Diff V2 — Variable Rename Detection + Multi-Mode

**What**: Extend `tokenDiffer.ts` to handle variable renames and multi-mode (light/dark) diffing.

**Why**: V1 does value-level diff only. If a user renames `Colors/Blue/9` to `Brand/Primary`, V1 reports "deleted Blue/9, added Brand/Primary" instead of "renamed Blue/9 → Brand/Primary". Multi-mode files (light/dark themes) only diff the default mode in V1.

**Pros**: More accurate and useful change reports. Fewer false positives.

**Cons**: Fuzzy rename matching is complex (need heuristics like same-value-different-key). Multi-mode multiplies the diff surface. Could be over-engineered if renames are rare.

**Context**: `tokenDiffer.ts` has clean interfaces (`TokenSnapshot`, `TokenDiffResult`) that support extension. For renames: compare removed+added pairs by value similarity. For multi-mode: change `colors: Record<string, string>` to `Record<string, Record<string, string>>` (key → mode → value).

**Effort**: M (human ~3d / CC ~30min)
**Depends on**: V1 Memory Diff in production + user feedback confirming false positives are a problem.

---

## P1: WebSocket Relay Authentication Enforcement

**What**: When `RELAY_SECRET` is unset, auto-generate a random secret and write to config. Reject connections without valid secret.

**Why**: Security baseline — prevents non-plugin clients from connecting to the relay and executing tool calls. Currently localhost-only but needed for future remote deployment.

**Pros**: Security hardening, paves the way for remote MCP server deployment.

**Cons**: Users need to configure the secret in their Figma plugin settings. Adds a setup step.

**Context**: `wsRelay.ts` already has `RELAY_SECRET` env var support (line 19) and auth check in the handshake handler. Just needs: (1) auto-generate when unset, (2) make rejection the default instead of optional.

**Effort**: S (CC: ~20min)
**Depends on**: None.

---

## P2: Verify Quality Score (0-100)

**What**: The `verify` MCP tool returns a composite quality score alongside the issues list.

**Why**: Gives LLM and users a quick signal for "how good is this design?" LLM can use the score to decide whether to continue optimizing.

**Pros**: Simple quality metric, enables LLM self-assessment loop.

**Cons**: Score algorithm needs tuning — bad calibration could mislead.

**Context**: CEO review (2026-03-23) proposed this as a delight opportunity. The 3 MVP diagnostics (empty frame, inconsistent spacing, text overflow risk) can be weighted into a simple score. Future diagnostics (overflow, contrast) improve the score's coverage.

**Effort**: S (CC: ~15min)
**Depends on**: verify tool MVP completed.

---

## P2: Design System Awareness — Read Figma Variables

**What**: MCP tools auto-read the target Figma file's design variables (colors, fonts, spacing) before generation, injecting them into LLM context.

**Why**: Generated designs automatically match the user's existing design system. Directly solves the "consistency is hard to maintain" pain point.

**Pros**: Core differentiator — other tools can't do this. Canvas-native advantage.

**Cons**: Figma Variables API is complex, naming conventions vary, may need heuristic parsing.

**Context**: The plugin already has `query_knowledge` for design tokens via `run("var")` command. Extension: auto-call at session start and inject into MCP `instructions` alongside workflow guidance.

**Effort**: M (CC: ~45min)
**Depends on**: verify + fill tools completed, at least 5 users confirm need.
