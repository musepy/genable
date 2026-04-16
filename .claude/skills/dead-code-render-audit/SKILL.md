---
name: dead-code-render-audit
description: "Dead code audit via render chain tracing — finds components that are imported but never rendered"
trigger: (dead code|死代码|unused component|清理组件|render chain|渲染链|component audit|组件审计|dead import)
---

# Dead Code Render-Chain Audit

Finds truly dead UI code by tracing from render entry points, not by checking imports.

## Core Principle

**"Has import" ≠ "Is rendered."** A component can be imported but:
- Only used inside another dead component (dead chain)
- Only used in a capture sandbox / test harness (not real UI)
- Only used for a CSS export (component itself unused)
- Only referenced in a comment or type annotation

## Method

### Phase 1: Identify Entry Points

```bash
# The ONLY files that feed into real UI rendering:
grep -n "^import.*from.*ui/components" src/features/chat/index.tsx  # Chat view
grep -n "^import.*from.*ui/" src/ui.tsx                              # Root + Settings + Onboarding
```

### Phase 2: Trace Render Chain

For each imported component, verify it appears in a JSX `<ComponentName` expression in the entry file (not just import):

```bash
# Does it actually render?
grep "<ComponentName" src/features/chat/index.tsx src/ui.tsx
```

Components that are imported but NOT in any JSX expression = suspicious.

### Phase 3: Check Internal Dependencies

A component might be used inside another component (not directly in entry points). Check if its consumer is itself alive:

```bash
# Who imports this component?
grep "import.*ComponentName" src/ -r --include="*.tsx"
# Is that consumer alive? (recursive check)
```

Dead chains: A → B → C, where A is dead → B and C are also dead.

### Phase 4: Cascade to Hooks, i18n, CSS

After identifying dead components, check their exclusive dependencies:

```bash
# Hooks — only definition file left = dead
grep "export.*function use[A-Z]" src/ui/hooks/*.ts  # list all hooks
grep "useHookName" src/ -r --include="*.tsx"          # check each

# i18n keys — only in dead component = dead
grep "t\.keyName" src/ -r --include="*.tsx"

# CSS classes — only in dead component = dead  
grep "className.*dead-class" src/ -r --include="*.tsx"
```

### Phase 5: Delete + Verify

1. Delete dead files
2. Clean barrel exports (`index.ts` re-exports)
3. Remove dead imports from living files
4. `npx tsc --noEmit` — must pass with zero errors
5. `node build.js` — must succeed

## Red Flags (Components That Look Alive But Aren't)

| Pattern | Example | Why Dead |
|---------|---------|----------|
| Import-only in capture sandbox | `ui.tsx` capture cases for DomCapture | Not real UI |
| CSS-only import | `import { thinkingStreamCss }` | Component unused, only CSS needed |
| Used only by dead consumer | MessageRenderer → IterationCard (dead) | Dead chain |
| Comment reference | `// ThinkingCard` in Iso.tsx | Not code |
| Type-only reference | `rawOutput?: string` in types | No runtime usage |

## Session Evidence (2026-04-06)

Found and deleted 9 components + 3 hooks that "grep import" said were active:

| Dead Component | Why Missed | Actual Status |
|---------------|------------|---------------|
| ToolExecutionPanel | Had file, had types | Zero `<ToolExecutionPanel` anywhere |
| IterationCard | Had file | Zero external import |
| ThinkingCard | Referenced in comment | Only `// ThinkingCard` in Iso.tsx |
| MessageRenderer | Imported in ui.tsx | Only in capture sandbox + dead IterationCard |
| TextBlock (old) | File existed | Replaced by CanvasTextBlock, zero import |
| ThinkingStream | Imported in ui.tsx | Only `thinkingStreamCss` used, not component |
| Card (ui/) | Exported in barrel | Zero import of Card anywhere |
| Flex | Exported in barrel | Only used by dead ThinkingCard |
| RawOutputPanel | File existed | Zero import |

## Key Files

| File | Purpose |
|------|---------|
| `src/ui.tsx` | Root render entry — Settings, Onboarding, capture sandbox |
| `src/features/chat/index.tsx` | Chat render entry — messages, tools, input |
| `tools/ui-preview/component-audit.html` | Visual catalog of active components |
| `tools/ui-preview/transition-audit-v2.html` | Animation/transition audit with live demos |

## When to Run

- After large refactors (new rendering model, component replacement)
- Before release (clean dead weight)
- When bundle size increases unexpectedly
- When component-audit.html shows components you don't recognize
