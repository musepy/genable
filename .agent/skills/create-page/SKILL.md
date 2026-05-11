---
name: create-page
description: 'Use when creating a new PAGE from scratch on empty canvas — multi-section page (landing/dashboard/login/form/pricing/portfolio/settings/profile/app screen). Triggers: "design a / make a / 做一个 / 设计一个" + a page-type word. NOT for atomic components (single card/button/input/badge/icon/widget) — those go directly to jsx without loading this skill.'
---

# CREATE PAGE

You are starting a NEW design from scratch. Empty canvas, fresh creation. The user prompt is your only spec.

## Phase 0: Is this actually a page? (no tool calls — gate check)

Load this skill ONLY if the prompt asks for a multi-section page or full screen. If it's an atomic component, **stop reading this skill and go straight to `jsx`** — the rest of this skill (Phase 1-3, audience questions, style picking) is page-scale workflow and will waste tokens + bias output.

| Pattern in prompt | Action |
|---|---|
| Names a page type (landing, dashboard, login, form, pricing, portfolio, settings page, profile page, app screen, home screen) | ✓ Continue to Phase 1 |
| Names a single component (card, button, input, badge, icon, toggle, dropdown, avatar, tag, widget) — even with detailed spec like "280x56 input box with gradient stroke" | ✗ Skip this skill, call `jsx` directly with the spec |
| Boundary cases (panel, dialog, modal, sidebar) — has multiple internal sections? | ✓ if multi-section / ✗ if single-purpose |

**Heuristic**: if you'd describe the deliverable as "a screen" → page (continue). If you'd describe it as "a component" → skip this skill.

If the user named a card/widget but the content list inside is page-sized (hero + 3 sections + footer + CTA), treat as page.

**Reference image attached?** If the user attached one or more screenshots/mockups as design intent, load `skill({name: 'vision-reference'})` BEFORE Phase 1 — that skill handles visual decode + self-diff and treats image-attached prompts as auto-SPECIFIC (skip Phase 2). It runs alongside this skill, not in place of it.

## Phase 1: Detect specificity (no tool calls — read the prompt)

A prompt is **SPECIFIC** when it contains explicit signals — not when you "infer" from the product type alone. Use this rule:

**SPECIFIC requires AT LEAST TWO of these signals:**

| Signal | What counts |
|--------|------------|
| **Aesthetic word** | "minimal", "neon-cyber", "brutalist", "pastel", "corporate", "warm", "playful", "dark", "developer terminal", or a named style ("notion-zen", "arctic-minimal") |
| **Content shape** | Explicit list of sections/elements: "with hero + 3 cards + pricing CTA", "email + password + social auth", "sidebar + 4 KPI cards + chart" |
| **Audience / context** | Explicitly named: "B2B", "consumer", "developer tool", "internal team", "for fintech", "enterprise" |

The product type alone (landing / dashboard / login) is **never enough** — those names span too many possible designs.

### SPECIFIC = enough info to proceed without basics — but STILL ask 1 differentiator question

SPECIFIC means you can skip the 2-question audience/aesthetic basics. It does **NOT** mean you know exactly what the user wants — generic words like "minimal" or "modern" still span dozens of distinct directions. **Always ask ONE differentiator question** in Phase 2 to pin down taste (hero treatment, story tone, color temperament, etc. — see Phase 2 differentiator menu).

VAGUE = missing audience or aesthetic entirely → ask the 2-question basics PLUS the differentiator (3 questions in one bundle).

### Examples

| Prompt | Classification | Phase 2 asks |
|---|---|---|
| Names a product type only ("做一个 landing page", "Design a dashboard") | VAGUE | basics + differentiator |
| Aesthetic only, content missing ("portfolio in minimal style") | VAGUE | basics + differentiator |
| Content only, no aesthetic ("pricing page with 3 tiers") | VAGUE | basics + differentiator |
| Has audience + aesthetic + content shape | SPECIFIC | differentiator only |
| Has detailed color palette + section list + viewport size + style references | SPECIFIC-COMPLETE | skip Phase 2 entirely, go to Phase 3 |

## Phase 2: ONE bundled `ask_user` (basics + differentiator)

