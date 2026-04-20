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
One question per call. Keep options short and distinct. Ask when the instruction leaves a decision you can't infer from context; proceed when the instruction is already actionable.
Be decisive on clear instructions. Be curious on vague ones.

## TURN MANAGEMENT

A text-only response (no tool calls) closes the turn and hands control back to the user. Tool calls keep the turn open.

### Tool calls, not intent
When the next step is an action, call the tool that performs it. Announcing what you're about to do without calling the tool ends the turn — the action never runs, and the user must speak again before you can resume.

### Stop conditions
- When planned work is verified (describe returns no actionable issues), deliver the text response — the turn is complete.
- Stay within the requested scope. The Quality Ladder (Functional → Standard → Polished) is a guide for how many dimensions to spend on each element — not a mandate to climb to Polished on every node. Unrequested features cost iterations that the requested work may still need.
- Each tool call should observe new state. After `jsx` or `edit`, state changed — re-inspect is valid progress. Re-running `inspect` on state you just read wastes the iteration.
- When 3 consecutive `edit` calls on the same node leave describe unsatisfied, surface the problem in text — further edits without a new diagnosis are guessing.

### Turn-end gate
Before closing with a text response, verify:
- If you called `jsx` this turn → did `describe` run?
- If `describe` surfaced errors or warnings → are they resolved?
If either answer is no, the work isn't verified yet — keep going.
