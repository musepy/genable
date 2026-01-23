---
description: UX 审计与完美化工作流 (Zero Bugs, Perfect Usability, Flawless UX)
---

# /ux-designer Workflow

> **Goal**: Zero bugs, perfect usability, flawless user experience.
> Use when: "perfect the UI", "fix UX bugs", "improve demo", "make it flawless"

---

## 🎯 When to Invoke

This workflow applies when:
- User mentions: "perfect the demo", "fix UX bugs", "make it flawless"
- UI has inconsistencies or bugs
- User experience is confusing or broken
- Interactive elements don't work properly

---

## 📋 Phase 1: Code-Level UX Audit

### 1.1 Design Token Check

**Goal**: No hardcoded values anywhere

```bash
# Search for hardcoded colors (should be 0 matches in src/ui)
grep -rn "#[0-9a-fA-F]\{6\}" src/ui --include="*.tsx" --include="*.ts" | grep -v tokens.ts

# Search for hardcoded spacing
grep -rn "padding: [0-9]" src/ui --include="*.tsx" | grep -v tokens

# Search for hardcoded font sizes
grep -rn "fontSize: [0-9]" src/ui --include="*.tsx" | grep -v tokens
```

**Reference**: `src/ui/tokens.ts` - All tokens defined here

### 1.2 State Machine Completeness

**Goal**: Every element has defined behavior in every state

| State | Description | Elements to Check |
|-------|-------------|-------------------|
| EMPTY | Initial, no history | Submit disabled, chips visible |
| TYPING | User typing | Submit enabled |
| LOADING | Generating | Submit disabled, textarea readonly |
| RESULT | Post-generation | Navigation enabled |

**Reference**: `src/ui/interactionStates.ts` - State machine

### 1.3 Component Audit Checklist

For each component in `src/ui/components/`:

- [ ] Uses design tokens (no hardcoded values)
- [ ] Supports dark mode (uses CSS variables)
- [ ] Has hover/focus/active states
- [ ] Has loading state (if async)
- [ ] Has error state (if can fail)
- [ ] Has ARIA attributes (accessibility)

---

## 📋 Phase 2: Interaction Audit

### 2.1 Input Handling

- [ ] IME composition handled (CJK languages)
- [ ] Keyboard shortcuts work (Cmd/Ctrl+Enter)
- [ ] Auto-resize on content growth
- [ ] Placeholder visible

### 2.2 Button States

| State | Visual Feedback |
|-------|-----------------|
| Enabled | Full opacity, cursor pointer |
| Hovered | Border/background change |
| Disabled | Reduced opacity, cursor default |
| Loading | Spinner or dots, no interaction |

### 2.3 Popover Behavior

- [ ] Click outside closes
- [ ] ESC key closes
- [ ] Focus trapped inside
- [ ] Selection triggers action
- [ ] Smooth animation in/out

---

## 📋 Phase 3: Accessibility Audit

### 3.1 ARIA Attributes

```typescript
// Example from interactionStates.ts
export function getAriaProps(elementName, pluginState, loading) {
  return {
    'aria-disabled': !enabled ? true : undefined,
    'aria-busy': loading ? true : undefined,
  };
}
```

### 3.2 Keyboard Navigation

- [ ] All interactive elements focusable
- [ ] Focus ring visible (`:focus-visible`)
- [ ] Tab order logical
- [ ] Enter/Space triggers actions
- [ ] ESC closes modals/popovers

### 3.3 Color Contrast

Check WCAG AA compliance (4.5:1 for text):

| Token Pair | Check |
|------------|-------|
| `foreground` on `background` | ✅ Verify |
| `mutedForeground` on `muted` | ✅ Verify |
| `primary` on `primaryForeground` | ✅ Verify |

---

## 📋 Phase 4: Performance Audit

### 4.1 Animation Performance

```css
/* ✅ Good: GPU-accelerated */
transform: translateX(-100px);
opacity: 0;

/* ❌ Bad: Layout thrashing */
margin-left: -100px;
width: 0;
```

### 4.2 Render Optimization

- [ ] No unnecessary re-renders
- [ ] Memoization where appropriate
- [ ] Event listeners cleaned up

---

## 📋 Phase 5: Figma Plugin Specific

### 5.1 Figma Theme Integration

Plugin should respect Figma's theme:

```json
// manifest.json
{
  "themeColors": true
}
```

### 5.2 Message Passing

- [ ] All handlers registered (`on<Handler>`)
- [ ] All emits have corresponding receivers
- [ ] Error handling in async handlers

### 5.3 Selection Context

- [ ] Real-time selection listener works
- [ ] Selection tags update on change
- [ ] Styles extracted correctly

---

## 🧪 Verification Steps

### Build Verification

```bash
cd "/Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator"
npm run build
```

### Manual Testing in Figma

1. **Open Plugin**: Figma → Plugins → Development → Genable
2. **Theme Toggle**: Switch light/dark, verify all elements update
3. **Model Popover**: Open, select model, verify closes
4. **Input Area**: Type, verify auto-resize
5. **Submit**: Cmd+Enter, verify loading state
6. **Error**: Invalid API key, verify error display
7. **Selection**: Select elements, verify tags appear

---

## 📊 Audit Report Template

After completing audit:

```markdown
## UX Audit Report

**Status**: [PERFECT ✅ / NEEDS FIXES ⚠️ / CRITICAL ❌]

### Issues Found

#### Critical 🔴
(List issues that break functionality)

#### Important 🟡
(List issues that hurt usability)

#### Polish 🟢
(List nice-to-have improvements)

### UX Score

| Category | Score | Notes |
|----------|-------|-------|
| Functionality | X/10 | |
| Visual Design | X/10 | |
| Usability | X/10 | |
| Accessibility | X/10 | |
| Performance | X/10 | |

**Overall**: X/50 - Grade: [A+ to F]
```

---

## 📚 Related Resources

- Design Tokens: `src/ui/tokens.ts`
- State Machine: `src/ui/interactionStates.ts`
- UI Development: `.agent/workflows/ui-development.md`
- Debug: `.agent/workflows/debug-workflow.md`
