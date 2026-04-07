---
name: cross-editor-feedback-audit
description: Systematically audit feedback from external AI agents (OpenCode, Cursor, etc.) that use genable tools — fact-check claims, classify issues, and fix in priority order
trigger: (feedback from opencode|agent report|tool usage report|cross-editor feedback|audit agent feedback|opencode feedback|cursor feedback)
---

# Cross-Editor Feedback Audit

When an external agent (OpenCode, Cursor, etc.) reports issues using genable tools, do NOT immediately act on raw claims. Agent feedback conflates tool bugs, protocol issues, and agent misuse. Fact-check first.

## Step 1 — Collect the Report

Ask for or read the full structured report. Extract each individual claim as a separate item. One claim = one investigation thread.

## Step 2 — Fact-Check Each Claim Against Code

For every claim:
1. Read the relevant tool definition (`src/engine/agent/tools/unified/<tool>.ts`)
2. Read the IPC handler (`src/ipc/commands/<tool>Handler.ts`)
3. Check the actual Figma API behavior (async vs sync, sandboxing constraints)
4. Determine if the symptom matches the claimed cause

**Do not assume the agent correctly diagnosed the root cause.** Agents frequently misattribute failures.

## Step 3 — Classify Each Issue

| Class | Definition | Action |
|-------|-----------|--------|
| **Tool gap** | Capability genuinely missing from the tool | Add feature/tool |
| **Silent failure** | API write succeeds but change doesn't take effect in Figma | Add write verifier or return confirmation data |
| **Protocol issue** | HTTP bridge, IPC routing, or connection problem | Fix bridge/relay layer |
| **Agent misuse** | Wrong API usage — sync in async context, wrong param format | Improve error message or add param validation |
| **Working as designed** | Behavior is correct, agent misunderstood the contract | Document, no code change |

## Step 4 — Fix in Priority Order

1. **Tool gaps** — missing capability blocks the agent entirely
2. **Silent failures** — most dangerous: agent thinks it succeeded, design is wrong
3. **Protocol issues** — affects all tools, not just one
4. **Error messages** — improves future agent interactions, low urgency

Skip classes that don't apply. Don't gold-plate.

## Step 5 — Verify Each Fix

Before committing:
```bash
node build.js
curl -X POST http://localhost:3456/trigger \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test the specific tool that was reported broken"}'
# Then SSE stream to watch result:
curl -N http://localhost:3456/stream/<id>
```

Each fix must be independently verified via E2E. Don't batch unverified fixes.

## Common Misattribution Patterns

| Agent claim | Actual cause | Fix |
|-------------|-------------|-----|
| "Instance override unreliable" | Silent failure — Figma write succeeds but component reset on next render | Add writeVerifier to confirm property stuck |
| "getNodeById doesn't work" | Agent used sync API in async context (`dynamic-page` mode forbids sync) | Error message already in error-catalog; ensure handler uses `getNodeByIdAsync` |
| "clone_node can't clone to root" | Real tool gap — adapter didn't support `null` parent (root canvas) | Fix adapter to handle `parent: null` → `figma.currentPage` |
| "HTTP bridge dropped my request" | Wrong attribution — bridge received it, tool-level crash swallowed it | Check bridge logs first, then tool handler |
| "Tool returned success but nothing changed" | Silent failure in Figma executor — no confirmation data returned | Return node state after write, not just `{ok: true}` |

## Anti-Patterns

- **Don't fix based on the claim alone** — always read the code first
- **Don't attribute to the bridge what is a tool bug** — bridge logs show receipt, tool logs show execution
- **Don't add error messages for misuse without checking if validation is missing** — if the tool accepts invalid params silently, add param validation, not just docs
- **Don't skip E2E** — type-check pass does not mean the Figma API call works in practice
