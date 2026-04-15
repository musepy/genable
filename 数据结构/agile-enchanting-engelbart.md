# Plan: Agent Log Digest System

## Context
Agent 日志太长（典型场景 80-120KB），粘贴给 Claude 分析时占用过多上下文。需要一个压缩摘要功能，保留所有行为信息但去掉冗余数据，目标压缩 90%+。

## 方案：纯函数 `generateLogDigest` + UI 按钮

### 输出格式示例
```
=== AGENT DIGEST ===
Prompt: "Create a modern login form"
Iterations: 8 | Duration: 12.4s | Tools: 14 ok, 0 err

--- TIMELINE ---
#1 [planDesign] 320ms OK
   task: Plan login form structure
   think: Plan a login form with email input, password input...
   params: {approach:"hierarchical",steps:5}

#2 [batchOperations] 890ms OK
   task: Create root frame
   ops: createNode(LoginForm/FRAME), createNode(Header/TEXT)
   ids: LoginForm→3:45, Header→3:46

#3 [createIcon] 180ms OK
   params: {name:"mail",size:16,color:"#666"}

#4 [batchOperations] 1.2s ERR
   ops: createNode(Card/FRAME){children:3}
   error: "Invalid parent node"

--- ERRORS (1) ---
#4 batchOperations: "Invalid parent node"

=== END DIGEST ===
```

### 压缩策略（按工具名提取关键参数）

| 字段 | 保留 | 丢弃 |
|------|------|------|
| iteration | 序号、duration、status | 原始时间戳 |
| thinking | 前120字符，单行 | 完整思考文本 |
| toolCall.params | 工具特定关键字段（见下） | 完整参数对象 |
| toolCall.result | idMap 的 key→nodeId | 完整结果对象 |
| toolCall.error | 错误消息 | 堆栈信息 |

**工具参数提取器：**
- `batchOperations` → ops 列表 `action(name/type){children:N}`，result 中 idMap
- `applyDesignPatch` → patches 列表 `nodeId{layout,styles}`
- `createIcon` → `name, size, color`
- `planDesign` → `approach, steps count`
- `inspectDesign` → `nodeId`
- `complete_task` → `summary`（截断80字符）
- `renderSubtree/patchNode` → `nodeId, type`
- 其他工具 → 顶层标量字段，总计不超100字符

### 实现步骤

#### Step 1: 创建 `src/features/chat/logDigest.ts`
- 纯函数 `generateLogDigest(messages: ChatMessage[], meta?: { modelName?: string }): string`
- 无外部依赖，仅依赖 `types/chat.ts` 类型
- 包含每个工具的参数提取器 registry

#### Step 2: 在 Chat UI 添加 "Copy Digest" 按钮
- 文件：`src/features/chat/index.tsx`
- 复用已有的 `useClipboard` hook 和 `copy()` 方法
- 位置：消息区域底部，仅在 `history.length > 0 && !loading` 时显示
- 点击后调用 `generateLogDigest(history, { modelName })` → `copy(result)`

#### Step 3: 添加测试
- 文件：`src/features/chat/__tests__/logDigest.test.ts`
- 测试：空消息、单次迭代、多工具、错误场景、参数截断

### 关键文件
- `src/types/chat.ts` — 类型定义（只读）
- `src/features/chat/logDigest.ts` — 新建，核心逻辑
- `src/features/chat/index.tsx` — 添加按钮（L245 附近已有 `useClipboard`）

### 验证
1. `npx vitest run src/features/chat/__tests__/logDigest.test.ts`
2. 构建插件 `npm run build`，在 Figma 中生成 UI，点击 "Copy Digest"，粘贴验证格式
