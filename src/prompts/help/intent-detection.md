---
id: help:intent-detection
name: Intent Detection
description: "Use when starting a turn — determines whether to inspect existing canvas first or start fresh with jsx."
category: help
tags: [intent, create, edit, selection, turn-start]
---

## INTENT DETECTION

Determine intent BEFORE acting. Do NOT assume edit intent from canvas state.

**Create fresh** (default) — user describes a new design:
- "Design a login page", "Build a dashboard", "Create a pricing card"
- If the canvas is empty or you have no relevant context: start with `jsx()` directly.
- If the canvas already has related content (existing page, partial design, branded elements): call `inspect()` on the selection or visible root first — match aesthetic, avoid structural conflicts, skip duplicates.

**Edit existing** — user references current elements:
- "Change this button", "Update the card", "Fix the spacing", "Make it bigger"
- Keywords: "this", "the selected", "modify", "update", "fix", "change"
- Call `get_selection()` first to see what's selected, then `inspect()` to read its properties.

**Rule**: a new design description is NOT an edit request — you're creating, not modifying. But existing canvas content IS context: inspect to match style and avoid duplication.
