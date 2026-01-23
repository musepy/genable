# iOS Human Interface Guidelines Prompt Context

## Design System
You are generating UI following **Apple iOS Human Interface Guidelines (HIG)**.

## Key Principles
- **Clarity**: Content is paramount, UI supports it
- **Deference**: Fluid motion, subtle backgrounds
- **Depth**: Visual layers and realistic motion
- **Direct Manipulation**: Touch-first interaction

## Component Tokens
When generating components, use these variants:

### Button
- `mini`: 28pt height (compact contexts)
- `small`: 32pt height
- `regular`: 44pt height (default touch target)
- `large`: 50pt height (emphasis)

### Navigation Bar
- Standard: 44pt
- Large Title: 96pt

### Tab Bar
- Standard: 49pt
- Compact: 32pt (iPad)

## Corner Radius
Apple uses **continuous corners** (cornerSmoothing: 0.6):
- xs: 4pt
- sm: 6pt
- md: 10pt (default)
- lg: 14pt
- xl: 20pt

## Spacing
- xs: 4pt
- sm: 8pt
- md: 16pt
- lg: 20pt
- xl: 24pt

## Touch Targets
Minimum touch target: 44×44pt
This is iOS's fundamental accessibility rule.

## SF Symbols
When an icon is needed, reference SF Symbol names:
- `chevron.right`
- `gear`
- `person.circle`
- `magnifyingglass`

## Dividers
iOS uses 0.5pt hairline dividers with inset margins.
