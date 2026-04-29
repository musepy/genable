---
name: create-page
description: Use when creating a new design from scratch on empty canvas — "design a", "make a", "做一个", "设计一个", "搞一个". Detects vague prompts and asks ONE multi-question form before generating; specific prompts proceed directly. Call FIRST before style/jsx.
---

# CREATE PAGE

You are starting a NEW design from scratch. Empty canvas, fresh creation. The user prompt is your only spec.

## Phase 1: Detect specificity (no tool calls — read the prompt)

A prompt is **SPECIFIC** when it contains explicit signals — not when you "infer" from the product type alone. Use this rule:

**SPECIFIC requires AT LEAST TWO of these signals:**

| Signal | What counts |
|--------|------------|
| **Aesthetic word** | "minimal", "neon-cyber", "brutalist", "pastel", "corporate", "warm", "playful", "dark", "developer terminal", or a named style ("notion-zen", "arctic-minimal") |
| **Content shape** | Explicit list of sections/elements: "with hero + 3 cards + pricing CTA", "email + password + social auth", "sidebar + 4 KPI cards + chart" |
| **Audience / context** | Explicitly named: "B2B", "consumer", "developer tool", "internal team", "for fintech", "enterprise" |

The product type alone (landing / dashboard / login) is **never enough** — those names span too many possible designs.

### SPECIFIC examples — skip Phase 2, go directly to Phase 3

- "Design a SaaS landing page, B2B, with hero + 3 feature cards + pricing CTA, modern minimal" — audience + content + aesthetic ✓
- "Create a dark-mode admin dashboard, sidebar nav, 4 KPI cards, line chart" — aesthetic + content ✓
- "Login screen using neon-cyber style with email + password + social auth" — aesthetic + content ✓

### VAGUE examples — go to Phase 2

- "做一个 landing page" — only product type
- "Design a dashboard" — only product type
- "Create a portfolio in minimal style" — aesthetic only, content shape missing
- "Build me a pricing page with 3 tiers" — content only, no aesthetic or audience

## Phase 2: ONE multi-question ask_user (vague prompts only)

Make ONE `ask_user` call with **2 bundled questions** in the `questions` array — audience + aesthetic together. The user fills both at once in a single form. Do NOT split into two turns.

Pick the right question pair for the product type:

| Product type | Q1 (header / question / options) | Q2 (header / question / options) |
|-------------|---------------------------------|---------------------------------|
| Landing | Audience: Who is this for? — B2B SaaS / Consumer / Personal portfolio / Product launch | Aesthetic: Visual direction? — Minimal / Bold / Pastel / Surprise me |
| Dashboard | Data type: What does it show? — Analytics / Admin tables / Monitoring / Personal | Aesthetic: Surface direction? — Light clean / Dark utility / Colorful / Surprise me |
| Login / Auth | Context: Brand feel? — Consumer (warm) / Enterprise (clean) / Developer (terminal) | Aesthetic: arctic-minimal / corporate-blue-light / neon-cyber / Surprise me |
| Form | Length: How long? — Short single-page / Multi-step wizard / Intake/application | Aesthetic: notion-zen / arctic-minimal / Bold / Surprise me |
| Pricing | Tier shape: Display? — 3-tier card / Comparison table / Single-CTA simple | Aesthetic: corporate-blue-light / minimal / bold / Surprise me |
| Portfolio | Owner: Whose work? — Designer / Developer / Photographer / Writer | Aesthetic: bold-editorial / arctic-minimal / cream-literary / Surprise me |

### Example call (Landing)

```
ask_user({ questions: [
  { header: "Audience", question: "Who is this for?", options: [
      { label: "B2B SaaS" },
      { label: "Consumer" },
      { label: "Personal portfolio" },
      { label: "Product launch" }
  ]},
  { header: "Aesthetic", question: "What visual direction?", options: [
      { label: "Minimal" },
      { label: "Bold" },
      { label: "Pastel" },
      { label: "Surprise me" }
  ]}
]})
```

### Parse the response

The tool returns ONE of two shapes:

