---
id: guideline:dashboard
name: Dashboard Design Guideline
description: Use when designing admin panels, analytics dashboards, SaaS dashboards, or data-dense monitoring screens — covers sidebar, top bar, KPI cards, widget grids, and 1440x900 desktop layout.
category: guideline
tags: [dashboard, analytics, admin, sidebar, kpi, widget, saas]
---

# Dashboard Design Guidelines

## 1. Purpose & Scope

**Use for**: Admin panels, analytics dashboards, SaaS dashboards, data-dense overviews, monitoring screens.

**Do NOT use for**: Simple landing pages, single-form views, marketing sites.

**Root frame**: `w='1440' h='900'` — standard desktop dashboard viewport.

## 2. Layout Template

```
+--sidebar(240)--+--------content(fill)--------+
|  Logo          |  Top Bar                     |
|  Nav Item 1    |  Metric Cards (row)          |
|  Nav Item 2    |  +------+ +------+ +------+  |
|  Nav Item 3    |  | KPI1 | | KPI2 | | KPI3 |  |
|  ...           |  +------+ +------+ +------+  |
|  Divider       |  Main Content (row)          |
|  Settings      |  +--chart--+ +--table------+ |
|  User          |  |         | |             | |
+---------240px--+--fill------+-fill----------+-+
```

### XML Skeleton — copy and modify:

```xml
<frame name='Dashboard' layout='row' w='1440' h='900' bg='#F8FAFC'>
  <frame name='Sidebar' layout='column' w='240' height='fill' bg='#0F172A' p='16'>
    <frame name='Logo Area' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'>
      <icon name='Logo Icon' icon='lucide:layout-dashboard' size='24' fill='#FFFFFF'/>
      <text name='App Name' size='18' weight='Bold' fill='#FFFFFF'>AppName</text>
    </frame>
    <frame name='Nav Section' layout='column' gap='4' width='fill' height='fill' bg='transparent' p='0 0 16 0'>
      {/* Nav items go here */}
    </frame>
    <frame name='User Section' layout='row' gap='12' alignItems='center' width='fill' height='hug' bg='transparent' p='12 0 0 0'>
      <frame name='Avatar' w='32' h='32' corner='16' bg='#334155'/>
      <text name='User Name' size='14' fill='#CBD5E1'>John Doe</text>
    </frame>
  </frame>
  <frame name='Main Content' layout='column' gap='24' width='fill' height='fill' bg='transparent' p='24'>
    {/* Top bar, metric cards, charts, tables go here */}
  </frame>
</frame>
```

## 3. Component Patterns

### Sidebar Nav Item (active & inactive)

```xml
<frame name='Nav Item Active' layout='row' gap='12' alignItems='center' width='fill' height='hug' bg='#1E293B' p='10 12' corner='8'>
  <icon name='Icon' icon='lucide:home' size='20' fill='#3B82F6'/>
  <text name='Label' size='14' weight='Medium' fill='#F1F5F9'>Dashboard</text>
</frame>
<frame name='Nav Item' layout='row' gap='12' alignItems='center' width='fill' height='hug' bg='transparent' p='10 12' corner='8'>
  <icon name='Icon' icon='lucide:users' size='20' fill='#94A3B8'/>
  <text name='Label' size='14' fill='#94A3B8'>Users</text>
</frame>
```

### Metric Card (KPI)

```xml
<frame name='Metric Card' layout='column' gap='8' p='20' w='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Header' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Label' size='14' fill='#64748B'>Total Revenue</text>
    <icon name='Icon' icon='lucide:dollar-sign' size='20' fill='#3B82F6'/>
  </frame>
  <text name='Value' size='28' weight='Bold' fill='#0F172A'>$48,250</text>
  <frame name='Change' layout='row' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Arrow' icon='lucide:trending-up' size='16' fill='#10B981'/>
    <text name='Percent' size='14' weight='Medium' fill='#10B981'>+12.5%</text>
    <text name='Period' size='14' fill='#94A3B8'>vs last month</text>
  </frame>
</frame>
```

