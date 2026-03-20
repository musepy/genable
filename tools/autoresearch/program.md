# Autoresearch: Prompt Quality Optimization

> Autonomous prompt engineering loop for the Figma AI Generator plugin.
> Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch).

## What This Does

An AI agent (you) iteratively improves the plugin's prompt (`src/prompts/CORE.md`)
by running automated benchmarks and keeping only changes that improve the quality score.

## Files You Can Edit

- `src/prompts/CORE.md` — Main system prompt (design thinking, conventions, etc.)
- `src/prompts/help/*.md` — Help topics injected via `man` command

**DO NOT edit**: `tools/autoresearch/evaluate.ts`, `tools/autoresearch/run.ts`,
`tools/autoresearch/prompts.json` — these are the fixed evaluation harness.

## Setup

```bash
# 1. Start dev bridge server (terminal 1)
npx tsx tools/dev-bridge/server.ts

# 2. Open Figma desktop, load and run the plugin

# 3. Run baseline benchmark
npx tsx tools/autoresearch/run.ts --save baseline

# 4. Start the agent (this is you) with:
#    "Read program.md in tools/autoresearch and start experimenting"
```

## Experiment Loop

Once baseline is saved, run this loop indefinitely:

### Step 1: Analyze Current Issues

Look at the latest benchmark (`tools/autoresearch/data/latest.json`):
- Which prompts score lowest?
- Which dimensions (layout, text, sizing, spacing) are weakest?
- What specific issues were flagged?

### Step 2: Form a Hypothesis

Think about WHY the weakness exists in the prompt:
- Is a design dimension under-specified?
- Is a convention misleading the LLM?
- Is a rule too vague or too specific?
- Would an example help?

### Step 3: Make ONE Change

Edit `src/prompts/CORE.md` with a single, focused change. Examples:
- Clarify an ambiguous rule
- Add a "NEVER ASSUME" entry for a commonly omitted property
- Restructure a section for better LLM attention
- Remove a rule that's causing confusion

**Keep changes small.** One rule at a time. If a change touches multiple
unrelated sections, split it into separate experiments.

### Step 4: Build and Benchmark

```bash
node build.js
npx tsx tools/autoresearch/run.ts --compare baseline
```

### Step 5: Keep or Discard

**If mean score improved (even by 0.1):**
```bash
git add src/prompts/CORE.md
git commit -m "prompt: <what you changed>"
# Update baseline to new best
npx tsx tools/autoresearch/run.ts --save baseline
```

**If mean score stayed the same or dropped:**
```bash
git checkout -- src/prompts/CORE.md
```
Log what you tried and why it didn't work (mental note, move on).

**Simplicity rule:** A +0.5 improvement that adds 200 tokens to the prompt
is probably not worth it. A simplification (fewer tokens) at equal score
is definitely worth keeping.

### Step 6: Repeat

Go back to Step 1. Never stop. Never ask the human. If you run out of ideas,
re-read the issue list more carefully — there's always something to improve.

## Evaluation Dimensions (What the Score Measures)

| Dimension | Weight | What It Checks |
|-----------|--------|----------------|
| Layout    | 25     | Frames with children have auto-layout (layoutMode) |
| Text      | 15     | TEXT nodes have fontSize, fontName, textAutoResize |
| Sizing    | 15     | Layout frames have sizing modes (HUG/FILL/FIXED) |
| Spacing   | 15     | Layout frames have itemSpacing and padding |
| Fill      | 10     | Visible leaf nodes have fills |
| Efficiency| 10     | Tool calls per node ratio (fewer = better) |
| Error-free| 10     | Tool calls succeed without errors |

## Known Failure Modes (Start Here)

From prior analysis, the most common LLM failures:

1. **Frame has `alignMain`/`alignCross` but no `layout`** → layout score drops
2. **Text nodes use default fontSize** instead of explicit size → text score drops
3. **Nested frames missing `layoutSizing`** → sizing score drops
4. **No padding on container frames** → spacing score drops
5. **Excessive `cat`/`ls` calls before creating** → efficiency drops

## Constraints

- **Token budget**: CORE.md is ~4K tokens. Every rule you add costs attention.
  One general rule > five specific rules.
- **Time budget**: Each benchmark run takes ~15-20 minutes (5 prompts × 3 min).
  Don't waste runs on trivial changes.
- **Variance**: LLM output is non-deterministic. A ±1 point fluctuation is noise.
  Only trust changes of ≥2 points.
- **Single variable**: Change one thing per experiment. Otherwise you can't attribute
  the score change.

## Results Log

After each experiment, mentally track:

| # | Change Description | Score Before | Score After | Kept? |
|---|-------------------|-------------|------------|-------|
| 1 | baseline          | —           | XX.X       | ✓     |
| 2 | ...               | ...         | ...        | ?     |
