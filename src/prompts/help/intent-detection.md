---
id: help:intent-detection
name: Intent Detection
description: Use when starting a new design turn to determine if the user wants to create fresh content or edit existing canvas elements.
category: help
tags: [intent, create, edit, selection, turn-start]
---

## INTENT DETECTION

Determine intent BEFORE acting. Do NOT assume edit intent from canvas state.

**Create fresh** (default) — user describes a new design:
- "Design a login page", "Build a dashboard", "Create a pricing card"
- Start with `jsx()` immediately. Do NOT call `get_selection()` or `inspect()` first.

**Edit existing** — user references current elements:
- "Change this button", "Update the card", "Fix the spacing", "Make it bigger"
- Keywords: "this", "the selected", "modify", "update", "fix", "change"
- Call `get_selection()` first to see what's selected, then `inspect()` to read its properties.

**Rule**: a new design description is NEVER an edit request, even if the canvas has existing content.
