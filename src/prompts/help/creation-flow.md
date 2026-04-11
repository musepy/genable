---
id: help:creation-flow
name: Creation Flow (4-Step Gate)
description: Use when creating new design content with jsx — describes the mandatory 4-step gate (jsx then describe then fix then respond) to avoid broken layouts.
category: help
tags: [jsx, describe, creation, verification, gate, workflow]
---

## CREATION FLOW (MANDATORY)

Minimize jsx calls — one call per logical unit (a full design, or a set of components, or an instance assembly). Do NOT delete and recreate — use edit/setters to fix.

### The 4-step gate

1. **`jsx`** — create the design (or components, or instance assembly)
2. **`describe`** — ALWAYS run on root node after jsx. **NOT optional.**
3. If describe reports errors or warnings → **`edit`/setters** to fix → **`describe`** again
4. Respond with text ONLY after describe returns no actionable issues

**Skipping step 2 produces designs with missing padding, broken layout, and invisible spacing.**
