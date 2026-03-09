# Chart Design Guidelines

## 1. Purpose & Scope

**Use for**: Data visualization containers — bar charts, line charts, pie/donut charts, area charts. These are Figma mockups (static shapes), not live charts.

**Do NOT use for**: Tables of numbers (use table guideline), simple metrics without visualization (use dashboard metric cards).

**Key insight**: In Figma, charts are built from basic shapes (rects for bars, lines/vectors for line charts, ellipses for pies). The chart container provides structure; the visual data is represented with colored shapes.

## 2. Layout Template

```
+---Chart Card (fill width)---+
|  Header                      |
|    Title     Legend           |
|  Chart Canvas (explicit h)   |
|    Y-Axis | Data Area        |
|           | ████ ███ ████    |
|           | █ ██ ███ ██ █    |
|    X-Axis Labels             |
+------------------------------+
```

### XML Skeleton — copy and modify:

```xml
<frame name='Chart Card' layout='column' gap='16' p='20' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Header' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Title' size='16' weight='Bold' fill='#111827'>Revenue Overview</text>
    <frame name='Legend' layout='row' gap='16' width='hug' height='hug' bg='transparent'>
      <!-- Legend items -->
    </frame>
  </frame>
  <frame name='Chart Canvas' layout='row' gap='8' width='fill' h='240' bg='transparent'>
    <!-- Y-axis + data area + optional right axis -->
  </frame>
  <frame name='X Labels' layout='row' justifyContent='space-between' p='0 40 0 40' width='fill' height='hug' bg='transparent'>
    <!-- X-axis labels -->
  </frame>
</frame>
```

## 3. Component Patterns

### Bar Chart

```xml
<frame name='Bar Chart' layout='column' gap='16' p='20' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Header' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Title' size='16' weight='Bold' fill='#111827'>Monthly Revenue</text>
    <frame name='Legend' layout='row' gap='16' width='hug' height='hug' bg='transparent'>
      <frame name='Item 1' layout='row' gap='6' alignItems='center' width='hug' height='hug' bg='transparent'>
        <rect name='Dot' w='8' h='8' corner='4' bg='#3B82F6'/>
        <text name='Label' size='12' fill='#6B7280'>Revenue</text>
      </frame>
      <frame name='Item 2' layout='row' gap='6' alignItems='center' width='hug' height='hug' bg='transparent'>
        <rect name='Dot' w='8' h='8' corner='4' bg='#93C5FD'/>
        <text name='Label' size='12' fill='#6B7280'>Expenses</text>
      </frame>
    </frame>
  </frame>
  <frame name='Chart Area' layout='row' gap='0' width='fill' h='200' bg='transparent' alignItems='flex-end'>
    <frame name='Y Axis' layout='column' justifyContent='space-between' w='40' height='fill' bg='transparent'>
      <text name='Y5' size='11' fill='#9CA3AF'>50k</text>
      <text name='Y4' size='11' fill='#9CA3AF'>40k</text>
      <text name='Y3' size='11' fill='#9CA3AF'>30k</text>
      <text name='Y2' size='11' fill='#9CA3AF'>20k</text>
      <text name='Y1' size='11' fill='#9CA3AF'>10k</text>
      <text name='Y0' size='11' fill='#9CA3AF'>0</text>
    </frame>
    <frame name='Bars' layout='row' gap='16' alignItems='flex-end' width='fill' height='fill' bg='transparent' p='0 8'>
      <frame name='Group Jan' layout='row' gap='4' alignItems='flex-end' width='fill' height='fill' bg='transparent'>
        <rect name='Rev' w='fill' h='160' bg='#3B82F6' corner='4 4 0 0'/>
        <rect name='Exp' w='fill' h='120' bg='#93C5FD' corner='4 4 0 0'/>
      </frame>
      <frame name='Group Feb' layout='row' gap='4' alignItems='flex-end' width='fill' height='fill' bg='transparent'>
        <rect name='Rev' w='fill' h='140' bg='#3B82F6' corner='4 4 0 0'/>
        <rect name='Exp' w='fill' h='100' bg='#93C5FD' corner='4 4 0 0'/>
      </frame>
      <frame name='Group Mar' layout='row' gap='4' alignItems='flex-end' width='fill' height='fill' bg='transparent'>
        <rect name='Rev' w='fill' h='180' bg='#3B82F6' corner='4 4 0 0'/>
        <rect name='Exp' w='fill' h='130' bg='#93C5FD' corner='4 4 0 0'/>
      </frame>
      <frame name='Group Apr' layout='row' gap='4' alignItems='flex-end' width='fill' height='fill' bg='transparent'>
        <rect name='Rev' w='fill' h='150' bg='#3B82F6' corner='4 4 0 0'/>
        <rect name='Exp' w='fill' h='110' bg='#93C5FD' corner='4 4 0 0'/>
      </frame>
    </frame>
  </frame>
  <frame name='X Labels' layout='row' justifyContent='space-around' p='0 48' width='fill' height='hug' bg='transparent'>
    <text name='L1' size='11' fill='#9CA3AF'>Jan</text>
    <text name='L2' size='11' fill='#9CA3AF'>Feb</text>
    <text name='L3' size='11' fill='#9CA3AF'>Mar</text>
    <text name='L4' size='11' fill='#9CA3AF'>Apr</text>
  </frame>
</frame>
```

### Line Chart (simplified)