### Metric Cards Row

```xml
<frame name='Metrics Row' layout='row' gap='16' width='fill' height='hug' bg='transparent'>
  {/* 3-4 Metric Cards with width='fill' each */}
</frame>
```

### Data Table

```xml
<frame name='Table Container' layout='column' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Table Header Row' layout='row' gap='0' width='fill' height='hug' bg='#F8FAFC' p='12 16'>
    <text name='Col 1' size='12' weight='Medium' fill='#64748B' w='200'>Name</text>
    <text name='Col 2' size='12' weight='Medium' fill='#64748B' w='fill'>Status</text>
    <text name='Col 3' size='12' weight='Medium' fill='#64748B' w='120'>Amount</text>
  </frame>
  <frame name='Row 1' layout='row' gap='0' width='fill' height='hug' bg='transparent' p='12 16' stroke='#F1F5F9' strokeW='1'>
    <text name='Cell 1' size='14' fill='#1E293B' w='200'>Acme Corp</text>
    <frame name='Badge' layout='row' p='2 8' width='hug' height='hug' bg='#DCFCE7' corner='12'>
      <text name='Status' size='12' weight='Medium' fill='#16A34A'>Active</text>
    </frame>
    <text name='Cell 3' size='14' weight='Medium' fill='#1E293B' w='120'>$1,250</text>
  </frame>
</frame>
```

### Chart Container

```xml
<frame name='Chart Card' layout='column' gap='16' p='20' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Chart Header' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Title' size='16' weight='Bold' fill='#0F172A'>Revenue Overview</text>
    <frame name='Period Selector' layout='row' gap='0' width='hug' height='hug' bg='#F1F5F9' corner='6'>
      <frame name='Option Active' layout='row' p='6 12' width='hug' height='hug' bg='#FFFFFF' corner='6' shadow='0,1,2,0,#0000000D'>
        <text name='Label' size='12' weight='Medium' fill='#0F172A'>Week</text>
      </frame>
      <frame name='Option' layout='row' p='6 12' width='hug' height='hug' bg='transparent' corner='6'>
        <text name='Label' size='12' fill='#64748B'>Month</text>
      </frame>
    </frame>
  </frame>
  <frame name='Chart Canvas' layout='row' width='fill' h='240' bg='transparent'>
    {/* Bar/line chart placeholder content */}
  </frame>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Sidebar width | `240` px |
| Content padding | `24` px |
| Card padding | `20` px |
| Card corner radius | `12` px |
| Card shadow | `0,1,3,0,#0000001A` |
| Card gap (between cards) | `16` px |
| Section gap (between rows) | `24` px |
| Nav item padding | `10 12` px |
| Nav item gap | `4` px |
| Sidebar bg (dark) | `#0F172A` |
| Content bg | `#F8FAFC` |
| Card bg | `#FFFFFF` |
| Primary text | `#0F172A` |
| Secondary text | `#64748B` |
| Muted text | `#94A3B8` |
| Primary accent | `#3B82F6` |
| Success | `#10B981` |
| Error | `#EF4444` |
| Border/divider | `#F1F5F9` |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| Sidebar without `height='fill'` | Sidebar must stretch full viewport height: `height='fill'` |
| Metric cards without `width='fill'` | Each card in a row needs `width='fill'` to distribute evenly |
| Content area without padding | Always `p='24'` on the main content frame |
| Chart container without fixed height | Chart canvas needs explicit `h='240'` or similar — `hug` collapses to 0 |
| No gap on card row | `gap='16'` between metric cards; `gap='24'` between sections |
| Nav items without `bg='transparent'` on inactive | Inactive nav items: `bg='transparent'`; active: `bg='#1E293B'` |
| Table without header background | Table header row: `bg='#F8FAFC'` to distinguish from data rows |
