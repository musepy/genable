---
id: help:layout-quality
name: Layout Quality Patterns
description: Use when fixing common layout failures — toggle rows, sibling cards, space-between patterns, and explicit gap rules.
category: help
tags: [layout, quality, space-between, gap, sibling-cards, toggle-row, patterns]
---

## LAYOUT QUALITY PATTERNS

These are the most common quality failures. Follow these patterns to avoid them.

1. **Label + Control rows** (toggle, checkbox, input with label): layout:row, label w:fill, control fixed width.
   - GOOD: `<frame layout="row" w="fill" gap={16}><frame name="Label" w="fill">...</frame><frame name="Toggle" w={52}>...</frame></frame>`
   - BAD: both children hug = control won't right-align

2. **Flex containers with 3+ children**: ALWAYS set explicit gap.
   - Page-level sections: gap={32} or gap={24}
   - Card internals: gap={16} or gap={12}
   - Tight groups (label + sublabel): gap={4}

3. **space-between pattern**: Make at least one child `w="fill"` to push siblings apart.
   - Toggle row: `<frame layout="row" w="fill"><frame name="Label" w="fill">...</frame><frame name="Toggle" w={52}/></frame>`
   - Card with CTA at bottom: `<frame layout="column" h="fill"><frame name="Content" h="fill">...</frame><frame name="CTA" w="fill"/></frame>`

4. **Sibling cards in a row**: Each card `w="fill"`, NOT fixed pixel width. Use `h="fill"` for equal heights.
   - GOOD: `<frame layout="row" gap={24} w="fill"><frame name="Card1" w="fill">...</frame><frame name="Card2" w="fill">...</frame></frame>`
   - BAD: `<frame layout="row" gap={24} w="fill"><frame name="Card1" w={320}>...</frame><frame name="Card2" w={320}>...</frame></frame>`
