# Chart Fix D — dashboard.md line-chart guidance

Date: 2026-05-07
Branch: feat/dogfood-ui

## Problem

DASHBOARD_CN sanity batch produced bars when prompt asked for 折线图 (line chart). Original failing trigger (`trigger-1778161936025`):
- Loaded `skill:create-page` + `guideline:dashboard` + `style:slate-data`
- Output had `<frame name='Bar1'..'Bar7'>` filled rectangles — a bar chart with `LineChart` frame name

Root cause traced to `src/guidelines/dashboard.md:131-133` Chart Container section:
```xml
<frame name='Chart Canvas' ...>
  {/* Bar/line chart placeholder content */}
</frame>
```
Placeholder comment gave no shape guidance. Agent improvised with bars from training prior.

## Test methodology

3 candidate fixes were initially proposed:
- **A**: enrich `chart.md` line chart section with `<vector vectorPaths>` recipe
- **B**: enrich `anatomy:line-chart` YAML with concrete jsx
- **C**: replace `chart.md` line chart with downgrade-to-bar message

Each tested via dev bridge with a controlled simple line-chart prompt. Result: **all 3 produced vector paths but none of the fixes actually loaded** — agent solved via SVG path training prior, not via my edits. Variance among A/B/C runs (31 / 18 / 11 tools) was stochastic noise, not signal.

Re-investigation: the bug only reproduces when prompt forces dashboard-context loading. With the natural prompt "做一个 dashboard ... 折线图" agent loads `guideline:dashboard` (placeholder comment leads to bars), not `chart.md` or `line-chart` anatomy. Fix A/B/C all targeted entries the agent never touches in this scenario.

**Fix D**: edit `dashboard.md` directly — the entry that IS loaded.

## Fix D — applied edit

`src/guidelines/dashboard.md` Chart Canvas comment:

Before:
```jsx
<frame name='Chart Canvas' layout='row' width='fill' h='240' bg='transparent'>
  {/* Bar/line chart placeholder content */}
</frame>
```

After:
```jsx
<frame name='Chart Canvas' w='fill' h='240' bg='transparent' overflow='visible'>
  {/* Pick ONE chart type based on user request: */}
  {/* (a) BAR CHART: stacked <rect h='proportional' bg='#color' rounded='4 4 0 0'/> as columns. See guideline:chart §Bar Chart for full example. */}
  {/* (b) LINE CHART: ONE <vector vectorPaths='M x0,y0 L x1,y1 ...'/> with computed coords. Compute x_i = i × W/(N-1), y_i = H - (v_i/vmax)*H. Example: */}
  {/* <frame name='Plot' w='560' h='240' bg='transparent' overflow='visible'> */}
  {/*   <line layoutPositioning='absolute' x={0} y={0}   w={560} stroke='1 #F1F5F9'/> */}
  {/*   ... (3 more grid lines) ... */}
  {/*   <vector layoutPositioning='absolute' x={0} y={0} w={560} h={240} */}
  {/*           vectorPaths='M 0,144 L 80,96 L 160,120 L 240,64 L 320,80 L 400,40 L 480,72 L 560,56' */}
  {/*           stroke='2 #3B82F6'/> */}
  {/* </frame> */}
  {/* CRITICAL: For line charts, NEVER stack <frame> rectangles as substitutes — that produces a bar chart. Use <vector vectorPaths>. */}
</frame>
```

The comment teaches BOTH chart types and explicitly forbids the bar-fallback for line charts. Also points to chart.md for full templates.

## Verification

Identical prompt: `做一个 dashboard，左侧导航 + 4 个 KPI 卡片 + 一个折线图。Use slate-data style.`

| Test | tools | errors | duration | `<frame name='Bar*'>` | `<vector vectorPaths>` | verdict |
|---|---|---|---|---|---|---|
| BASELINE-CLEAN | 6 | 0 | 132s | **7** | 0 | ✗ **FAIL** (bars) |
| **FIX-D** | 8 | 0 | 140s | **0** | **1** | ✓ **WIN** (line) |

Fix D output excerpt:
```xml
<vector name='LineChart' layoutPositioning='absolute' x='0' y='0' w='fill' h='fill'
        vectorPaths='M 0,180 L 80,140 L 160,160 L 240,100 L 320,120 L 400,80 L 480,60 L 560,40 L 640,70 L 720,30 L 800,50 L 880,20'
        stroke='2 #38BDF8' strokeCap='round' strokeJoin='round'/>
```

12-point line chart, properly drawn. Knowledge loads identical to baseline (skill:create-page + guideline:dashboard) — change is purely in the loaded entry's content.

## Lessons

1. **Verify which knowledge entry is actually loaded** before designing a fix. 3 of my 4 candidate fixes targeted entries the agent never touched for this prompt.
2. **Controlled prompts must NOT leak the answer** — my first dashboard test included "must use vectorPaths" which neutralized the bug.
3. **Bug is deterministic when scoped correctly** — clean dashboard prompt reproduced bars 1/1; with leaked prompt it produced vectors 1/1.

## ROI

| Metric | Before | After | Δ |
|---|---|---|---|
| Bar chart misuse on line-chart asks (in dashboard context) | 100% (1/1) | 0% (1/1) | -100pp |
| Tool count | 6 | 8 | +2 (acceptable, line chart needs more elements) |
| Errors | 0 | 0 | unchanged |
| Knowledge loads | 2 (skill+guideline) | 2 (same) | unchanged |

## Files changed
- `src/guidelines/dashboard.md` (+15 lines in Chart Canvas comment)
- `src/generated/knowledge-content.json` (auto-regenerated)

## Methodology note

The 3 originally proposed fixes (A, B, C) were never committed. A and B were applied + tested on simple line-chart prompts, then reverted. The data showed they targeted the wrong code path. C was applied + tested, then reverted for the same reason. Only Fix D ships.

This is a clear case for "verify which path is taken before fixing". Trace which knowledge entries the agent loads in the actual failure scenario, then fix THAT entry.
