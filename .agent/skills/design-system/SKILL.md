---
id: design-system
name: Design System Creation
description: Create and manage Figma design systems with variables, collections, modes, component variants, and bindings
category: figma
priority: 3
injectionType: dynamic
tools:
  - var
  - comp
triggerPatterns:
  - variable
  - design token
  - design system
  - theme
  - dark mode
  - light mode
  - color scheme
  - brand guide
  - brand guidelines
  - 变量
  - 主题
  - 暗色模式
  - 亮色模式
  - 设计系统
  - 品牌指南
  - 设计规范
enabledByDefault: true
---

## DESIGN SYSTEM — Variables, Modes & Component Variants

When creating a design system (brand guidelines, token system, theme), use `var` and `comp` commands instead of creating flat text/frame representations.

### Workflow: Complete Design System from Brand Guide

1. **Create variable collections** with modes:
```
var mk --collection Colors
var mk --collection Theme --modes Light,Dark
var mk --collection Spacing
var mk --collection Typography
```

2. **Create primitive color variables**:
```
var mk Colors/primary COLOR #1A1A1A
var mk Colors/secondary COLOR #666666
var mk Colors/muted COLOR #999999
var mk Colors/surface COLOR #F5F5F5
var mk Colors/border COLOR #E5E7EB
```

3. **Create semantic tokens as aliases** (reference primitives):
```
var alias Theme/text-primary Colors/primary
var alias Theme/text-secondary Colors/secondary
var alias Theme/bg-surface Colors/surface
var alias Theme/border-default Colors/border
```

4. **Create spacing scale**:
```
var mk Spacing/xs FLOAT 8
var mk Spacing/sm FLOAT 16
var mk Spacing/md FLOAT 32
var mk Spacing/lg FLOAT 60
var mk Spacing/xl FLOAT 80
```

5. **Create typography tokens**:
```
var mk Typography/h1-size FLOAT 48
var mk Typography/h2-size FLOAT 36
var mk Typography/h3-size FLOAT 24
var mk Typography/body-size FLOAT 16
var mk Typography/caption-size FLOAT 12
```

6. **Create components** with proper structure:
```
mk /Button/Primary frame layout:row alignMain:center alignCross:center p:'16 32' bg:#1A1A1A
mk /Button/Primary/Label text size:16 weight:Medium fill:#FFF -- Primary Button

mk /Button/Secondary frame layout:row alignMain:center alignCross:center p:'16 32' stroke:#1A1A1A strokeW:1
mk /Button/Secondary/Label text size:16 weight:Medium fill:#1A1A1A -- Secondary Button

comp create /Button/Primary
comp create /Button/Secondary
comp combine /Button/Primary /Button/Secondary --name Button
comp prop /Button/ Label TEXT "Button"
```

7. **Bind variables to design nodes**:
```
var bind /Card/ fills Theme/bg-surface
var bind /Card/ itemSpacing Spacing/md
var bind /Card/Title fontSize Typography/h3-size
var bind /Card/Title fills Theme/text-primary
```

### Variable Types Reference

| Type    | Value Format | Example |
|---------|-------------|---------|
| COLOR   | #hex, rgb(), rgba() | `#1A1A1A`, `rgb(26,26,26)` |
| FLOAT   | number (px) | `16`, `24px` |
| BOOLEAN | true/false  | `true` |
| STRING  | text        | `Inter` |

### Bind Property Names

| Shorthand | Figma Property | Variable Type |
|-----------|---------------|---------------|
| fills, bg | fills (paint) | COLOR |
| strokes, stroke | strokes (paint) | COLOR |
| fontSize, font-size | fontSize | FLOAT |
| gap | itemSpacing | FLOAT |
| padding | paddingTop | FLOAT |
| padding-top/right/bottom/left | paddingTop/Right/Bottom/Left | FLOAT |
| corner, corner-radius | cornerRadius | FLOAT |
| opacity | opacity | FLOAT |
| visible | visible | BOOLEAN |
| width, height | width, height | FLOAT |

### Theme Modes (Light/Dark)

For multi-mode variables, set values per mode:
```
var mk --collection Theme --modes Light,Dark
var mk Theme/bg-primary COLOR #FFFFFF --mode Light
var mk Theme/bg-primary COLOR #1A1A1A --mode Dark
var mk Theme/text-primary COLOR #1A1A1A --mode Light
var mk Theme/text-primary COLOR #FFFFFF --mode Dark
```

### Component Variant Workflow

1. Create individual variant frames with `mk`
2. Convert each to component: `comp create /path/`
3. Combine into variant set: `comp combine /path1/ /path2/ --name Name`
4. Add configurable properties: `comp prop /Set/ PropName TYPE default`
5. Create instances: `comp instance /Set/ --parent /target/`

### Key Rules

- **Variables before nodes**: Create all variables FIRST, then create design nodes, then bind
- **Aliases for semantics**: Use `var alias` for semantic tokens → primitive tokens (not hardcoded values)
- **Verify with `var ls`**: Check created variables are correct before binding
- **Verify with `comp ls`**: Check component properties after creation
- **Collections organize by concern**: Colors, Spacing, Typography, Theme (not by component)
