# Agent Tool Usage Examples (E2E Trigger Logs)

Real tool call sequences captured from dev bridge E2E testing. These are the best examples of our agent's design patterns.

## Example 1: Dashboard (297s, 11 tool calls, Kimi K2.5)

**Prompt**: Design a complete dashboard with sidebar, stats cards, and data table.

**Why this is the best example**: Demonstrates all 5 core agent behaviors — progressive creation, knowledge query, error recovery, inspection, and post-verification fix.

### Tool Call Sequence

```
[1] design    → Notification card (warm-up, 8 nodes)
[2] query     → source=guidelines, query="dashboard"
[3] query     → source=style, query="dashboard, light-mode, blue-accent"
[4] design    → Dashboard skeleton: outer frame + sidebar + main content (14 nodes)
[5] design    → Sidebar nav items: 5 navigation rows with icons (15 nodes)
[6] design    → 3 metric cards: Revenue, Users, Growth (27 nodes)
[7] design    → Table: header + 3 data rows with status badges (28 nodes)
[8] design    → Table rows 4-5 — ERROR (syntax error in ops)
[9] design    → Fix: recreate row 5 column (1 node)
[10] inspect  → nodeId=dashboard, screenshot=true — verify layout
[11] design   → Post-verification fix: add missing Order ID columns (2 created, 3 edited)
```

### Key Behaviors Demonstrated

**1. Knowledge Query Before Design (calls 2-3)**
Agent queries guidelines and style guide BEFORE starting layout — ensures design decisions are informed, not guessed.
```
query({source:"guidelines", query:"dashboard"})
→ Dashboard Design Guidelines (layout patterns, spacing, metrics placement)

query({source:"style", query:"dashboard, light-mode, blue-accent"})
→ Fintech Dark style guide (color palette, typography scale)
```

**2. Progressive Creation — Skeleton First (call 4)**
Creates the structural skeleton with placeholder containers, then fills in details:
```
dashboard = frame(root, {name:'Dashboard', layout:'row', w:1440, h:900, bg:'#F8FAFC'})
  sidebar = frame(dashboard, {name:'Sidebar', layout:'column', w:240, height:'fill', bg:'#0F172A', p:16, gap:24})
    logoArea = frame(sidebar, {pattern:'row', gap:8, ...})
    navSection = frame(sidebar, {pattern:'column', gap:4, w:'fill', height:'fill'})
    userSection = frame(sidebar, {pattern:'row', gap:12, ...})
  mainContent = frame(dashboard, {name:'Main Content', layout:'column', gap:24, w:'fill', height:'fill', p:24})
    topBar = frame(mainContent, {pattern:'row', justifyContent:'space-between', ...})
    statsRow = frame(mainContent, {pattern:'row', gap:16, ...})        ← placeholder
    tableSection = frame(mainContent, {layout:'column', gap:16, ...})  ← placeholder
```

**3. Filling Containers by ID Reference (calls 5-7)**
Subsequent calls reference real Figma IDs from previous batches:
```
// Call 5: Fill navSection by ID
navDashboard = frame('1009:9509', {name:'Nav-Dashboard', layout:'row', gap:12, ...})

// Call 6: Fill statsRow by ID
metricCard1 = frame('1009:9516', {name:'MetricCard-Revenue', layout:'column', gap:8, ...})

// Call 7: Fill tableSection by ID
tableContainer = frame('1009:9517', {name:'Table Container', layout:'column', ...})
```

**4. Error Recovery (calls 8-9)**
Call 8 has a syntax error (`w:120'}`  — stray quote). Agent detects failure and fixes only the broken part:
```
// Call 8: ERROR — partial success (row4 created, row5 incomplete)
// Call 9: Fix only the missing piece
row5Col5 = text('1010:9625', {name:'Cell 5', size:14, weight:'Medium', fill:'#1E293B', w:120}, '$1,890')
```

**5. Inspect + Post-Verification Fix (calls 10-11)**
Takes screenshot to verify, notices rows 4-5 have wrong column structure, adds missing Order ID fields:
```
// Call 10: inspect with screenshot
inspect({nodeId:"1009:9499", screenshot:true})

// Call 11: Fix discovered issues
row4Order = text('1010:9618', {name:'Order ID', ...}, '#ORD-2024-004')
row5Order = text('1010:9625', {name:'Order ID', ...}, '#ORD-2024-005')
update('1010:9601', {name:'Status-Completed', ...}, 'Completed')  // fix badge text
```

### Full Ops — Call 4 (Skeleton)

