---
name: prompt-benchmark
description: |
  Automated prompt quality benchmarking following Karpathy's autoresearch methodology.
  Evaluates LLM prompt changes against a fixed harness, uses Codex for independent review,
  and produces data-driven conclusions about attribute omission patterns.
  Trigger: "benchmark prompt", "evaluate prompt quality", "test prompt changes",
  "autoresearch", "属性遗漏分析", "prompt 质量测试"
---

# Prompt Benchmark — Autoresearch for Prompt Engineering

Systematic methodology for evaluating and improving LLM prompts through automated benchmarking.
Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch):
human writes the "program" (evaluation harness), AI iterates on the "training code" (prompt).

## Core Principles

### 1. Evaluation harness is sacred — fix it first

Before running ANY prompt experiment:
- Verify the evaluation function measures what it claims
- Run a known-good result through the evaluator and check scores match human judgment
- If a metric reads 0% but the design looks fine → **evaluator bug, not prompt bug**
- Only lock the harness and begin experiments once scores are trustworthy

**Anti-pattern**: Running 10 experiments on a broken evaluator. All results are garbage.

### 2. Single variable per experiment

- Change ONE thing in the prompt per experiment
- Build → benchmark → compare to baseline
- Improved ≥2 points → keep (commit + update baseline)
- Within ±1 point → noise, discard
- Degraded → revert immediately

**Anti-pattern**: Changing 3 rules at once. Score improves but you can't attribute why.

### 3. Observe before modifying

Before changing any prompt:
- Analyze actual LLM tool call logs (toolCallDetails)
- Read the batch mk parameters to see what the LLM actually outputs
- Identify the REAL failure mode from data, not assumptions

**Anti-pattern**: Assuming "spacing is bad" → adding a rule → making things worse.
The fix at "never assume defaults" level, not per-symptom rules.

### 4. Simplification > addition

A prompt change that REMOVES tokens at equal score is always worth keeping.
A prompt change that ADDS tokens for +0.5 improvement is probably not worth it.
Token budget is finite. One general rule > five specific rules.

**Anti-pattern**: Seeing a specific bug → writing a specific rule → fixing one case but hurting others.

## Methodology

### Phase 1: Build / Verify Evaluation Harness

**Tools**: `tools/autoresearch/evaluate.ts`, `tools/autoresearch/run.ts`, `tools/autoresearch/prompts.json`

1. Define test prompts in `prompts.json` covering different design types
2. Define quality dimensions with weights (structural > operational)
3. Run evaluator on a known result, verify scores match human judgment
4. Fix any evaluator bugs found
5. Lock the harness — DO NOT change it during experiments

