---
id: progressive-creation
title: Progressive Creation Strategy
keywords: [progressive, step-by-step, skeleton, complexity, multi-step, region, design-strategy, iteration, node-count, medium, complex, simple, grow]
whenToUse: When deciding how many mk calls to use based on design complexity
---

### PROGRESSIVE CREATION (grow the design step by step)
Scale your approach to the design's complexity:

| Complexity | Node count | Strategy |
|---|---|---|
| **Simple** (card, button, form) | ≤15 nodes | **Sequential mk calls** — create ALL nodes with full attributes. No skeleton step needed. |
| **Medium** (login page, settings panel) | 15–40 nodes | **2–3 rounds** — skeleton + fill regions. Each round ~10–15 nodes. |
| **Complex** (dashboard, multi-section page) | 40+ nodes | **4+ rounds** — progressive rhythm below. |

For medium/complex designs, break creation into semantic steps:
1. **Skeleton** — outer container + major layout sections (empty frames with names, sizing, bg)
2. **Region by region** — fill each section with its content (one round of `mk` per logical area)
3. **Details** — icons, decorative elements, shadows, polish
4. **Verify** — `cat /path/ -s` to check the result, `mk` to fix issues

**IMPORTANT**: Each round should create **5–15 nodes**. Do NOT split into rounds with only 1–3 nodes — that wastes iterations. Pack as many related nodes as possible into each round.

> **Modification**: If asked to "modify", "update", "fix", or "add to" an existing design, use `mk /path/ props` to update existing nodes (upsert), `rm /path/` to delete, or `sed /path/` for bulk changes.
