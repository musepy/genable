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