Make ONE `ask_user` call. VAGUE → 3 questions (audience + aesthetic + differentiator). SPECIFIC → 1 question (differentiator only). NEVER split into multiple turns.

### Basics menu (VAGUE only)

| Product type | Q1 — Audience | Q2 — Aesthetic |
|-------------|---------------|---------------|
| Landing | B2B SaaS / Consumer / Personal portfolio / Product launch | Minimal / Bold / Pastel / Surprise me |
| Dashboard | Analytics / Admin tables / Monitoring / Personal | Light clean / Dark utility / Colorful / Surprise me |
| Login / Auth | Consumer (warm) / Enterprise (clean) / Developer (terminal) | arctic-minimal / corporate-blue-light / neon-cyber / Surprise me |
| Form | Short single-page / Multi-step wizard / Intake/application | notion-zen / arctic-minimal / Bold / Surprise me |
| Pricing | 3-tier card / Comparison table / Single-CTA simple | corporate-blue-light / minimal / bold / Surprise me |
| Portfolio | Designer / Developer / Photographer / Writer | bold-editorial / arctic-minimal / cream-literary / Surprise me |

### Differentiator menu (always asked)

This is what separates 5 generic landing pages from 5 distinct ones. Pick ONE differentiator question that fits the product type. Don't reuse the same one across runs — vary it.

| Product type | Differentiator options (pick one question, give 4 distinct options) |
|---|---|
| Landing | **Hero treatment**: Big text only / Product screenshot / Abstract illustration / Live demo embed — OR — **Story tone**: Speed (we ship fast) / Trust (proven scale) / Novelty (something new) / Craft (we obsess over details) — OR — **Section depth**: 3-section essential / 5-section standard / 8+ section deep-narrative |
| Dashboard | **Density**: Spacious overview / Information-dense / Mixed (KPI hero + dense tables) — OR — **Color load**: Mostly grayscale + 1 accent / Multi-color status semantic / Vibrant chart-first |
| Login | **Brand presence**: Logo only / Logo + tagline / Logo + product hero on left half / Pure form |
| Form | **Pace**: All visible at once / Sectioned with progress / Conversational one-question-per-screen |
| Pricing | **Anchor strategy**: Cheapest first / Recommended-tier highlighted / Enterprise-anchored (right) |
| Portfolio | **Index style**: Grid wall / Single-column case studies / Hero project + secondary grid |

### Example calls

**SPECIFIC** (skip basics, ask differentiator only):
```
ask_user({ questions: [
  { header: "Hero treatment", question: "How should the hero feel?", options: [
      { label: "Big text only — typography-driven" },
      { label: "Product screenshot dominant" },
      { label: "Abstract illustration / gradient" },
      { label: "Live demo embed" }
  ]}
]})
```

**VAGUE** (basics + differentiator, 3 questions in one form):
```
ask_user({ questions: [
  { header: "Audience", question: "Who is this for?", options: [...] },
  { header: "Aesthetic", question: "Visual direction?", options: [...] },
  { header: "Story tone", question: "What feeling should land first?", options: [
      { label: "Speed — we ship fast" },
      { label: "Trust — proven at scale" },
      { label: "Novelty — something new" },
      { label: "Craft — obsessive details" }
  ]}
]})
```

**SPECIFIC-COMPLETE** (prompt already includes color palette + sections + style refs): skip Phase 2 entirely, go to Phase 3.

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

### Step 1: Sketch a style — reference the library, OR invent your own

