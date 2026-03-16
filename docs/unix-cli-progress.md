# Unix CLI Tool Design — Progress Tracker

> Last updated: 2026-03-16

## Design Philosophy (from architecture diagrams)

### Three Progressive Discovery Mechanisms
1. **--help self-discovery**: tool description → cmd(no args) → cmd subcmd — progressive depth
2. **Error Message correction**: every error includes "what's wrong" AND "what to do"
3. **Output Format feedback**: `[exit:N | Xs]` — exit code for success/failure, timing for cost awareness

### Two-Layer Architecture
- **Layer 1 (Execution)**: Pure Unix semantics — command routing, pipe `|`, chain `&&`/`||`/`;`, exit codes 0/1/127
- **Layer 2 (LLM Presentation)**: Binary guard, overflow truncation (200+ lines), metadata footnotes, stderr appending
- Key rule: processing only at final output, never pollutes pipeline data

### Exit Code Semantics
- `exit:0` — success, result is trustworthy
- `exit:1` — general error, check output
- `exit:127` — command not found, change direction

### Timing Semantics
- `12ms` — cheap operation, call freely
- `3.2s` — moderate cost, mind frequency
- `45s` — expensive, use cautiously

---

## Implementation Status

### Phase 1: Foundation — Exit Codes & Metadata Format ✅
| Item | Status | Notes |
|------|--------|-------|
| Exit code in _meta (`[exit:0 \| 12ms]`) | ✅ Done | `exitCode.ts` utility + toolDispatcher + MCP server |
| Distinguish exit:1 vs exit:127 | ✅ Done | PATH_NOT_FOUND/UNKNOWN_COMMAND → 127, others → 1 |
| Human-readable timing (ms→s for >1000ms) | ✅ Done | `formatTiming()`: <1000 → ms, ≥1000 → Xs |
| Metadata in MCP server output | ✅ Done | Footer appended to all MCP responses |
| stderr extraction | ✅ Done | Warnings/violations → `[warn]`, errors → `[error]` |
| 30 unit tests | ✅ Done | `exitCode.test.ts` |

### Phase 2: Error Messages — Actionable Guidance ✅
| Item | Status | Notes |
|------|--------|-------|
| Unknown command → suggest similar | ✅ Done | Levenshtein fuzzy match: "grp" → "Did you mean grep?" |
| Missing args → show usage | ✅ Done | Help mode returns full usage |
| Path not found → suggest `ls` | ✅ Done | Already includes "Use ls..." in error |
| Chain failure → guidance | ✅ Done | "Fix the failing command first, then retry" |

### Phase 3: Output Guards — LLM Presentation Layer ✅
| Item | Status | Notes |
|------|--------|-------|
| Binary guard (detect binary/garbled) | ✅ Done | `guardBinary()` — >10% non-printable = binary |
| Overflow truncation (200+ lines) | ✅ Done | `truncateOverflow()` with hints |
| stderr separation | ✅ Done | `extractStderr()` → `_stderr` field + MCP footer |
| Image data handling | ✅ Prior | `__image` extracted in toolDispatcher |

### Phase 4: Unix Semantics Enhancement ✅
| Item | Status | Notes |
|------|--------|-------|
| `;` operator (run regardless) | ✅ Done | Works in both plugin + MCP paths |
| `\|\|` operator (run on failure) | ✅ Done | Fallback pattern works |
| Pipe `\|` support | ✅ Done | Basic: grep results → cat/tree/ls path injection |
| Exit code per-command in chains | ✅ Done | Each command shows its own `[exit:N \| Xms]` |

### Phase 5: Progressive Discovery Polish ✅
| Item | Status | Notes |
|------|--------|-------|
| `run` with no command → overview | ✅ Done | Returns 9 commands + operators summary |
| Unknown command → closest match | ✅ Done | Prefix match + Levenshtein (adaptive threshold) |
| Tool description with exit code docs | ✅ Done | `run.ts` includes operator + exit code docs |

---

## Test Log

| Date | Test | Result | Notes |
|------|------|--------|-------|
| 2026-03-16 01:05 | Unit tests (exitCode) | ✅ 30/30 | computeExitCode, formatTiming, formatMeta, extractStderr, truncateOverflow, guardBinary |
| 2026-03-16 01:19 | Unit tests (commandParser) | ✅ 34/34 | Chain operators, mapToToolArgs, parseMkArgs, fuzzy matching |
| 2026-03-16 01:07 | MCP: ls / | ✅ | `[exit:0 \| 143ms]` |
| 2026-03-16 01:07 | MCP: ls /NonExistent/ | ✅ | `[exit:127 \| 27ms]` + stderr |
| 2026-03-16 01:07 | MCP: unknown command | ✅ | `[exit:127 \| 0ms]` |
| 2026-03-16 08:01 | MCP: fuzzy match "grp" | ✅ | `Did you mean "grep"?` |
| 2026-03-16 08:01 | MCP: fuzzy match "grepp" | ✅ | `Did you mean "grep"?` |
| 2026-03-16 08:01 | MCP: fuzzy match "lss" | ✅ | `Did you mean "ls"?` |
| 2026-03-16 08:02 | MCP: \|\| operator | ✅ | First fails → second runs |
| 2026-03-16 08:02 | MCP: ; operator | ✅ | Both run regardless |
| 2026-03-16 08:03 | MCP: batch mk | ✅ | 4 nodes created, `[exit:0 \| 204ms]` |
| 2026-03-16 08:03 | MCP: chain (tree && grep) | ✅ | Both `[exit:0]` |
| 2026-03-16 08:03 | MCP: sed | ✅ | `[exit:0 \| 41ms]` |
| 2026-03-16 08:04 | MCP: cp with violation | ✅ | `[warn]` stderr: children overflow |
| 2026-03-16 08:04 | MCP: quoted path with spaces | ✅ | `mk "/E2E Test/"` works |

> **Note**: "MCP" = MCP server 直接调用单个命令验证。"E2E" = dev bridge server 走完整 agent loop（trigger → agent → result）。

### Phase 6: Bug Fixes from E2E Testing
| Item | Status | Notes |
|------|--------|-------|
| mk batch trailing slash bug | ✅ Fixed | `/Card/Input` vs `/Card/Input/` mismatch → children at page root |
| `normalizePath()` utility | ✅ Done | Strips trailing slash (except root `/`) |
| `splitPath()` parentPath fix | ✅ Done | No longer adds trailing slash to parentPath |

### E2E Test Log
| Date | Test | Result | Notes |
|------|------|--------|-------|
| 2026-03-16 | E2E: login card (pre-fix) | ❌ | Placeholder/Label nodes orphaned to PAGE root |
| 2026-03-16 | E2E: login card (post-fix) | ✅ | All child nodes correctly parented |

## Key Files

- `src/engine/agent/tools/unified/exitCode.ts` — exit codes, timing, stderr, overflow, binary guard
- `src/engine/agent/tools/unified/run.ts` — tool description with exit code + operator docs
- `src/engine/agent/tools/unified/commandParser.ts` — chain parser (&&, ||, ;, |)
- `src/engine/agent/tools/unified/commandRegistry.ts` — fuzzy matching, help system
- `src/engine/agent/toolDispatcher.ts` — Layer 2 application for plugin agent path
- `tools/mcp-server/index.ts` — Layer 2 application for MCP path
- `src/engine/agent/__tests__/exitCode.test.ts` — 30 unit tests
- `src/engine/agent/__tests__/commandParser.test.ts` — 34 unit tests
