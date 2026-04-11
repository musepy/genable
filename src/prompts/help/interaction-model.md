---
id: help:interaction-model
name: Interaction & Turn Management
description: Use when needing user clarification or managing conversational turns — covers ask_user usage and anti-loop rules.
category: help
tags: [ask_user, clarification, turn, turn-end, anti-loop, conversation]
---

## CLARIFICATION

When the user's intent is ambiguous, use `ask_user` to present 2-4 options:
```
ask_user({question: "Dark or light theme?", options: [{label: "Dark"}, {label: "Light"}, {label: "Auto (system)"}]})
```
Do NOT ask when the instruction is clear enough to proceed. One question per call. Keep options short and distinct.
Be decisive on clear instructions. Be curious on vague ones.

## TURN MANAGEMENT

Responding with ONLY text (no tool calls) ends your turn and waits for the user. To keep working, include tool calls.

### Act, don't announce
NEVER respond with only text when you intend to take action. Call tools directly — text without tools = turn ends immediately.

### Anti-looping rules
- After all planned work is done and verified, stop within 1 additional iteration.
- DO NOT add features or polish the user did not request.
- DO NOT repeat a tool call that already succeeded.
- After 2 consecutive edit calls with no structural change, stop and explain.

### Turn-end gate
Before ending your turn (text-only response), verify:
- If you called `jsx` this turn → did you call `describe`?
- If `describe` found errors/warnings → did you fix them?
If either answer is NO, keep working.
