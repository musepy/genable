# Skill-Based Prompt System

## Overview

The Skill-Based Prompt System is a modular architecture for composing LLM prompts dynamically based on context and user intent. It replaces the previous monolithic prompt system with an extensible, plugin-like approach.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentOrchestrator                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              SkillRegistry (Singleton)               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ Figma   │ │ Project │ │ Design  │ │Workflow │   │   │
│  │  │ Core    │ │ UI      │ │Knowledge│ │         │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            skillPromptComposer                       │   │
│  │  • Collects active tools from skills                 │   │
│  │  • Injects dynamic context based on user prompt      │   │
│  │  • Manages token budget                              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Skill Definition

A skill is a modular unit containing:

```typescript
interface SkillDefinition {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  description: string;           // What the skill does
  category: SkillCategory;       // 'figma' | 'knowledge' | 'workflow' | 'integration'
  priority: SkillPriority;       // 1-5, lower = higher priority
  tools: ToolDefinition[];       // Tools provided by this skill
  executors: Record<string, ToolExecutor>; // Tool implementations
  context: SkillContext;         // Prompt injection configuration
  enabledByDefault?: boolean;
  activationConditions?: SkillActivationCondition[];
}
```

### Context Injection Types

| Type | Description | Example |
|------|-------------|---------|
| `system` | Always injected into system prompt | Figma Core operations |
| `dynamic` | Injected based on trigger patterns | Project UI Context (triggers on "button", "component") |
| `on-demand` | Only when explicitly requested | Workflow tools |

### Trigger Patterns

Skills with `dynamic` injection define patterns that activate their context:

```typescript
triggerPatterns: [
  'button', 'header', 'card', 'component',
  '组件', '按钮',  // Chinese support
  'design system', '设计系统'
]
```

## Registered Skills

### 1. Figma Core (`figma-core`)
**Priority:** 1 (Always active)
**Injection:** `system`

Core Figma manipulation capabilities:
- `createNode` - Create FRAME, TEXT, etc.
- `setNodeLayout` - Configure Auto Layout
- `setNodeStyles` - Apply fills, strokes, corners
- `getSelection` - Read current selection
- `getDeepHierarchy` - Get node tree
- `validateLayout` - Validate layout rules

### 2. Project UI Context (`project-ui-context`)
**Priority:** 2
**Injection:** `dynamic`

Provides context about existing project UI:
- `getProjectUIContext` - Get component metadata
- `getDesignSystemTokens` - Get design tokens
- `listProjectComponents` - List available components

**Triggers on:** button, header, card, component, design system, etc.

### 3. Design Knowledge (`design-knowledge`)
**Priority:** 3
**Injection:** `dynamic`

Access to design knowledge base:
- `searchDesignKnowledge` - Find UI patterns
- `getComponentAnatomy` - Get structural blueprints
- `getFigmaLayoutRules` - Get layout guidelines

**Triggers on:** pattern, best practice, anatomy, guideline, etc.

### 4. Workflow (`workflow`)
**Priority:** 4
**Injection:** `on-demand`

Task and workflow management tools.

## File Structure

```
src/engine/agent/skills/
├── types.ts                    # Core type definitions
├── SkillRegistry.ts            # Singleton registry
├── skillPromptComposer.ts      # Prompt composition logic
├── index.ts                    # Module entry point
└── definitions/
    ├── figmaCoreSkill.ts       # Figma operations
    ├── projectUISkill.ts       # Project UI context
    └── knowledgeSkill.ts       # Design knowledge

src/knowledge/
└── projectUIRegistry.ts        # Static UI component registry

src/engine/agent/tools/
└── projectUITools.ts           # Project UI context tools
```

## Usage

### Enabling the Skill System

In `AgentOrchestrator.ts`:

```typescript
const USE_SKILL_SYSTEM = true;
```

### Adding a New Skill

1. Create skill definition in `src/engine/agent/skills/definitions/`:

```typescript
export const mySkill: SkillDefinition = {
  id: 'my-skill',
  name: 'My Skill',
  description: 'Description',
  category: 'integration',
  priority: 3,
  tools: [myToolDefinition],
  executors: { myTool: myToolExecutor },
  context: {
    injectionType: 'dynamic',
    triggerPatterns: ['keyword1', 'keyword2'],
    systemPromptSection: `## MY SKILL\nGuidance here...`,
  },
  enabledByDefault: true,
};
```

2. Register in `src/engine/agent/skills/index.ts`:

```typescript
import { mySkill } from './definitions/mySkill';

export function initializeSkills(): void {
  // ... existing registrations
  skillRegistry.register(mySkill);
}
```

3. Add tool handler in `src/ipc/handlers/toolCallHandler.ts` if needed.

## Project UI Registry

The `projectUIRegistry.ts` contains static metadata about project UI components:

```typescript
export const PROJECT_UI_REGISTRY: Record<string, UIComponentMeta> = {
  'Button': {
    name: 'Button',
    path: 'src/ui/components/Button.tsx',
    props: ['variant', 'size', 'disabled', 'loading', 'icon', 'iconPosition'],
    variants: {
      primary: { bg: 'var(--accent-9)', color: 'white' },
      outline: { bg: 'transparent', border: '1px solid var(--gray-6)' },
      // ...
    },
    figmaMapping: {
      nodeType: 'FRAME',
      layoutMode: 'HORIZONTAL',
      defaultProps: { height: 40, paddingHorizontal: 16, gap: 4, borderRadius: 6 }
    }
  },
  // ... other components
};
```

## Token Budget Management

The system manages prompt size within a token budget:

```typescript
const totalBudget = calculateBudget({ totalTokens: 4000 });
systemPrompt = composeSkillBasedPrompt(deps, provider, {
  budget: { total: totalBudget }
});
```

## Testing

Run the test script:

```bash
node -e "
const { initializeSkills, skillRegistry, getActiveAgentTools } = require('./src/engine/agent/skills');
initializeSkills();
console.log('Skills:', skillRegistry.getAll().length);
console.log('Tools:', getActiveAgentTools().length);
"
```

Expected output:
- 4 skills registered
- 23+ active tools
- Dynamic context injection based on prompt keywords

## Benefits

1. **Modularity** - Skills can be added/removed independently
2. **Dynamic Context** - Only relevant context is injected
3. **Token Efficiency** - Budget-aware prompt composition
4. **Extensibility** - Easy to add new capabilities
5. **Maintainability** - Clear separation of concerns

## Related Changes

### UI Updates (Figma Design Sync)

- `Button.tsx`: Font size changed to `13px`
- `globalStyles.ts`:
  - Header chip updated to Outline style (6px border-radius)
  - Button pressed states added (.btn-primary, .btn-outline, .btn-ghost)
