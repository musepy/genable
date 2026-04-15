---
id: guideline:navigation
name: Navigation Design Guideline
description: Use when designing top navbars, sidebars, tab bars, breadcrumbs, or mobile bottom navigation — covers wayfinding structure, fill sizing, active states, and menu patterns.
category: guideline
tags: [navigation, navbar, sidebar, tabs, breadcrumb, wayfinding, menu]
---

# Navigation Design Guidelines

## 1. Purpose & Scope

**Use for**: Top navigation bars, sidebars, tab bars, breadcrumbs, mobile bottom navigation.

**Do NOT use for**: Full dashboard layouts (use dashboard guideline), form navigation/wizards.

**Key principle**: Navigation frames are structural — they define the app's wayfinding. Always `width='fill'` for horizontal navs, `height='fill'` for sidebars.

## 2. Layout Template

### Horizontal Navbar

```
+--Logo--+---Nav Links (row, gap=32)---+--Actions--+
| [icon] | Features  Pricing  About    | [CTA btn] |
+---------+----------------------------+-----------+
     ^            ^                         ^
  flex-none   flex-grow/center         flex-none
```

### Sidebar

```
+------sidebar(240px)------+
|  Logo (row)               |
|  Divider                  |
|  Nav Group                |
|    Nav Item (active)      |
|    Nav Item               |
|    Nav Item               |
|  Divider                  |
|  Nav Group                |
|    Nav Item               |
|    ...                    |
|  [spacer: height=fill]   |
|  User Profile             |
+---------------------------+
```

## 3. Component Patterns

### Top Navbar (light)

```xml
<frame name='Navbar' layout='row' justifyContent='space-between' alignItems='center' p='12 24' width='fill' h='64' bg='#FFFFFF' shadow='0,1,3,0,#0000000D'>
  <frame name='Left' layout='row' gap='8' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Logo' icon='lucide:hexagon' size='28' fill='#4F46E5'/>
    <text name='Brand' size='18' weight='Bold' fill='#111827'>AppName</text>
  </frame>
  <frame name='Center' layout='row' gap='32' alignItems='center' width='hug' height='hug' bg='transparent'>
    <text name='Link Active' size='14' weight='Medium' fill='#111827'>Dashboard</text>
    <text name='Link' size='14' fill='#6B7280'>Projects</text>
    <text name='Link' size='14' fill='#6B7280'>Team</text>
    <text name='Link' size='14' fill='#6B7280'>Settings</text>
  </frame>
  <frame name='Right' layout='row' gap='16' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Bell' icon='lucide:bell' size='20' fill='#6B7280'/>
    <frame name='Avatar' w='32' h='32' corner='16' bg='#E5E7EB'/>
  </frame>
</frame>
```

### Top Navbar (dark)

```xml
<frame name='Navbar Dark' layout='row' justifyContent='space-between' alignItems='center' p='12 24' width='fill' h='64' bg='#111827'>
  <frame name='Left' layout='row' gap='8' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Logo' icon='lucide:hexagon' size='28' fill='#60A5FA'/>
    <text name='Brand' size='18' weight='Bold' fill='#FFFFFF'>AppName</text>
  </frame>
  <frame name='Center' layout='row' gap='32' alignItems='center' width='hug' height='hug' bg='transparent'>
    <text name='Link Active' size='14' weight='Medium' fill='#FFFFFF'>Dashboard</text>
    <text name='Link' size='14' fill='#9CA3AF'>Projects</text>
    <text name='Link' size='14' fill='#9CA3AF'>Team</text>
  </frame>
  <frame name='Right' layout='row' gap='16' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Bell' icon='lucide:bell' size='20' fill='#9CA3AF'/>
    <frame name='Avatar' w='32' h='32' corner='16' bg='#374151'/>
  </frame>
</frame>
```

### Sidebar Navigation