**Key lesson from this project**:
- Icon leaf frames (lucide:*) don't need layoutMode or visible fills — evaluator was penalizing them incorrectly
- Canvas accumulates nodes across runs — evaluator must isolate to current run's nodes
- When tree.json serialization fails, fall back to reconstructing nodes from mk tool call parameters
- Separate design quality score from execution efficiency score (Codex's recommendation)

### Phase 2: Establish Baseline

```bash
npx tsx tools/autoresearch/run.ts --save baseline
```

Requirements:
- Dev bridge server running (`npx tsx tools/dev-bridge/server.ts`)
- Figma desktop with plugin loaded and connected
- Clean canvas (or evaluator must filter by rootNodeIds)

### Phase 3: Data-Driven Analysis

Before changing the prompt, extract quantitative patterns from existing data.

#### Attribute Omission Analysis

Parse all successful mk batches and compute property usage rates:

```
Frame properties (from 2684 frames):
  w: 65%  layout: 53%  gap: 49%  h: 45%  p: 29%  corner: 30%

Text properties (from 1947 texts):
  content: 100%  size: 100%  fill: 100%  weight: 52%  w: 34%
```

#### Attention Decay Analysis (Critical Finding)

LLM attention decays with line position within a flat ops batch:

| Position | AvgProps | Layout% | Padding% | Gap% |
|----------|---------|---------|----------|------|
| Line 1 (root) | 6.5 | 92% | 70% | — |
| Line 2 | 5.1 | 71% | 43% | — |
| Line 3+ | 4.4 | 43% | 4% | — |
| First 25% | 5.2 | 66% | 38% | 63% |
| Last 25% | 4.5 | 44% | 21% | 35% |

**Key findings**:
- NOT linear decay — **cliff drop at line 3**, then stabilizes at a low level
- Root node gets full attention (92% layout, 70% padding); children are heavily omitted
- `padding` is the most position-sensitive property (70% → 4% from line 1 to line 3)
- Batches 21+ lines show overall quality degradation vs smaller batches
- This validates the PROGRESSIVE CREATION strategy (split into multiple smaller batches)

#### Batch Size Effect

| Batch size | Layout% | Padding% |
|-----------|---------|----------|
| 1-5 lines | 35% | 41% |
| 6-10 | 61% | 31% |
| 11-15 | 62% | 40% |
| 16-20 | 53% | 30% |
| 21+ | 51% | 26% |

Sweet spot: 6-15 lines per batch. Below 6 is too fragmented; above 20 degrades.

### Phase 4: Experiment Loop

```
analyze issues → form hypothesis → edit ONE thing → build → benchmark → keep/discard → repeat
```

Each iteration:
1. Read latest benchmark data (`tools/autoresearch/data/latest.json`)
2. Identify weakest dimension / most common issue
3. Hypothesize WHY — is it a mental model gap? Ambiguous rule? Missing example?
4. Make ONE edit to `src/prompts/CORE.md`
5. `node build.js`
6. `npx tsx tools/autoresearch/run.ts --compare baseline`
7. Score improved ≥2 → `git commit` + `--save baseline`
8. Score neutral/worse → `git checkout -- src/prompts/CORE.md`

### Phase 5: Cross-Model Review with Codex

Use `/codex` (OpenAI Codex CLI) as independent reviewer at key checkpoints:

**When to invoke Codex**:
- After building the evaluation harness — ask Codex to audit the scoring methodology
- After collecting baseline data — ask Codex to identify blind spots
- When stuck after 3+ failed experiments — fresh perspective

**How to invoke**:
```bash
codex exec "<detailed prompt about what to review>" \
  -s read-only \
  -c 'model_reasoning_effort="high"' \
  --enable web_search_cached \
  --json 2>/dev/null | python3 -c "<JSONL parser>"
```

**What Codex caught in this project**:
- Evaluation harness exported entire page (not scoped to current run)
- fillCompleteness comment/code mismatch
- toolEfficiency mixed into design quality score
- Recommended geometric mean over weighted sum
- Identified missing semantic checks (prompt asks for 3 cards, output has 1)

## Data Extraction Scripts

### Property usage analysis
```bash
# Extract from all mk batches, compute per-property usage rates
npx tsx tools/autoresearch/evaluate.ts [result-dir] --json
```

### Attention decay analysis
```bash
# Analyze property omission by line position within batches
# Group by: batch size bucket, line position (first/mid/last 25%)
# Key metric: average props per line at position N
```

### Cross-run comparison
```bash
npx tsx tools/autoresearch/run.ts --compare baseline
```

## Known Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Evaluator bug | 0% on a metric that looks fine visually | Fix evaluator, NOT the prompt |
| Canvas contamination | Node count grows across runs | Use rootNodeIds to scope evaluation |
| Figma reload failure | nodeTree always null after code change | Manually restart plugin in Figma |
| Stale references in prompt | Adding "XML skeletons" or old tool names | Read actual tool call logs first |
| Over-constraining | Adding rules → LLM over-engineers (more nodes, more errors) | Prefer removing/simplifying rules |
| Non-determinism | Score varies ±1-2 between identical runs | Only trust ≥2 point changes |
| mk path-with-spaces | maxDepth=0, all scores 100% (false) | Fixed 2026-03-20: smart path extraction in evaluator |
| mk vs jsx baseline comparison | baseline-v2 inflated (90.7 → 88.4 corrected) | Always use baseline-v2-corrected for comparison |

## Evaluator Fixes (March 2026)

### mk fallback parser space-in-path bug
mk paths like `/Login Card/Header/` contain spaces. The evaluator's `split(/\s+/)` broke them
into separate tokens → all nodes became orphan roots → maxDepth=0 → every metric auto-passed.
**Fix**: Smart path extraction — scan tokens until hitting a type keyword or `key:value` pattern.
**Impact**: baseline-v2 login dropped from 100 → 88.5 after fix. Mean 90.7 → 88.4.

### JSX fallback parser
Added `buildNodesFromJsx()` to handle `jsx` tool calls in the fallback path (Priority 3).
Uses regex-based tag/attribute extraction with stack-based parent linkage.
JSX tree reconstruction is inherently more reliable than mk path reconstruction because
nesting IS the structure — no path parsing ambiguity.

### Baselines
- `baseline-v2.json` — original mk baseline (inflated, DO NOT USE for comparison)
- `baseline-v2-corrected.json` — same data, re-evaluated with fixed parser (mean 88.4)
- `jsx-v1.json` — first JSX benchmark (mean 91.2, +2.8 vs corrected mk)

## File Reference

| File | Role |
|------|------|
| `tools/autoresearch/evaluate.ts` | Quality evaluator (the "val_bpb") |
| `tools/autoresearch/run.ts` | Benchmark runner (trigger → evaluate → compare) |
| `tools/autoresearch/prompts.json` | Standard test prompts |
| `tools/autoresearch/program.md` | Agent instructions for autonomous loop |
| `tools/autoresearch/data/` | Saved baselines and latest results |
| `src/prompts/CORE.md` | The prompt being optimized |