```
dashboard = frame(root, {name:'Dashboard', layout:'row', w:1440, h:900, bg:'#F8FAFC'})
sidebar = frame(dashboard, {name:'Sidebar', layout:'column', w:240, height:'fill', bg:'#0F172A', p:16, gap:24})
logoArea = frame(sidebar, {name:'Logo Area', pattern:'row', gap:8, alignItems:'center', w:'fill', height:'hug'})
logoIcon = icon(logoArea, {name:'Logo Icon', icon:'lucide:layout-dashboard', size:24, fill:'#FFFFFF'})
appName = text(logoArea, {name:'App Name', size:18, weight:'Bold', fill:'#FFFFFF'}, 'Dashboard')
navSection = frame(sidebar, {name:'Nav Section', pattern:'column', gap:4, w:'fill', height:'fill'})
userSection = frame(sidebar, {name:'User Section', pattern:'row', gap:12, alignItems:'center', w:'fill', height:'hug', p:'12 0 0 0'})
avatar = frame(userSection, {name:'Avatar', w:32, h:32, corner:16, bg:'#334155'})
userName = text(userSection, {name:'User Name', size:14, fill:'#CBD5E1'}, 'Admin User')
mainContent = frame(dashboard, {name:'Main Content', layout:'column', gap:24, w:'fill', height:'fill', bg:'transparent', p:24})
topBar = frame(mainContent, {name:'Top Bar', pattern:'row', justifyContent:'space-between', alignItems:'center', w:'fill', height:'hug'})
pageTitle = text(topBar, {name:'Page Title', size:24, weight:'Bold', fill:'#0F172A'}, 'Overview')
statsRow = frame(mainContent, {name:'Stats Row', pattern:'row', gap:16, w:'fill', height:'hug'})
tableSection = frame(mainContent, {name:'Table Section', layout:'column', gap:16, w:'fill', height:'fill'})
```

### Full Ops — Call 6 (Metric Cards)

```
metricCard1 = frame('1009:9516', {name:'MetricCard-Revenue', layout:'column', gap:8, p:20, w:'fill', height:'hug', bg:'#FFFFFF', corner:12, shadow:'0,1,3,0,#0000001A'})
metricHeader1 = frame(metricCard1, {name:'Header', layout:'row', justifyContent:'space-between', alignItems:'center', w:'fill', height:'hug', bg:'transparent'})
metricLabel1 = text(metricHeader1, {name:'Label', size:14, fill:'#64748B'}, 'Total Revenue')
metricIcon1 = icon(metricHeader1, {name:'Icon', icon:'lucide:dollar-sign', size:20, fill:'#3B82F6'})
metricValue1 = text(metricCard1, {name:'Value', size:28, weight:'Bold', fill:'#0F172A'}, '$48,250')
metricChange1 = frame(metricCard1, {name:'Change', layout:'row', gap:4, alignItems:'center', w:'hug', height:'hug', bg:'transparent'})
metricArrow1 = icon(metricChange1, {name:'Arrow', icon:'lucide:trending-up', size:16, fill:'#10B981'})
metricPercent1 = text(metricChange1, {name:'Percent', size:14, weight:'Medium', fill:'#10B981'}, '+12.5%')
metricPeriod1 = text(metricChange1, {name:'Period', size:14, fill:'#94A3B8'}, 'vs last month')

metricCard2 = frame('1009:9516', {name:'MetricCard-Users', layout:'column', gap:8, p:20, w:'fill', height:'hug', bg:'#FFFFFF', corner:12, shadow:'0,1,3,0,#0000001A'})
metricHeader2 = frame(metricCard2, {name:'Header', layout:'row', justifyContent:'space-between', alignItems:'center', w:'fill', height:'hug', bg:'transparent'})
metricLabel2 = text(metricHeader2, {name:'Label', size:14, fill:'#64748B'}, 'Active Users')
metricIcon2 = icon(metricHeader2, {name:'Icon', icon:'lucide:users', size:20, fill:'#8B5CF6'})
metricValue2 = text(metricCard2, {name:'Value', size:28, weight:'Bold', fill:'#0F172A'}, '2,543')
metricChange2 = frame(metricCard2, {name:'Change', layout:'row', gap:4, alignItems:'center', w:'hug', height:'hug', bg:'transparent'})
metricArrow2 = icon(metricChange2, {name:'Arrow', icon:'lucide:trending-up', size:16, fill:'#10B981'})
metricPercent2 = text(metricChange2, {name:'Percent', size:14, weight:'Medium', fill:'#10B981'}, '+8.2%')
metricPeriod2 = text(metricChange2, {name:'Period', size:14, fill:'#94A3B8'}, 'vs last month')

metricCard3 = frame('1009:9516', {name:'MetricCard-Growth', layout:'column', gap:8, p:20, w:'fill', height:'hug', bg:'#FFFFFF', corner:12, shadow:'0,1,3,0,#0000001A'})
metricHeader3 = frame(metricCard3, {name:'Header', layout:'row', justifyContent:'space-between', alignItems:'center', w:'fill', height:'hug', bg:'transparent'})
metricLabel3 = text(metricHeader3, {name:'Label', size:14, fill:'#64748B'}, 'Growth Rate')
metricIcon3 = icon(metricHeader3, {name:'Icon', icon:'lucide:bar-chart-3', size:20, fill:'#F59E0B'})
metricValue3 = text(metricCard3, {name:'Value', size:28, weight:'Bold', fill:'#0F172A'}, '24.8%')
metricChange3 = frame(metricCard3, {name:'Change', layout:'row', gap:4, alignItems:'center', w:'hug', height:'hug', bg:'transparent'})
metricArrow3 = icon(metricChange3, {name:'Arrow', icon:'lucide:trending-up', size:16, fill:'#10B981'})
metricPercent3 = text(metricChange3, {name:'Percent', size:14, weight:'Medium', fill:'#10B981'}, '+3.1%')
metricPeriod3 = text(metricChange3, {name:'Period', size:14, fill:'#94A3B8'}, 'vs last month')
```

