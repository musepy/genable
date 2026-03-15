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

### Phase 2: Error Messages — Actionable Guidance
| Item | Status | Notes |
|------|--------|-------|
| Unknown command → suggest similar | 🔴 TODO | `exit:127` + "Did you mean X?" |
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

### Phase 4: Unix Semantics Enhancement
| Item | Status | Notes |
|------|--------|-------|
| Pipe `\|` support | 🔴 TODO | stdout → stdin, e.g. `grep Button \| cat` |
| `;` operator (run regardless) | 🔴 TODO | Only `&&` currently |
| `\|\|` operator (run on failure) | 🔴 TODO | |
| Exit code propagation in chains | 🟡 Partial | exit code per-command in MCP, not aggregated |

### Phase 5: Progressive Discovery Polish
| Item | Status | Notes |
|------|--------|-------|
| `run` with no command → overview | 🟡 Partial | Returns error, not help |
| Unknown command → closest match | 🔴 TODO | Levenshtein/fuzzy |
| Command aliases (e.g. `ll` → `ls -l`) | 🔴 TODO | |

---

## Test Log

| Date | Test | Result | Notes |
|------|------|--------|-------|
| 2026-03-16 01:05 | Unit tests (exitCode) | ✅ 30/30 | computeExitCode, formatTiming, formatMeta, extractStderr, truncateOverflow, guardBinary |
| 2026-03-16 01:07 | MCP ls / | ✅ | `[exit:0 \| 143ms]` |
| 2026-03-16 01:07 | MCP ls /NonExistent/ | ✅ | `[exit:127 \| 27ms]` + stderr |
| 2026-03-16 01:07 | MCP unknown command | ✅ | `[exit:127 \| 0ms]` |
| 2026-03-16 01:08 | MCP mk create | ✅ | `[exit:0 \| 146ms]` |
| 2026-03-16 01:08 | MCP chain (tree && cat) | ✅ | Both `[exit:0]`, per-command metadata |
| 2026-03-16 01:08 | MCP chain error (fail && skip) | ✅ | First `[exit:127]`, second skipped |
| 2026-03-16 01:09 | MCP grep (node + props) | ✅ | `[exit:0 \| 358ms]` / `[exit:0 \| 27ms]` |
| 2026-03-16 01:09 | MCP sed | ✅ | `[exit:0 \| 34ms]` |
| 2026-03-16 01:09 | MCP rm | ✅ | `[exit:0 \| 42ms]` |
| 2026-03-16 01:09 | MCP help mode (mk) | ✅ | Returns usage text |
| 2026-03-16 01:09 | MCP man | ✅ | `[exit:0 \| 4ms]` |

## Key Files

- `src/engine/agent/tools/unified/exitCode.ts` — exit codes, timing, stderr, overflow, binary guard
- `src/engine/agent/tools/unified/run.ts` — tool description with exit code docs
- `src/engine/agent/toolDispatcher.ts` — applies Layer 2 to plugin agent path
- `tools/mcp-server/index.ts` — applies Layer 2 to MCP path
- `src/engine/agent/__tests__/exitCode.test.ts` — 30 unit tests
