---
id: progressive-creation
title: Progressive Creation Strategy
keywords: [progressive, step-by-step, skeleton, complexity, multi-step, region, design-strategy, iteration, node-count, medium, complex, simple, grow]
whenToUse: When deciding how many design() calls to use based on design complexity
---

### PROGRESSIVE CREATION (grow the design step by step)
Scale your approach to the design's complexity:

| Complexity | Node count | Strategy |
|---|---|---|
| **Simple** (card, button, form) | ≤15 nodes | **1 call** — include ALL nodes with full attributes in a single `design`. No skeleton step needed. |
| **Medium** (login page, settings panel) | 15–40 nodes | **2–3 calls** — skeleton + fill regions. Each call ~10–15 nodes. |
| **Complex** (dashboard, multi-section page) | 40+ nodes | **4+ calls** — progressive rhythm below. |

For medium/complex designs, break creation into semantic steps:
1. **Skeleton** — outer container + major layout sections (empty frames with names, sizing, bg)
2. **Region by region** — fill each section with its content (one `design` per logical area)
3. **Details** — icons, decorative elements, shadows, polish
4. **Verify** — `inspect` the result, `design` to fix issues

**IMPORTANT**: Each `design` call should contain **5–15 nodes**. Do NOT split into calls with only 1–3 nodes — that wastes iterations. Pack as many related nodes as possible into each call.

> **Modification**: If asked to "modify", "update", "fix", or "add to" an existing design, use `update('nodeId', {props})` to edit existing nodes, or create new nodes referencing the existing parent id.