```xml
<frame name='Sidebar' layout='column' w='240' height='fill' bg='#0F172A' p='16'>
  <frame name='Logo' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent' p='0 0 16 0'>
    <icon name='Logo' icon='lucide:layout-dashboard' size='24' fill='#FFFFFF'/>
    <text name='Brand' size='18' weight='Bold' fill='#FFFFFF'>Admin</text>
  </frame>
  <line name='Divider' w='fill' stroke='#1E293B'/>
  <frame name='Nav Group' layout='column' gap='4' width='fill' height='hug' bg='transparent' p='16 0'>
    <text name='Group Label' size='12' weight='Medium' fill='#64748B' p='0 12 8 12'>MAIN</text>
    <frame name='Nav Active' layout='row' gap='12' alignItems='center' p='10 12' width='fill' height='hug' bg='#1E293B' corner='8'>
      <icon name='Icon' icon='lucide:home' size='20' fill='#3B82F6'/>
      <text name='Label' size='14' weight='Medium' fill='#F1F5F9'>Dashboard</text>
    </frame>
    <frame name='Nav Item' layout='row' gap='12' alignItems='center' p='10 12' width='fill' height='hug' bg='transparent' corner='8'>
      <icon name='Icon' icon='lucide:bar-chart-2' size='20' fill='#94A3B8'/>
      <text name='Label' size='14' fill='#94A3B8'>Analytics</text>
    </frame>
    <frame name='Nav Item' layout='row' gap='12' alignItems='center' p='10 12' width='fill' height='hug' bg='transparent' corner='8'>
      <icon name='Icon' icon='lucide:users' size='20' fill='#94A3B8'/>
      <text name='Label' size='14' fill='#94A3B8'>Users</text>
    </frame>
  </frame>
  <frame name='Spacer' width='fill' height='fill' bg='transparent'/>
  <frame name='User' layout='row' gap='12' alignItems='center' p='12' width='fill' height='hug' bg='#1E293B' corner='8'>
    <frame name='Avatar' w='32' h='32' corner='16' bg='#334155'/>
    <frame name='Info' layout='column' gap='2' width='fill' height='hug' bg='transparent'>
      <text name='Name' size='14' weight='Medium' fill='#F1F5F9'>John Doe</text>
      <text name='Email' size='12' fill='#64748B'>john@company.com</text>
    </frame>
  </frame>
</frame>
```

### Tab Bar

```xml
<frame name='Tab Bar' layout='row' gap='0' width='fill' height='hug' bg='#FFFFFF' stroke='#E5E7EB' strokeW='1'>
  <frame name='Tab Active' layout='column' alignItems='center' p='12 20' width='hug' height='hug' bg='transparent'>
    <text name='Label' size='14' weight='Medium' fill='#4F46E5'>Overview</text>
    <rect name='Indicator' width='fill' h='2' bg='#4F46E5'/>
  </frame>
  <frame name='Tab' layout='column' alignItems='center' p='12 20' width='hug' height='hug' bg='transparent'>
    <text name='Label' size='14' fill='#6B7280'>Analytics</text>
  </frame>
  <frame name='Tab' layout='column' alignItems='center' p='12 20' width='hug' height='hug' bg='transparent'>
    <text name='Label' size='14' fill='#6B7280'>Settings</text>
  </frame>
</frame>
```

### Breadcrumbs

```xml
<frame name='Breadcrumbs' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'>
  <text name='Home' size='14' fill='#6B7280'>Home</text>
  <icon name='Sep' icon='lucide:chevron-right' size='14' fill='#D1D5DB'/>
  <text name='Parent' size='14' fill='#6B7280'>Projects</text>
  <icon name='Sep' icon='lucide:chevron-right' size='14' fill='#D1D5DB'/>
  <text name='Current' size='14' weight='Medium' fill='#111827'>Dashboard</text>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Navbar height | `64` px |
| Navbar padding | `12 24` px |
| Sidebar width | `240` px |
| Sidebar padding | `16` px |
| Nav item padding | `10 12` px |
| Nav item gap | `4` px |
| Nav item corner | `8` px |
| Nav link gap (horizontal) | `32` px |
| Tab padding | `12 20` px |
| Tab indicator height | `2` px |
| Breadcrumb gap | `8` px |
| Light nav bg | `#FFFFFF` |
| Dark nav bg | `#111827` or `#0F172A` |
| Active link color (light) | `#111827` + `Medium` weight |
| Active link color (dark) | `#FFFFFF` + `Medium` weight |
| Inactive link color (light) | `#6B7280` |
| Inactive link color (dark) | `#94A3B8` |
| Active nav item bg (sidebar) | `#1E293B` |
| Active accent | `#3B82F6` (icon), `#4F46E5` (tab indicator) |
| Navbar shadow | `0,1,3,0,#0000000D` |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| Navbar without fixed height | Use `h='64'` — hug can cause height jumps |
| Sidebar without `height='fill'` | Sidebar must stretch to fill viewport: `height='fill'` |
| Nav links without gap | Horizontal nav links: `gap='32'` for breathing room |
| Active state same as inactive | Active: `weight='Medium'` + darker color; sidebar: `bg='#1E293B'` |
| No separator between nav groups | Use `<line>` divider or group labels between sections |
| Tab indicator missing | Active tab needs a `2px` colored rect at bottom |
| Breadcrumb without chevron separators | Use `lucide:chevron-right` between items, `14px` |
