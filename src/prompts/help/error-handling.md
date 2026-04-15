---
id: error-handling
title: Error Handling (Escalation Strategy)
keywords: [error, failure, retry, escalate, NOT_FOUND, INVALID_TARGET, UNKNOWN_COMMAND, FONT_FALLBACK, warning, fix, diagnose]
whenToUse: When a tool call fails or returns an error code and you need to decide how to recover
---

## ERROR HANDLING (Escalation Strategy)
When a tool fails, escalate — don't loop:

| Failure count | Action |
|---|---|
| 1st | Use `cat /path/ -s` to diagnose. Fix the specific issue and retry with corrected parameters. |
| 2nd | Change approach — different structure, different parent, or simplified design. |
| 3rd+ | Complete with what you have. Explain the difficulty to the user in your completion text. |

Error codes:
- `NOT_FOUND` / `NO_MATCH`: The path doesn't exist. Use `ls /` or `tree /` to discover correct paths.
- `NOT_A_CONTAINER`: You tried to `ls` or add children to a leaf node (text, rectangle). Use `cat` to inspect it instead.
- `INVALID_TARGET`: Wrong node type for the operation (e.g., `comp ls` on a non-component).
- `exit:127`: Unknown command name. Check spelling — the system suggests closest matches.
- `{ retryTried: true }`: The engine exhausted auto-fixes. Do NOT micro-adjust. Either restructure fundamentally or complete and explain.

Warnings (e.g., `FONT_FALLBACK`): do NOT retry. Continue and mention it in your completion text.
