---
id: guideline:landing-page
name: Landing Page Design Guideline
description: Use when designing marketing pages, SaaS homepages, product launches, service pages, or waitlist screens — covers hero, features, CTA sections, 1440px layout, and conversion patterns.
category: guideline
tags: [landing-page, marketing, hero, cta, saas, homepage]
---

# Landing Page Design Guidelines

## 1. Purpose & Scope

**Use for**: Marketing pages, product landing pages, SaaS homepages, service pages, waitlist/coming soon pages.

**Do NOT use for**: Admin dashboards, data-heavy screens, app interiors (use dashboard or form guidelines).

**Root frame**: `w='1440'` — standard desktop viewport. Sections stack vertically.

## 2. Layout Template

```
+------------------1440px------------------+
|  Navbar (full width, fixed height)        |
|  Logo   Nav Links         CTA Button      |
+-------------------------------------------+
|  Hero Section (full width, center)        |
|     Headline (32-48px Bold)               |
|     Subheadline (18-20px)                 |
|     [CTA Button]  [Secondary CTA]        |
+-------------------------------------------+
|  Features Section (max 1200px centered)   |
|  +--------+ +--------+ +--------+        |
|  | Icon   | | Icon   | | Icon   |        |
|  | Title  | | Title  | | Title  |        |
|  | Desc   | | Desc   | | Desc   |        |
|  +--------+ +--------+ +--------+        |
+-------------------------------------------+
|  Social Proof / Testimonials              |
+-------------------------------------------+
|  CTA Section (call to action repeat)      |
+-------------------------------------------+
|  Footer                                   |
+-------------------------------------------+
```

### XML Skeleton — copy and modify:

```xml
<frame name='Landing Page' layout='column' alignItems='center' w='1440' height='hug' bg='#FFFFFF'>
  <frame name='Navbar' layout='row' justifyContent='space-between' alignItems='center' p='16 80' width='fill' height='hug' bg='#FFFFFF'>
    {/* Logo, nav links, CTA */}
  </frame>
  <frame name='Hero' layout='column' gap='24' alignItems='center' p='80 120' width='fill' height='hug' bg='#F9FAFB'>
    {/* Headline, subheadline, CTA buttons */}
  </frame>
  <frame name='Features' layout='column' gap='48' alignItems='center' p='80 120' width='fill' height='hug' bg='#FFFFFF'>
    {/* Section title + feature grid */}
  </frame>
  <frame name='Testimonials' layout='column' gap='48' alignItems='center' p='80 120' width='fill' height='hug' bg='#F9FAFB'>
    {/* Testimonial cards */}
  </frame>
  <frame name='CTA Section' layout='column' gap='24' alignItems='center' p='80 120' width='fill' height='hug' bg='#4F46E5'>
    {/* Final call to action */}
  </frame>
  <frame name='Footer' layout='row' justifyContent='space-between' p='40 80' width='fill' height='hug' bg='#111827'>
    {/* Footer content */}
  </frame>
</frame>
```

## 3. Component Patterns

### Navbar

```xml
<frame name='Navbar' layout='row' justifyContent='space-between' alignItems='center' p='16 80' width='fill' height='hug' bg='#FFFFFF' shadow='0,1,3,0,#0000000D'>
  <frame name='Logo' layout='row' gap='8' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Logo Icon' icon='lucide:zap' size='24' fill='#4F46E5'/>
    <text name='Brand' size='20' weight='Bold' fill='#111827'>BrandName</text>
  </frame>
  <frame name='Nav Links' layout='row' gap='32' alignItems='center' width='hug' height='hug' bg='transparent'>
    <text name='Link 1' size='14' weight='Medium' fill='#374151'>Features</text>
    <text name='Link 2' size='14' fill='#6B7280'>Pricing</text>
    <text name='Link 3' size='14' fill='#6B7280'>About</text>
  </frame>
  <frame name='CTA' layout='row' justifyContent='center' alignItems='center' p='10 20' width='hug' height='hug' bg='#4F46E5' corner='8'>
    <text name='Label' size='14' weight='Medium' fill='#FFFFFF'>Get Started</text>
  </frame>
</frame>
```

### Hero Section

```xml
<frame name='Hero' layout='column' gap='24' alignItems='center' p='80 120' width='fill' height='hug' bg='#F9FAFB'>
  <frame name='Badge' layout='row' p='6 16' width='hug' height='hug' bg='#EEF2FF' corner='20'>
    <text name='Badge Text' size='14' weight='Medium' fill='#4F46E5'>New: AI-powered features</text>
  </frame>
  <text name='Headline' size='48' weight='Bold' fill='#111827' width='800' textAlign='center' lineHeight='120%'>Build Better Products Faster</text>
  <text name='Subheadline' size='18' fill='#6B7280' width='600' textAlign='center' lineHeight='160%'>The all-in-one platform that helps teams design, build, and ship world-class products.</text>
  <frame name='CTA Group' layout='row' gap='16' alignItems='center' width='hug' height='hug' bg='transparent'>
    <frame name='Primary CTA' layout='row' justifyContent='center' alignItems='center' p='14 28' width='hug' height='hug' bg='#4F46E5' corner='8'>
      <text name='Label' size='16' weight='Bold' fill='#FFFFFF'>Start Free Trial</text>
    </frame>
    <frame name='Secondary CTA' layout='row' justifyContent='center' alignItems='center' gap='8' p='14 28' width='hug' height='hug' bg='transparent' corner='8' stroke='#D1D5DB' strokeW='1'>
      <text name='Label' size='16' weight='Medium' fill='#374151'>Watch Demo</text>
      <icon name='Play' icon='lucide:play' size='16' fill='#374151'/>
    </frame>
  </frame>
</frame>
```