```xml
<frame name='Line Chart' layout='column' gap='16' p='20' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Header' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Title' size='16' weight='Bold' fill='#111827'>Trend Analysis</text>
    <frame name='Legend' layout='row' gap='16' width='hug' height='hug' bg='transparent'>
      <frame name='Item' layout='row' gap='6' alignItems='center' width='hug' height='hug' bg='transparent'>
        <rect name='Line' w='16' h='3' corner='2' bg='#3B82F6'/>
        <text name='Label' size='12' fill='#6B7280'>Users</text>
      </frame>
    </frame>
  </frame>
  <frame name='Chart Area' layout='column' gap='0' width='fill' h='200' bg='transparent'>
    <frame name='Grid' layout='column' justifyContent='space-between' width='fill' height='fill' bg='transparent'>
      <rect name='Grid Line' width='fill' h='1' bg='#F3F4F6'/>
      <rect name='Grid Line' width='fill' h='1' bg='#F3F4F6'/>
      <rect name='Grid Line' width='fill' h='1' bg='#F3F4F6'/>
      <rect name='Grid Line' width='fill' h='1' bg='#F3F4F6'/>
    </frame>
  </frame>
  <frame name='X Labels' layout='row' justifyContent='space-between' width='fill' height='hug' bg='transparent'>
    <text name='L1' size='11' fill='#9CA3AF'>Mon</text>
    <text name='L2' size='11' fill='#9CA3AF'>Tue</text>
    <text name='L3' size='11' fill='#9CA3AF'>Wed</text>
    <text name='L4' size='11' fill='#9CA3AF'>Thu</text>
    <text name='L5' size='11' fill='#9CA3AF'>Fri</text>
  </frame>
</frame>
```

### Donut Chart

```xml
<frame name='Donut Chart' layout='row' gap='32' alignItems='center' p='20' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Chart' layout='row' justifyContent='center' alignItems='center' w='160' h='160' bg='transparent'>
    <ellipse name='Ring BG' w='160' h='160' stroke='#F3F4F6' strokeW='20'/>
    <frame name='Center Label' layout='column' gap='2' alignItems='center' width='hug' height='hug' bg='transparent'>
      <text name='Value' size='24' weight='Bold' fill='#111827'>72%</text>
      <text name='Label' size='12' fill='#6B7280'>Complete</text>
    </frame>
  </frame>
  <frame name='Legend' layout='column' gap='12' width='fill' height='hug' bg='transparent'>
    <frame name='Item 1' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'>
      <rect name='Dot' w='12' h='12' corner='3' bg='#3B82F6'/>
      <text name='Label' size='14' fill='#374151' width='fill'>Completed</text>
      <text name='Value' size='14' weight='Medium' fill='#111827'>72%</text>
    </frame>
    <frame name='Item 2' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'>
      <rect name='Dot' w='12' h='12' corner='3' bg='#93C5FD'/>
      <text name='Label' size='14' fill='#374151' width='fill'>In Progress</text>
      <text name='Value' size='14' weight='Medium' fill='#111827'>18%</text>
    </frame>
    <frame name='Item 3' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'>
      <rect name='Dot' w='12' h='12' corner='3' bg='#DBEAFE'/>
      <text name='Label' size='14' fill='#374151' width='fill'>Remaining</text>
      <text name='Value' size='14' weight='Medium' fill='#111827'>10%</text>
    </frame>
  </frame>
</frame>
```

### Legend Item

```xml
<frame name='Legend Item' layout='row' gap='6' alignItems='center' width='hug' height='hug' bg='transparent'>
  <rect name='Dot' w='8' h='8' corner='4' bg='#3B82F6'/>
  <text name='Label' size='12' fill='#6B7280'>Series Name</text>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Chart card padding | `20` px |
| Chart card corner | `12` px |
| Chart card shadow | `0,1,3,0,#0000001A` |
| Chart canvas height | `200`–`240` px |
| Y-axis width | `40` px |
| Axis label size | `11` px, `#9CA3AF` |
| Legend dot size | `8` px (inline), `12` px (vertical list) |
| Legend text size | `12` px (header), `14` px (sidebar) |
| Legend gap | `16` px between items |
| Bar gap (between groups) | `16` px |
| Bar gap (within group) | `4` px |
| Bar top corner | `4 4 0 0` (rounded top, flat bottom) |
| Grid line color | `#F3F4F6` |
| Donut ring size | `160` px, `strokeW='20'` |
| Chart colors (sequential) | `#3B82F6`, `#93C5FD`, `#DBEAFE`, `#60A5FA` |
| Chart colors (categorical) | `#3B82F6`, `#10B981`, `#F59E0B`, `#EF4444`, `#8B5CF6` |
| Positive trend | `#10B981` |
| Negative trend | `#EF4444` |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| Chart canvas without explicit height | Always `h='200'` or `h='240'` — hug collapses without child shapes |
| No Y-axis labels | Include Y-axis frame with value labels for context |
| Bars without rounded top corners | Bar rects: `corner='4 4 0 0'` for polished look |
| Legend missing or inline with title | Legend in header (row, right-aligned) or beside chart (column) |
| > 5 colors without clear differentiation | Limit to 5 distinct colors; use opacity variations for more |
| Grid lines too dark | Grid: `#F3F4F6` (very subtle) — never `#000000` or `#9CA3AF` |
| Donut chart without center label | Center of donut: summary value + label text |
