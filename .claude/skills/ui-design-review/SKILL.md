---
name: ui-design-review
description: "UI Design Review — Plugin Interface Principles"
trigger: (ui.*review|design.*review|界面.*审查|视觉.*检查|UI.*check|polish.*ui|打磨)
---

# UI Design Review — Preview-First Workflow

Fixes UI bugs and polishes the plugin interface. **Must** reproduce in local preview before touching code, verify after fix with screenshots, then build.

## Workflow

### Phase 1: Reproduce (复现)

1. Start local preview:
   ```bash
   npm run preview
   ```
2. Open in browser, navigate to the affected screen/state
3. **Screenshot** the bug state → save to `docs/knowledge/ui-fixes/` as `{date}-{issue}-before.png`
4. If the bug requires specific state (e.g., provider=dashscope, running agent), use preview's simulation controls or mock data in `preview/main.tsx`

### Phase 2: Fix (修复)

1. Edit source files — Vite HMR auto-refreshes the preview
2. Check the fix in browser immediately after each change
3. For state-dependent bugs, verify multiple states (empty, loading, active, error)

### Phase 3: Verify (验证)

1. **Screenshot** the fixed state → save as `{date}-{issue}-after.png`
2. Check related screens for regressions (e.g., settings change → check onboarding too)
3. Toggle dark mode — verify fix works in both themes
4. Resize the plugin frame — verify no overflow/clipping

### Phase 4: Build (构建)

Only after preview verification passes:
```bash
npx tsc --noEmit && node build.js
```

## Key Files

| File | Purpose |
|------|---------|
| `preview/main.tsx` | Preview entry — Figma API mocks, simulation controls |
| `preview/index.html` | Preview shell — 320x600 plugin frame |
| `tools/ui-preview/index.html` | Static 4-screen reference (update when UI changes significantly) |
| `tools/ui-preview/component-audit.html` | Visual catalog of all active components (19) with rendered mockups |
| `tools/ui-preview/transition-audit-v2.html` | Animation/transition audit with live interactive demos |
| `tools/ui-preview/i18n-audit.html` | i18n string coverage across EN/ZH/FR with rendered screens |
| `tools/ui-preview/locale-dropdown.html` | Before/After for locale selector redesign |
| `src/ui/design-system/tokens/` | Design tokens — colors, spacing, typography |
| `src/ui/design-system/tokens/css.ts` | CSS custom properties (Radix scales, light/dark) |
| `src/ui/design-system/tokens/globalStyles.ts` | Global CSS classes (hover, animation, keyframes) |
| `src/ui/components/` | Shared UI components |
| `src/features/chat/index.tsx` | Main chat view |

## Design Principles

### Block-based chat stream
- Messages are rendered as typed blocks: `TextBlock`, `ToolBlock`, `StatusBlock`, `NodeListPanel`
- Each block is a self-contained row with consistent padding (`4px 10px`)
- Spacing between blocks: `4px` (space-1), between turns: `8px` (space-2)

### Visual hierarchy
- User messages: `background: var(--gray-3)`, `border-radius: var(--radius-3)`
- Assistant text: no background, plain text with markdown rendering
- Tool blocks: collapsible, secondary color (`var(--gray-11)`)
- Status: shimmer animation for running, muted for completed

### Interaction patterns
- Hover: `background: var(--gray-a2)`, `120ms` transition
- Click expand: `grid-template-rows` animation, `220ms` ease
- Settings overlay: `slideIn/slideOut` animation, `200ms` cubic-bezier
- Submit button: `var(--gray-12)` background (not accent blue)

### Dark mode
- All colors via CSS custom properties (Radix scales)
- Light/dark swap on `[data-theme]` attribute
- Test both themes for every fix

## Anti-patterns (avoid)

- **Never build-first** — always preview-verify before `node build.js`
- **Never fix without screenshot evidence** — before/after screenshots are the proof
- **Never change globalStyles.ts for component-specific fixes** — use inline styles via `tokens`
- **Never add CSS classes for one-off styling** — classes are for pseudo-states and animations only
