# 受影响文件索引

## 删除（Write Path 翻译层）

| 文件 | 行数 | 当前职责 | 删除原因 |
|------|------|---------|---------|
| `src/engine/figma-adapter/treeReconstructor.ts` | 134 | flat list → tree | Actions 是有序列表，不需要 tree 重建 |
| `src/engine/figma-adapter/renderers/baseRenderer.ts` | 441 | Template Method 基类 | 替换为 ActionExecutor |
| `src/engine/figma-adapter/renderers/frameRenderer.ts` | ~280 | Frame 创建+布局 | 合并进 ActionExecutor |
| `src/engine/figma-adapter/renderers/textRenderer.ts` | ~200 | Text 创建+字体 | 合并进 ActionExecutor |
| `src/engine/figma-adapter/renderers/vectorRenderer.ts` | ~130 | Vector/Rect 创建 | 合并进 ActionExecutor |
| `src/engine/figma-adapter/renderers/shapeRenderer.ts` | ~60 | Ellipse/Line | 合并进 ActionExecutor |
| `src/engine/figma-adapter/renderers/instanceRenderer.ts` | ~120 | Component Instance | 合并进 ActionExecutor |
| `src/engine/figma-adapter/renderers/index.ts` | 157 | Renderer Factory | 不再需要 Strategy Pattern |

## 大幅修改

| 文件 | 改动 |
|------|------|
| `src/engine/figma-adapter/propertyTransformer.ts` | 删除 `deserialize()`；`isEqual()` 保留（或迁移等价实现）直到 read-path 默认裁剪逻辑重构完成 |
| `src/engine/pipeline/Normalizer.ts` | 大部分逻辑迁移或删除 |
| `src/engine/pipeline/RenderOrchestrator.ts` | 精简为 Action dispatch |
| `src/ipc/handlers/toolCallHandler.ts` | create_node/patch_node handler 改为调 ActionExecutor |
| `src/ipc/helpers/renderHelper.ts` | 精简，移除 DSL render 入口 |

## 新增

| 文件 | 职责 |
|------|------|
| `src/engine/actions/types.ts` | Action 类型定义（FigmaAction union type） |
| `src/engine/actions/executor.ts` | ActionExecutor 核心实现 |
| `src/engine/actions/validator.ts` | Action schema 校验 |
| `src/engine/actions/__tests__/executor.test.ts` | 执行器测试 |

## 保留不变

| 文件 | 原因 |
|------|------|
| `src/engine/figma-adapter/nodeSerializer.ts` | Read path 仍需要 |
| `src/engine/figma-adapter/figmaNodeData.ts` | Read path IR |
| `src/engine/figma-adapter/resources/FontBus.ts` | ActionExecutor 需要 |
| `src/engine/figma-adapter/caches/figmaVariableCache.ts` | ActionExecutor 需要 |
| `src/constants/figma-api.ts` | PROP_METADATA 被 read path 引用 |
| `src/engine/agent/tools/unified/readNode.ts` | Read tool 不变 |

## Tool 定义变化

| 当前 | 新 | 变化 |
|------|-----|------|
| `batchOperations` | `batchOperations` (ActionExecutor backend) | 先迁移主写入路径，再迁移单点工具 |
| `create_node` (DSL flat list) | `create_node` (Action list) | props 使用 Figma 原生属性名 |
| `patch_node` (DSL props) | `patch_node` (直接 props) | 去掉 DSL 翻译 |
| `read_node` | `read_node` | 不变 |