**A. Form-submitted**: `{ answers: ["B2B SaaS", "Minimal"] }` — array indexed to questions order. Use both labels directly.

**B. Free-form text**: `{ freeText: "fintech B2B with magenta accent" }` — user typed in chat instead. **Authoritative — overrides any structured answer**. Parse intent:
- `"fintech B2B with magenta accent"` → audience=fintech B2B, aesthetic=custom magenta (closest preset: corporate-blue-light or invent)
- `"just make it pretty"` → user delegated; pick a sensible default for the product type
- `"like Stripe"` → reference-based; pick the style closest to Stripe (corporate-blue-light or arctic-minimal)
- `"random"` / `"surprise"` → pick anything reasonable yourself

**DO NOT call ask_user a second time.** If `freeText` is too vague to act on, default to a sensible match and proceed. The user can iterate after seeing the result.

## Phase 3: Build

### Step 1: Pick a style

When the user picked from options, use this audience → style mapping:

| Audience answer | Recommended styles |
|----------------|-------------------|
| B2B SaaS / Enterprise / clean / corporate / Internal team | corporate-blue-light, arctic-minimal, swiss-grid |
| Consumer / B2C / warm / Personal | warm-organic, cream-literary, candy-pastel |
| Developer tool / terminal / dark | neon-cyber, fintech-dark |
| Analytics / Admin / Monitoring data | slate-data, arctic-minimal, corporate-blue-light |
| Designer / Editorial / Photographer | bold-editorial, swiss-grid, cream-literary |
| Wellness / health / lifestyle | warm-organic, forest-calm, coral-commerce |
| Finance / fintech / banking | corporate-blue-light, fintech-dark, slate-data |

Pick exactly ONE style. If the user named a specific style ("neon-cyber"), use it directly without consulting the table.

Call `style({ name: "<picked>" })` to load full tokens.

### Step 2: Optional layout reference

Only for complex page types and only if the guideline exists in the menu:
- Landing → `guideline({ name: "landing-page" })`
- Dashboard → `guideline({ name: "dashboard" })`
- Form → `guideline({ name: "form" })`

If the menu has no matching guideline, skip — don't waste a call.

### Step 3: Generate

ONE `jsx({ markup })` call. One root frame containing the entire page. NOT phased section-by-section.

### Step 4: Verify

`get_screenshot({ node: "<root-id>" })` — visual sanity check.

### Step 5: Stop

Don't iterate unless the screenshot reveals a clear issue:
- Broken layout (overlapping elements, content cut off)
- Missing critical content the user explicitly named
- Wrong style applied (loaded the wrong tokens)

Polish is the user's NEXT turn, not yours. Don't pre-emptively rebuild because you "could do better".

## Anti-patterns

- ❌ **Multiple `ask_user` calls in sequence** — bundle into one `questions` array. Each call is a turn the user waits.
- ❌ **Counting dimensions** instead of matching signals — Phase 1 uses explicit "aesthetic word + content shape + audience" presence, not fuzzy counting.
- ❌ **Asking a second time when freeText was vague** — default to sensible and ship. User iterates after seeing the result.
- ❌ **Loading 3+ knowledge entries before generating** — pick max 2 (1 style + 0 or 1 guideline).
- ❌ **Building incrementally** with multiple `jsx` calls when one self-contained markup works.
- ❌ **Asking when the prompt is already specific** (per Phase 1 rule) — wastes a turn, signals you didn't read carefully.
- ❌ **Adding decorative `<group>` containers** around root content — flatten decorations as siblings (jsx group bug, see test #4 fallout).
- ❌ **Switching styles mid-build** (loaded style A, did jsx, then loaded style B and re-jsx) — picks happen ONCE in Step 1; if Step 4 reveals wrong style, that's a real issue worth fixing, but don't pre-doubt yourself.

## Call budget

- Vague path: ~5 calls (skill + ask_user + style + jsx + screenshot)
- Specific path: ~4 calls (skill + style + jsx + screenshot)
- +1 if guideline is loaded
- Hard cap: 8 calls. If you exceed without `jsx` having fired, you're stuck in clarification or over-research — commit and build with what you have.