The style menu is **inspiration, not a cage**. You're free to:
- Pick one preset wholesale and use its tokens
- Mix elements from 1-2 presets (e.g. fintech-dark's surfaces + a custom accent)
- Invent your own from the user's prompt (no `style({...})` call needed)

`style({ name })` is a quick way to see one approach's color palette + typography + shape system. Read 0, 1, or 2 — whatever serves the design. Do NOT load 3+ "to compare" — that's how outputs collapse to whichever one is least surprising.

### Step 2: Commit decisions to your scratchpad — **REQUIRED before jsx**

Before generating, write your locked-in choices to the session scratchpad. This makes you commit explicitly (preventing "I read fintech-dark but used Tailwind indigo by reflex") and gives you a record to reference in later turns.

```
session_note({action: "write", key: "decisions", value: "
Style: <name or 'custom'>
Source: <style preset / mix / invented>
Accent: <hex> — reason
Surface: bg-page <hex>, bg-card <hex>
Text: primary <hex>, secondary <hex>
Type: display <font, size>, body <font, size>
Hero treatment: <split / vertical / big text / etc>
Sections: <list — don't reuse the canonical navbar→hero→features→cta sequence by default>
"})
```

Also write your `plan`:
```
session_note({action: "write", key: "plan", value: "
1. <step>
2. <step>
~<N> tool calls budget."})
```

If you're continuing an earlier turn, first `session_note({action: "read", key: "decisions"})` and `({action: "read", key: "todo"})` to load what's already committed — don't redecide what's already locked.

### Step 3: Layout reference (read for ideas, not for copy-paste)

Read the matching guideline if one exists. **Read it for the section menu and anti-patterns — DO NOT copy any XML skeleton verbatim.** The skeleton is a worst-case fallback when you have no other ideas; reusing it means every output looks identical.

- Landing → `guideline({ name: "landing-page" })`
- Dashboard → `guideline({ name: "dashboard" })`
- Form → `guideline({ name: "form" })`

### Step 4: Generate

ONE `jsx({ markup })` call. One root frame containing the entire page. NOT phased section-by-section. Use the colors / sizes / fonts you wrote into `decisions` — token traceability beats free-style invention.

### Step 5: Verify

`get_screenshot({ node: "<root-id>" })` — visual sanity check.

### Step 6: Update scratchpad before ending — **REQUIRED**

Before producing your final text reply, update the scratchpad with anything carryable:

```
session_note({action: "write", key: "todo", value: "
- <unfinished issue>
- <something to revisit next turn>
"})
```

If the screenshot revealed a clear issue you fixed in-turn, optionally update `decisions` with what changed. If nothing notable, write `todo` with "Hero shipped clean — no carry-over."

The runtime enforces this — if you try to end the turn without touching `session_note` it'll inject a reminder and rerun.

### Step 7: Stop

Don't iterate unless the screenshot reveals a clear issue:
- Broken layout (overlapping elements, content cut off)
- Missing critical content the user explicitly named
- Wrong style applied (loaded the wrong tokens)

Polish is the user's NEXT turn, not yours. Don't pre-emptively rebuild because you "could do better".

## Anti-patterns

- ❌ **Multiple `ask_user` calls in sequence** — bundle into one `questions` array.
- ❌ **Skipping Phase 2 entirely** because prompt is "SPECIFIC" — SPECIFIC still asks a differentiator. Only SPECIFIC-COMPLETE skips Phase 2.
- ❌ **Loading 3+ styles "to compare"** — read 0, 1, or 2. More than 2 is overhead, not insight.
- ❌ **Reading a style and then ignoring its tokens** — if you load fintech-dark, your accent should be fintech-dark's accent unless you write a reason in `decisions` for picking another. Don't default to Tailwind indigo `#6366F1` just because the prompt says "AI".
- ❌ **Skipping `session_note({action:"write", key:"decisions"})` before jsx** — the runtime will catch this and inject a reminder; doing it up front saves the round-trip.
- ❌ **Copying guideline XML skeleton verbatim** — guideline is for section menu + anti-patterns, not template paste.
- ❌ **Building incrementally** with multiple `jsx` calls when one self-contained markup works.
- ❌ **Adding decorative `<group>` containers** around root content — flatten decorations as siblings.
- ❌ **Switching styles mid-build** — Step 2's commit-to-`decisions` happens BEFORE jsx, not after.

## Call budget

- VAGUE path: ~6-8 calls (skill + ask_user + 0-2 style reads + session_note decisions + 1 guideline + jsx + screenshot + session_note todo)
- SPECIFIC path: ~5-7 calls (skill + ask_user differentiator + 0-2 style reads + session_note decisions + 1 guideline + jsx + screenshot + session_note todo)
- SPECIFIC-COMPLETE path: ~5 calls (skill + 0-1 style read + session_note decisions + 1 guideline + jsx + screenshot + session_note todo)
- `session_note` calls are cheap (in-memory) — don't budget-optimize them away.
- Soft cap: 12 calls before `jsx` fires. If you exceed, you're over-researching — commit and build.
