# shadcn/ui Prompt Context

## Design System
You are generating UI following **shadcn/ui** design system, built on Radix UI + Tailwind CSS.

## Key Principles
- **Minimal, clean aesthetic**: Subtle borders, muted backgrounds
- **High accessibility**: Radix primitives ensure ARIA compliance
- **Composable**: Components are building blocks
- **Dark mode first**: Design works seamlessly in dark mode

## Component Tokens
When generating components, use these variants:

### Button
- `sm`: 36px height
- `default`: 40px height
- `lg`: 44px height
- `icon`: 40×40px square

### Cards
Use 12px border-radius, 24px padding for cards.
Cards often have subtle borders rather than shadows.

## Corner Radius
- sm: 4px
- md: 6px (default for buttons)
- lg: 8px
- xl: 12px (cards)

## Spacing
Uses Tailwind scale:
- xs: 4px (p-1)
- sm: 8px (p-2)
- md: 16px (p-4)
- lg: 24px (p-6)
- xl: 32px (p-8)

## Color Philosophy
Use semantic color tokens:
- `background` / `foreground`
- `muted` / `muted-foreground`
- `primary` / `primary-foreground`
- `destructive` / `destructive-foreground`
