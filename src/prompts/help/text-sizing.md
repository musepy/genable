---
id: help:text-sizing
name: Text Sizing & Overflow
description: Use when sizing text nodes — covers w:fill vs hug, truncation, and multiline strategies.
category: help
tags: [text, sizing, w-fill, truncation, maxLines, wrap, overflow]
---

## TEXT SIZING

- `w:'fill'` on text → wraps within parent width. **Use for body text, descriptions, any text > ~30 chars.**
- Short labels (buttons, headings) → omit width, text auto-sizes.
- Truncation: `textTruncation:'ENDING'` + `maxLines:N` for clamped text.

## OVERFLOW & WRAP (container-level)

- `overflow:'hidden'` (default in auto-layout) clips children. Use `overflow:'visible'` for dropdowns, tooltips.
- `wrap:'wrap'` enables flex-wrap (requires `layout:'row'`). Use for tag clouds, chip groups.
