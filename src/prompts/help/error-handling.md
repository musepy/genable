---
id: error-handling
title: Error Handling (Escalation Strategy)
keywords: [error, failure, retry, escalate, TOOL_VALIDATION_ERROR, PARENT_NOT_FOUND, NODE_NOT_FOUND, UNKNOWN_TOOL, retryTried, FONT_FALLBACK, warning, fix, diagnose]
whenToUse: When a tool call fails or returns an error code and you need to decide how to recover
---

## ERROR HANDLING (Escalation Strategy)
When a tool fails, escalate — don't loop:

| Failure count | Action |
|---|---|
| 1st | Call `inspect` to diagnose. Fix the specific issue and retry with corrected parameters. |
| 2nd | Change approach — different structure, different parent, or simplified design. |
| 3rd+ | Complete with what you have. Explain the difficulty to the user in your completion text. |

Error codes:
- `TOOL_VALIDATION_ERROR` / `missing required parameter(s): ops`: You called `design` without the ops parameter. Your operations MUST go inside `design({"ops": "..."})`, NOT in your text response.
- `PARENT_NOT_FOUND`: Create or resolve the parent first (use `outline` and correct `parentId`).
- `NODE_NOT_FOUND`: Refresh IDs with `outline`.
- `UNKNOWN_TOOL`: Use only currently available unified tools.
- `{ retryTried: true }`: The engine exhausted auto-fixes. Do NOT micro-adjust. Either restructure fundamentally or complete and explain.

Warnings (e.g., `FONT_FALLBACK`): do NOT retry. Continue and mention it in your completion text.
