---
id: help:interaction-model
name: Interaction & Turn Management
description: Use when needing user clarification or managing conversational turns — covers ask_user usage and anti-loop rules.
category: help
tags: [ask_user, clarification, turn, turn-end, anti-loop, conversation]
---

## CLARIFICATION — DEDUCE BEFORE ASKING

When the user's instruction is vague, **deduce first, ask second**.

### Deduction chain (follow in order)
1. **Mine context** — read the canvas (`inspect`), check previous turns, look for clues in the prompt. Often the product type, layout intent, or style is already implied.
2. **Infer what you can** — if the user says "add a settings page," the product type is clear even without an explicit style. Proceed with a sensible default or narrow the question.
3. **Ask only what you can't infer** — one targeted question at a time. Ask about the **most upstream unknown** first (WHAT before HOW, purpose before aesthetic).

### Ask priority (upstream → downstream)
| Priority | Unknown | Example question |
|---|---|---|
| 1 | **Purpose / product type** | "What kind of product is this — a dashboard, a mobile app, an e-commerce site?" |
| 2 | **Scope / content** | "Should this include just the form, or the full page with nav and footer?" |
| 3 | **Aesthetic / style** | "What aesthetic fits this settings page?" (with semantic-matched options) |

Never jump to priority 3 when priority 1 is still unclear. Each answer narrows the next question.

### Format
```
ask_user({question: "Dark or light theme?", options: [{label: "Dark"}, {label: "Light"}, {label: "Auto (system)"}]})
```
One question per call. Keep options short and distinct. Do NOT ask when the instruction is clear enough to proceed.
Be decisive on clear instructions. Be curious on vague ones.

## TURN MANAGEMENT

Responding with ONLY text (no tool calls) ends your turn and waits for the user. To keep working, include tool calls.

### Act, don't announce
NEVER respond with only text when you intend to take action. Call tools directly — text without tools = turn ends immediately.

### Anti-looping rules
- After all planned work is done and verified (describe returns no actionable issues), deliver your text response.
- DO NOT add unrequested features or decorative polish. Quality Ladder (Functional→Standard→Polished) is a guide for what to include per dimension, not an instruction to always hit Polished.
- DO NOT repeat a tool call on unchanged state — if you just called inspect and nothing has changed since, don't call it again. After jsx or edit, the state HAS changed: inspect again is valid progress, not repetition.
- After 3 consecutive edit calls on the same node with no describe-confirmed improvement, stop and explain.

### Turn-end gate
Before ending your turn (text-only response), verify:
- If you called `jsx` this turn → did you call `describe`?
- If `describe` found errors/warnings → did you fix them?
If either answer is NO, keep working.
