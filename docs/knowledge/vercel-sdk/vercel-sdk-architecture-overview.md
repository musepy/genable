# Vercel AI SDK 在 OpenPencil 中的架构全景

> Date: 2026-03-31
> Index: [Vercel AI SDK 评估](vercel-ai-sdk-evaluation-index.md)
> Source: `open-pencil/open-pencil` 仓库真实源码（`ai: ^6.0.116`）
> 定位：全景鸟瞰，各主题的详细分析见索引中链接的子文件

---

## 三层架构拓扑

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: UI 入口 — use-chat.ts (Vue Composable)             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ToolLoopAgent + DirectChatTransport                 │   │
│  │  ├─ model: createModel() → 7+ Provider              │   │
│  │  ├─ tools: createAITools(store)                      │   │
│  │  ├─ stopWhen: stepCountIs(50)                        │   │
│  │  └─ onStepFinish: recordStepUsage()                 │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: 工具桥接 — src/ai/tools.ts                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  createAITools() → toolsToAI() 的钩子配置             │   │
│  │  ├─ onBeforeExecute: store.snapshotPage()            │   │
│  │  ├─ onAfterExecute: loadFont→layout→undo→render     │   │
│  │  ├─ onFlashNodes: aiFlashDone(nodeIds)               │   │
│  │  ├─ onToolLog: runState.toolLog.push(entry)          │   │
│  │  └─ getStepBudget: { current, max }                 │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: 核心适配 — packages/core/src/tools/ai-adapter.ts   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  toolsToAI(): ToolDef[] → AI SDK tool() 对象         │   │
│  │  ├─ ParamDef → valibot → valibotSchema → JSON Schema │   │
│  │  ├─ execute 包装: 前后快照 → noop 检测 → 日志         │   │
│  │  ├─ appendStepWarning: 剩余 ≤5 步时注入 _warning    │   │
│  │  └─ toModelOutput: export_image → 多模态内容          │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: 业务工具 — packages/core/src/tools/*.ts            │
│  CORE_TOOLS (22 个) / EXTENDED_TOOLS (65 个)               │
│  每个工具: defineTool({ name, mutates, params, execute })   │
└─────────────────────────────────────────────────────────────┘
```

---

## SDK 承担 vs 自建增值 速查表

### Vercel AI SDK 承担的 6 个能力

| # | 能力 | SDK 组件 | 代码位置 |
|---|------|---------|---------|
| 1 | Agent 循环 | `ToolLoopAgent` + `stepCountIs()` | use-chat.ts |
| 2 | 多 Provider 适配 | `createModel()` → `LanguageModel` | use-chat.ts |
| 3 | Schema 验证管线 | `paramToValibot()` → `valibotSchema()` → `tool()` | ai-adapter.ts |
| 4 | Chat 会话管理 | `Chat<UIMessage>` + `DirectChatTransport` | use-chat.ts |
| 5 | 多模态工具输出 | `toModelOutput` (export_image → base64 图片) | ai-adapter.ts |
| 6 | Anthropic Cache | `providerOptions: { cacheControl }` | use-chat.ts |

### OpenPencil 在 SDK 之上自建的能力

| # | 能力 | 实现方式 | 代码位置 |
|---|------|---------|---------|
| 1 | noop 检测 | `structuredClone` 前后对比 + `detectUnchangedProps` | ai-adapter.ts |
| 2 | 重复调用检测 | `tool+args` 哈希计数 + `isDuplicate` 标记 | ai-adapter.ts |
| 3 | 节点快照/Undo | `snapshotPage()` → `pushUndoEntry` | tools.ts |
| 4 | 字体按需加载 | `collectFontKeys` → `loadFont` → 清除 textPicture | tools.ts |
| 5 | 布局重计算 | `computeAllLayouts(graph, pageId)` | tools.ts |
| 6 | 节点闪烁反馈 | `extractNodeIds` → `onFlashNodes` → `aiFlashDone` | ai-adapter.ts + tools.ts |
| 7 | 步数警告注入 | `appendStepWarning`: 剩余 ≤5 步时注入 `_warning` | ai-adapter.ts |
| 8 | 工具执行日志 | `ToolLogEntry`: 前后快照、耗时、错误、noop 标记 | ai-adapter.ts |

---

## 核心代码片段

### ToolLoopAgent 创建（use-chat.ts）

```typescript
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'

const agent = new ToolLoopAgent({
  model: createModel(),
  instructions: SYSTEM_PROMPT,
  tools: createAITools(useEditorStore()),
  stopWhen: stepCountIs(MAX_AGENT_STEPS),  // 50 步
  maxOutputTokens: maxOutputTokens.value,
  prepareCall: (options) => {
    resetRunSteps()
    return { ...options, maxOutputTokens: maxOutputTokens.value }
  },
  onStepFinish: ({ usage }) => {
    recordStepUsage({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
      timestamp: Date.now()
    })
  }
})
return new DirectChatTransport({ agent })
```

### createAITools 钩子配置（src/ai/tools.ts）

```typescript
export function createAITools(store: EditorStore) {
  let beforeSnapshot: Map<string, SceneNode> | null = null

  return toolsToAI(CORE_TOOLS, {
    getFigma: () => makeFigmaFromStore(store),
    
    onBeforeExecute: (def) => {
      if (def.mutates) beforeSnapshot = store.snapshotPage()
    },
    
    onAfterExecute: async (def) => {
      if (def.mutates) {
        // 字体加载 → 布局重算 → 渲染 → Undo 入栈
        await loadMissingFonts(store)
        computeAllLayouts(store.graph, pageId)
        store.requestRender()
        if (beforeSnapshot) {
          store.pushUndoEntry({
            label: `AI: ${def.name}`,
            forward: () => store.restorePageFromSnapshot(after),
            inverse: () => store.restorePageFromSnapshot(before)
          })
        }
      }
    },
    
    onFlashNodes: (nodeIds) => {
      store.renderer?.aiClearActive()
      if (nodeIds.length > 0) store.aiFlashDone(nodeIds)
    },
    
    onToolLog: (entry) => runState.toolLog.push(entry),
    
    getStepBudget: () => ({
      current: runState.currentSteps,
      max: MAX_AGENT_STEPS
    })
  }, { v, valibotSchema, tool })
}
```

### ToolDef 定义格式（packages/core/src/tools/schema.ts）

```typescript
export interface ToolDef {
  name: string
  description: string
  mutates?: boolean        // ← 是否修改节点（触发快照/undo/noop检测）
  params: Record<string, ParamDef>
  execute: (figma: FigmaAPI, args) => unknown
}

export type ParamType = 'string' | 'number' | 'boolean' | 'color' | 'string[]'

export interface ParamDef {
  type: ParamType
  description: string
  required?: boolean
  default?: unknown
  enum?: string[]
  min?: number
  max?: number
}
```

### 工具规模（packages/core/src/tools/registry.ts）

```
CORE_TOOLS (22 个 — 默认加载):
  Read:      getSelection, getNode, findNodes, getJsx
  Create:    render
  Modify:    updateNode, setLayout, setLayoutChild, setRadius,
             setFill, setStroke, setText, setTextProperties
  Structure: deleteNode, reparentNode, nodeResize, batchUpdate
  Stock:     stockPhoto
  Utility:   describe, calc, evalCode, viewportZoomToFit

EXTENDED_TOOLS (65 个 — 按需/MCP/CLI):
  变量系统、矢量操作、布尔运算、路径编辑、分析工具、代码生成...
```