### Feature Grid (3 columns)

```xml
<frame name='Features' layout='column' gap='48' alignItems='center' p='80 120' width='fill' height='hug' bg='#FFFFFF'>
  <frame name='Section Header' layout='column' gap='12' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Eyebrow' size='14' weight='Bold' fill='#4F46E5' textTransform='uppercase'>Features</text>
    <text name='Title' size='36' weight='Bold' fill='#111827' textAlign='center'>Everything you need</text>
    <text name='Subtitle' size='18' fill='#6B7280' width='600' textAlign='center'>Powerful tools designed to streamline your workflow.</text>
  </frame>
  <frame name='Grid' layout='row' gap='32' width='fill' height='hug' bg='transparent'>
    <frame name='Feature 1' layout='column' gap='16' p='24' width='fill' height='hug' bg='transparent'>
      <frame name='Icon Wrapper' layout='row' justifyContent='center' alignItems='center' w='48' h='48' bg='#EEF2FF' corner='12'>
        <icon name='Icon' icon='lucide:zap' size='24' fill='#4F46E5'/>
      </frame>
      <text name='Title' size='18' weight='Bold' fill='#111827'>Lightning Fast</text>
      <text name='Description' size='14' fill='#6B7280' lineHeight='160%' width='fill'>Deploy in seconds with our optimized infrastructure and global CDN.</text>
    </frame>
    {/* Feature 2 and 3 follow the same pattern */}
  </frame>
</frame>
```

### Testimonial Card

```xml
<frame name='Testimonial' layout='column' gap='16' p='24' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <text name='Quote' size='16' fill='#374151' lineHeight='160%' width='fill'>"This tool has completely transformed how our team works. We shipped 3x faster."</text>
  <frame name='Author' layout='row' gap='12' alignItems='center' width='fill' height='hug' bg='transparent'>
    <frame name='Avatar' w='40' h='40' corner='20' bg='#E5E7EB'/>
    <frame name='Info' layout='column' gap='2' width='hug' height='hug' bg='transparent'>
      <text name='Name' size='14' weight='Medium' fill='#111827'>Sarah Chen</text>
      <text name='Role' size='12' fill='#6B7280'>CTO at TechCorp</text>
    </frame>
  </frame>
</frame>
```

### CTA Section (dark/brand background)

```xml
<frame name='CTA Section' layout='column' gap='24' alignItems='center' p='80 120' width='fill' height='hug' bg='#4F46E5'>
  <text name='Headline' size='36' weight='Bold' fill='#FFFFFF' textAlign='center'>Ready to get started?</text>
  <text name='Subtitle' size='18' fill='#C7D2FE' textAlign='center'>Join 10,000+ teams already using our platform.</text>
  <frame name='CTA Button' layout='row' justifyContent='center' alignItems='center' p='14 28' width='hug' height='hug' bg='#FFFFFF' corner='8'>
    <text name='Label' size='16' weight='Bold' fill='#4F46E5'>Start Free Trial</text>
  </frame>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Page width | `1440` px |
| Navbar padding | `16 80` px |
| Section padding | `80 120` px |
| Section gap (between sections) | `0` (sections are self-padded) |
| Content max-width (text) | `600`–`800` px via explicit `width` |
| Feature grid gap | `32` px |
| Feature icon size | `48` px wrapper, `24` px icon |
| Headline size | `48` px, `Bold` |
| Subheadline size | `18` px, `Regular` |
| Body text line-height | `160%` |
| Section title | `36` px, `Bold` |
| Eyebrow text | `14` px, `Bold`, primary color |
| Primary CTA padding | `14 28` px |
| Alternating backgrounds | `#FFFFFF` and `#F9FAFB` |
| Brand color | `#4F46E5` (indigo) |
| Text primary | `#111827` |
| Text secondary | `#6B7280` |
| CTA section bg | `#4F46E5` |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| Headline > 800px width | Constrain to `width='800'` for readable line length |
| No alternating section backgrounds | Alternate `#FFFFFF` and `#F9FAFB` for visual rhythm |
| CTA buttons same style as nav links | CTAs: filled bg + bold text; links: text only |
| Features in a column (not grid) | Feature grid: `layout='row'` with `width='fill'` per card |
| Section without padding | Every section needs `p='80 120'` (vertical horizontal) |
| No eyebrow/label above section titles | Add category label: `14px Bold` in brand color |
| Footer same bg as content | Footer: `bg='#111827'` (dark) to visually close the page |