---

## Example 2: Button ComponentSet (144s, 4 tool calls, Kimi K2.5)

**Prompt**: Create a Button component set with Style/State/Size variants.

**Why this is valuable**: Demonstrates clone cascading for efficient variant matrix creation + error recovery from format mistake.

### Tool Call Sequence

```
[1] query     → source=guidelines, query="form"
[2] design    → ERROR: multi-line JSON format (parser requires single-line flat ops)
[3] design    → 18 variants via clone cascade + variantSet (20 nodes in 1 batch)
[4] inspect   → nodeId=componentSet, screenshot=true — verify result
```

### Key Behaviors Demonstrated

**1. Format Error Recovery (calls 2-3)**
First attempt uses multi-line JSON with `{` on new lines — parser rejects it. Agent immediately retries with correct single-line format:
```
// WRONG (call 2):
btnBase = frame(root, {
  name: 'Style=Primary, State=Default, Size=Medium',
  reusable: true,
  ...
})

// FIXED (call 3):
btnBase = frame(root, {name: 'Style=Primary, State=Default, Size=Medium', reusable: true, layout: 'row', ...})
```

**2. Clone Cascade — 18 Variants in 1 Batch**
Creates base → clones with minimal overrides → groups by similarity:
```
// Base (1 frame + 1 text = 2 nodes)
btnBase = frame(root, {name:'Style=Primary, State=Default, Size=Medium', reusable:true, layout:'row', ...})
btnLabel = text(btnBase, {name:'Label', size:16, weight:'Medium', fill:'#FFFFFF'}, 'Button')

// Clone cascade: Primary variants (5 clones)
btnPriHover = clone(btnBase, root, {name:'...Hover...', bg:'#4338CA'})                       // 1 override
btnPriDisabled = clone(btnBase, root, {name:'...Disabled...', bg:'#A5B4FC', Label:{fill:'#FFFFFF'}})  // 2 overrides
btnPriSmBase = clone(btnBase, root, {name:'...Small', p:'8 16', w:100, h:36, Label:{size:14}})  // size overrides

// Secondary: clone from base with stroke (3+3 = 6 clones)
btnSecBase = clone(btnBase, root, {name:'...Secondary...', bg:'#FFFFFF', stroke:'#E5E7EB', strokeW:1, Label:{fill:'#374151'}})
btnSecHover = clone(btnSecBase, root, {name:'...Hover...', bg:'#F9FAFB'})                     // cascade from Secondary base

// Ghost: clone from base with transparent bg (3+3 = 6 clones)
btnGhostBase = clone(btnBase, root, {name:'...Ghost...', bg:'transparent', Label:{fill:'#4F46E5'}})

// Combine all into ComponentSet
btnSet = variantSet(root, {name:'Button', from:'btnBase,btnPriHover,...,btnGhostSmDisabled'})
```

Total: 1 frame + 1 text + 17 clones + 1 variantSet = **20 ops in 1 batch**.

**3. Inspect Verification (call 4)**
```
inspect({nodeId:"1012:9980", depth:3, screenshot:true})
→ ComponentSet 1980×72, 18 variants in horizontal row
```

---

## Summary: Agent Behavior Patterns

| Pattern | Dashboard Example | Button Set Example |
|---------|------------------|-------------------|
| **Knowledge before action** | guidelines + style guide | guidelines |
| **Progressive creation** | skeleton → fill containers by ID | base → clone cascade |
| **Batch efficiency** | 14-28 nodes per batch | 20 nodes in 1 batch |
| **ID referencing** | Real Figma IDs across batches | Symbols within same batch |
| **Error recovery** | Syntax error → fix broken piece | Format error → full retry |
| **Verification** | inspect + screenshot → fix | inspect + screenshot |
| **Post-verification fix** | Add missing columns, fix badges | — |

### What Makes These Good Examples

1. **Not one-shot** — Agent breaks complex designs into logical steps
2. **Uses knowledge system** — Queries guidelines/style BEFORE designing
3. **Self-correcting** — Detects errors and fixes without user intervention
4. **Verifies output** — Takes screenshot to compare against intent
5. **Efficient batching** — Groups related nodes into single tool calls (up to 28 nodes)
6. **Cross-batch referencing** — Uses real Figma IDs from previous batches to build into existing containers
