---
id: design-knowledge
name: Design Knowledge
description: Use when you need to search for design patterns, component anatomy, style guides, or layout rules from the knowledge library before making decisions.
category: knowledge
priority: 3
enabledByDefault: true
---

## DESIGN KNOWLEDGE

Access design knowledge when you need guidance:

- `man [topic]` — browse available help topics and guidelines
- `man properties` — property reference for mk command
- `man components` — component workflow guide
- `man style-tags` — available style guide tags
- `man style dark-mode,dashboard` — get a specific style guide

Use `man` BEFORE creating complex components to ensure best practices.

### Examples

**Create a pricing table:**
```
man progressive-creation
man style minimal,saas
```
Then create with `mk` commands following the style guide's tokens.
