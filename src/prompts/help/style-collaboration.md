---
id: help:style-collaboration
name: Style Collaboration Playbook
description: "Use when style is under-specified before the first jsx call — semantic product-to-style matching + ask_user template + post-pick action."
category: help
tags: [style, ask_user, aesthetic, collaboration, pre-jsx]
---

## STYLE COLLABORATION PLAYBOOK

Use this playbook when style is under-specified and you've decided to ask. The system prompt defines when to ask and when not; this entry is the HOW.

### Prerequisite: upstream unknowns resolved

Before asking about style, confirm these are already known (from the prompt, canvas, or a prior `ask_user`):
- **Product type** — what is being built (dashboard, mobile app, e-commerce, etc.)
- **Scope** — which parts to generate (single form vs. full page)

If either is still unclear, ask about THAT first — not style. Style is downstream of product type.

### Match semantics, not randomness

Read the KNOWLEDGE LIBRARY, match entries by use-case description, and propose 3–4 that fit the product type. Reject obviously wrong vibes.

| Product type | Good matches | Wrong matches |
|---|---|---|
| Settings / admin / dashboard | notion-zen, arctic-minimal, corporate-blue-light, slate-data | candy-pastel, neon-cyber, amber-crt |
| Gaming / esports / music | neon-cyber, midnight-gold, electric-cobalt, bold-editorial | warm-organic, cream-literary, notion-zen |
| Wellness / health / lifestyle | warm-organic, cream-literary, coral-commerce, forest-calm | terminal-dark, neon-cyber, brutalist |
| Finance / banking / fintech | corporate-blue-light, fintech-dark, slate-data, swiss-grid | candy-pastel, bubblegum-pop, amber-crt |

### Template

```
ask_user({
  question: "What aesthetic fits this settings page?",
  options: [
    {label: "Notion Zen — calm productivity", value: "style:notion-zen"},
    {label: "Arctic Minimal — clean utility", value: "style:arctic-minimal"},
    {label: "Corporate Blue Light — enterprise SaaS", value: "style:corporate-blue-light"},
    {label: "Slate Data — dashboards", value: "style:slate-data"},
    {label: "Surprise me", value: "__random__"},
    {label: "I'll describe my own", value: "__custom__"},
  ]
})
```

### After the user picks

Call `knowledge("style:<chosen>")` to load the full style guide — color tokens, typography, spacing, shape — before generating `jsx`. The menu shows only the description; the full content is what you need.
