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
ask_user({ questions: [
  {
    header: "Aesthetic",
    question: "What aesthetic fits this settings page?",
    options: [
      {label: "notion-zen", description: "Calm productivity"},
      {label: "arctic-minimal", description: "Clean utility"},
      {label: "corporate-blue-light", description: "Enterprise SaaS"},
      {label: "Surprise me"},
    ],
  }
]})
```

If you also need audience or content scope, bundle them as additional questions in the same call — don't split into separate turns:

```
ask_user({ questions: [
  { header: "Audience", question: "Who is this for?", options: [{label:"Internal team"},{label:"Customer-facing"},{label:"Developer tools"}] },
  { header: "Aesthetic", question: "What visual direction?", options: [{label:"notion-zen"},{label:"arctic-minimal"},{label:"corporate-blue-light"},{label:"Surprise me"}] },
]})
```

### After the user picks

Parse the response. If it's `{ answers: [...] }`, the chosen label for the aesthetic question is your style name. If it's `{ freeText: "..." }`, the user described their own — use that as your style intent.

Call `style({ name: "<chosen>" })` to load the full style guide — color tokens, typography, spacing, shape — before generating `jsx`. The menu shows only the name; the full content is what you need.

If the user picked "Surprise me", choose any reasonable style yourself based on the product type and proceed.
