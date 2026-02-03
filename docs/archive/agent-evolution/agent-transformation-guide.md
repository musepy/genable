# Figma AI Generator: Pipeline-to-Agent 架构转型全面分析

## 执行计划

此分析报告作为后续重构的参考文档。架构以 Gemini 为主，但从 Phase 2 起在 generator 层引入 LLMProvider 抽象接口，为 Phase 4 的多模型支持 (Claude, GPT-4 等) 预留扩展点。

## 目录

- Part 1: Gap Analysis (差距分析)
- Part 2: Tool Definitions (工具定义)
- Part 3: Agent Loop Design (Agent 循环设计)
- Part 4: Context Optimization Strategy (上下文优化策略)
- Part 5: Migration Roadmap (迁移路线图)

---

## Part 1: 差距分析

### 1.1 控制流: 线性管线 vs Agent 循环

`src/engine/services/ChatOrchestrator.ts` 实现了严格的 7 步线性管线: resolve config (hardcoded 'vanilla') -> recognizeIntent (keyword matching) -> composeSystemPrompt (static section assembly) -> trace/logging -> generateLayoutWithValidation (single LLM call) -> postProcess -> prefetch + emit CREATE_LAYERS。管线一旦开始不会根据中间结果改变路径。

Agent 架构应将控制流从编排器移交给 LLM。LLM 在每一步决定下一步做什么，编排器退化为"工具执行运行时"，只负责调度 LLM 请求的工具调用。

严重性: CRITICAL

### 1.2 知识检索: 静态 RAG vs LLM 按需查询

知识检索链路: `intentRecognizer.ts` 用硬编码关键词匹配 intent target -> `knowledgeHub.ts` 的 MiniSearch 在 11 个索引域中搜索 -> `sectionRegistry.ts` 的 16 个 section builder 各自调用 knowledgeHub.searchXxx() 并将结果注入 prompt。

核心问题: 所有 section builders 的搜索在 LLM 调用之前完成。如果 `buildFigmaLayoutSection` (sectionRegistry.ts:63) 用 `intent.target || 'layout card button text'` 搜索得到错误结果，LLM 永远看不到正确知识。LLM 无法请求额外知识。

Agent 架构应将 KnowledgeHub 暴露为工具函数，LLM 自主决定搜索什么、搜索哪个域、搜索多少次。

严重性: CRITICAL

### 1.3 意图识别: 关键词匹配 vs LLM 原生理解

`intentRecognizer.ts` 使用 TARGET_MAP 遍历 (line 133-139, break on first match)、硬编码动词列表分类 intent type (line 153-166: 'create'/'make' -> GENERATE_COMPONENT)、固定决策树做 context routing (line 369-389)。confidence 总是 1.0，不支持上下文推理。

Agent 架构应完全移除硬编码意图识别，LLM 本身理解用户意图并直接决定使用什么工具。

严重性: HIGH

### 1.4 Prompt 组合: 固定 Section 注册表 vs 动态上下文组装

`promptComposer.ts` 无条件连接所有活跃 sections (16 个, priority 10-51)。没有 token 预算管理，line 42-43 只是估算不限制。每次调用都注入全部活跃 sections 即使很多对当前请求无关。

Agent 架构应将系统提示词精简为核心身份 + 工具列表描述，特定领域知识通过工具调用按需获取。

严重性: HIGH

### 1.5 LLM 调用: 单次生成 vs 多轮 Tool-Use

`generator.ts` line 86-91 使用标准 chat 模式。`generateLayoutWithValidation` (line 206-253) 重试只是将错误信息追加到 history 然后重新生成全部输出，DEFAULT_MAX_RETRIES: 1，没有增量修复。

Agent 架构应通过 function calling 逐步构建设计，每创建一个节点可以通过 validation tool 检查并即时修复。

严重性: CRITICAL

### 1.6 后处理/规范化: 确定性修复 vs Agent 自纠正

`Normalizer.ts` 做了大量"修复 LLM 幻觉"的工作: TYPE_MAP 类型映射 (line 79-97)、属性提升 liftProps (line 100-126)、属性别名 normalizePropertyAliases (line 128-152, 来自 runtime-coercion.json)、值类型强制转换 coercePropertyValues (line 154-183)、枚举归一化 normalizeEnums (line 185-223)。

Agent 架构应将"决策"类逻辑编码为 LLM 的 schema 约束，将"修复"类逻辑保留为 validation tool 的反馈。Normalizer 降级为安全网。

严重性: MEDIUM

### 1.7 渲染: 批量渲染 vs 原子工具操作

渲染管线 (RenderOrchestrator -> Normalizer -> renderNodeDSL -> BaseRenderer strategy) 一次性处理整棵节点树。流式渲染通过 StreamBufferManager + TreeReconstructor 管理，但不支持逐节点纠错。

Agent 架构应将渲染操作拆分为原子工具 (createFrame, createText, updateNodeProperties 等)，LLM 可以逐步构建、中间检查、按需修改。

严重性: HIGH

### 1.8 双线程通信: 发射-遗忘 vs 请求-响应

当前 `shared/protocol/events.ts` 定义的事件都是单向的 (emit and forget)。如果 Agent 需要调用 Figma API 工具，需要 UI Thread -> emit TOOL_CALL -> Sandbox Thread execute -> emit TOOL_RESULT -> UI Thread 将结果返回给 LLM。这需要请求-响应通信协议。

严重性: CRITICAL

---

## Part 2: 工具定义

### 2.1 Knowledge Tools (替代静态 RAG)

**searchDesignKnowledge**: 在指定知识域搜索设计知识。参数: `{ domain: 'reasoning'|'styles'|'colors'|'typography'|'landing'|'charts'|'products'|'guidelines'|'stacks'|'figmaLayout'|'anatomy', query: string, limit?: number, minScore?: number }`。返回 `{ results: Array<{id, score, data}>, totalAvailable }`. 替代 sectionRegistry.ts 中所有 buildXxxSection 对 knowledgeHub.searchXxx() 的静态调用。

**getComponentAnatomy**: 获取组件结构蓝图。参数: `{ componentName: string, includeVariants?: boolean }`。返回 `{ found, blueprint?: {name, structure, defaultProps, variants} }`。替代 buildStructuralAnatomySection()。

**getFigmaLayoutRules**: 获取 Figma 布局约束规则。参数: `{ topic?: string, severityFilter?: 'Critical'|'High'|'Medium'|'Low' }`。返回 `{ rules: Array<{id, issue, description, do, dont, severity}> }`。替代 buildFigmaLayoutSection()。

### 2.2 Renderer Tools (替代批量渲染)

**createFrame**: 创建 Frame 节点。参数: `{ parentId?, name, layoutMode?, width?, height?, layoutSizingHorizontal?, layoutSizingVertical?, padding?, gap?, fills?, cornerRadius?, effects?, primaryAxisAlignItems?, counterAxisAlignItems? }`。返回 `{ nodeId, success, error? }`。执行线程: Sandbox (需 IPC)。

**createText**: 创建 Text 节点。参数: `{ parentId, name?, characters, fontSize?, fontFamily?, fontWeight?, fills?, layoutSizingHorizontal?, layoutSizingVertical?, width? }`。返回 `{ nodeId, success, error? }`。执行线程: Sandbox。

**createShape**: 创建基本形状。参数: `{ parentId, shapeType: 'RECTANGLE'|'ELLIPSE'|'LINE', name?, width, height, fills?, cornerRadius?, strokes?, strokeWeight? }`。返回 `{ nodeId, success, error? }`。执行线程: Sandbox。

**createIcon**: 通过 Iconify 语义名称创建图标。参数: `{ parentId, iconName, size?, color? }`。返回 `{ nodeId, success, resolvedIcon?, error? }`。执行线程: Sandbox。

**updateNodeProperties**: 更新已存在节点的属性。参数: `{ nodeId, properties: Record<string, any> }`。返回 `{ success, updatedProperties, error? }`。执行线程: Sandbox。

**deleteNode**: 删除节点及子节点。参数: `{ nodeId }`。返回 `{ success, error? }`。执行线程: Sandbox。

### 2.3 Validation Tools (替代后处理)

**validateLayout**: 对节点树运行布局约束验证。参数: `{ nodeId?, checkTypes: ('sizing'|'dependency'|'autoLayout'|'semantic')[] }`。返回 `{ valid, errors: Array<{rule, nodePath, message, suggestion}>, warnings }`。替代 constraintValidator.validateLayoutConstraints() + lint()。

**inspectNode**: 检查已渲染节点的实际属性状态。参数: `{ nodeId, properties?: string[] }`。返回 `{ exists, type?, actualProperties?, children? }`。替代 NodeSerializer + propertyTransformer.serialize()。

### 2.4 Context Tools

**getSelectionContext**: 获取当前 Figma 选区上下文。无参数。返回 `{ hasSelection, nodes?, serializedDSL? }`。替代 main.ts 的 GET_SELECTION_STYLES handler + buildSelectionContext()。

**getViewportInfo**: 获取视口信息。无参数。返回 `{ center, zoom, isMobile, suggestedWidth, suggestedHeight }`。

---

## Part 3: Agent 循环设计

### 3.1 任务接收

用户在 UI Thread 输入 prompt -> useChat.generate() 构建 AgentTask `{ userPrompt, selectionContext?, conversationHistory, designSystemId }` -> AgentRuntime.start(task)。

### 3.2 决策循环

```
START: User Prompt + Selection Context
  ↓
LLM Reasoning Step (Gemini with tools) ←─────┐
  ↓                                           │
Output?                                       │
  ├── tool_call (知识) → Execute in UI Thread → result → ─┘
  ├── tool_call (渲染) → IPC to Sandbox → result → ───────┘
  ├── tool_call (验证) → IPC to Sandbox → result → ───────┘
  └── text_only (完成) → EXIT
```

退出条件: LLM 返回 text-only 响应 (无 tool_call); Max iterations 达到 (安全上限 20); 用户取消信号。

### 3.3 工具调用与双线程集成

核心: LLM API 调用在 UI Thread，Figma API 在 Sandbox Thread。

Knowledge Tools 直接在 UI Thread 执行 (knowledgeHub 在 UI Thread 可用)。Renderer/Validation/Context Tools 通过 IPC Bridge 发送到 Sandbox Thread: UI Thread emit('TOOL_CALL', {requestId, toolName, args}) -> Sandbox Thread 执行 Figma API -> emit('TOOL_RESULT', {requestId, result}) -> UI Thread resolve pending promise -> 结果返回 LLM。

IPC Bridge 需要: requestId 追踪、Promise-based 请求-响应、超时机制 (10s)、错误传播。

### 3.4 渐进式渲染策略

方案 A (推荐作为过渡): 保留流式 JSON，Agent 第一轮使用流式输出整棵树 (保持当前 UX)，输出完成后使用 validateLayout 检查，错误通过 updateNodeProperties 精确修复。

方案 B (最终目标): 纯工具调用逐步构建，用户看到节点逐个出现，更精确但更慢 (每个工具调用需 IPC 往返)。

### 3.5 错误自纠正

Agent 调用 validateLayout -> 收到 errors -> Agent 分析并调用 updateNodeProperties 精确修复 -> 再次 validateLayout。与当前 retryLoop.ts 的区别: 当前重新生成整个输出 (maxRetries=1)；Agent 精确修复单个属性，可多次迭代。

---

## Part 4: 上下文优化策略

### 4.1 上下文缓存

缓存层级: 系统指令缓存 (核心身份 + 工具描述 + DSL schema, 会话级不变), 知识检索结果缓存 (相同 query+domain, TTL=会话), 选区上下文缓存 (selection change 时失效)。

Gemini Context Caching API: 将不变的系统指令 + 工具定义通过 `cacheManager.create()` 缓存在服务端 (TTL 3600s)，后续请求通过 `getGenerativeModelFromCachedContent()` 引用，避免重复传输。

### 4.2 Prompt 压缩

必须保留 (verbatim): 工具定义 schema, NodeLayer DSL schema, 核心布局约束。可以压缩: 旧对话轮次 -> 摘要, 工具结果中的大 JSON -> 保留关键字段, 验证反馈 -> 只保留错误。

保留最近 3 轮完整对话，更早轮次压缩为摘要。工具结果按类型压缩: createFrame 成功时只保留 nodeId, searchDesignKnowledge 只保留 topResult, validateLayout 只保留 error messages。

### 4.3 Delta 反馈

当前 retryLoop.ts line 106-109 将完整前次输出追加到 history (大型设计 50+ 节点)。Agent 模式下 delta 反馈自然内嵌于 validateLayout 的返回值: `{ nodesToFix: [{nodeId, currentValue, constraint, suggestedFix}], nodesOK: 47 }`。LLM 只需 updateNodeProperties 修复特定节点。

### 4.4 多轮对话历史管理

分层历史: systemContext (固定, 缓存), toolDefinitions (固定, 缓存), conversationSummary (压缩的历史摘要), recentTurns (最近 3 轮完整), activeDesignState (当前画布快照: rootNodeId, nodeCount, lastValidation)。

降级策略: token 上限时 (1) 压缩旧历史 (2) 移除工具结果详情 (3) 移除知识搜索原始结果。永远不移除: 工具定义, schema, 最近 1 轮对话。

---

## Part 5: 迁移路线图

### Phase 1: 基础设施准备 (无需更换 LLM 提供者)

**1.1 抽取 Tool Interface 层**
- 新建 `src/engine/agent/tools/types.ts` (ToolDefinition interface)
- 新建 `src/engine/agent/tools/knowledgeTools.ts` (包装 knowledgeHub)
- 新建 `src/engine/agent/tools/validationTools.ts` (包装 constraintValidator + lint)
- 复杂度: 中 | 风险: 低

**1.2 建立 IPC Bridge**
- 新建 `src/engine/agent/ipcBridge.ts` (请求-响应通信)
- 修改 `src/shared/protocol/events.ts` (添加 TOOL_CALL, TOOL_RESULT 事件)
- 修改 `src/main.ts` (添加 on('TOOL_CALL') handler)
- 复杂度: 中 | 风险: 中

**1.3 重构 intentRecognizer 为可选模块**
- 修改 `ChatOrchestrator.ts` (intent 变为 optional)
- 修改 `sectionRegistry.ts` (builder 函数处理 intent 缺失)
- 复杂度: 低 | 风险: 低

**1.4 PromptComposer 支持精简模式**
- 修改 `promptComposer.ts` (添加 composeAgentSystemPrompt())
- 复杂度: 低 | 风险: 低

### Phase 2: 引入 Function Calling (核心转型)

**2.1 Gemini Function Calling 集成 + LLMProvider 抽象层**
- 新建 `src/engine/llm-client/providers/types.ts` (LLMProvider interface: startChat, sendMessage, sendMessageWithTools)
- 新建 `src/engine/llm-client/providers/gemini.ts` (Gemini 实现, 包含 Function Calling + Context Caching)
- 重构 `generator.ts` (通过 LLMProvider 间接调用, 添加 generateWithTools())
- 修改 `types.ts` (添加 ToolCall, ToolResult, LLMProvider 相关类型)
- 新建 `src/engine/agent/agentRuntime.ts` (Agent 循环运行时, 接收 LLMProvider)
- 复杂度: 高 | 依赖: Phase 1.1, 1.2 | 风险: 高
- 注: Provider 抽象在此阶段只有 Gemini 实现, 但接口设计需兼容 Claude/GPT-4 的 tool_use 格式差异

**2.2 渲染器工具注册**
- 新建 `src/engine/agent/tools/rendererTools.ts` (Sandbox 执行器)
- 修改 `main.ts` (注册 tool handlers)
- 复杂度: 高 | 依赖: Phase 1.2, 2.1

**2.3 ChatOrchestrator Agent 模式**
- 新建 `src/engine/services/AgentOrchestrator.ts`
- 修改 `useChat.ts` (feature flag 双模式切换)
- 复杂度: 高 | 依赖: Phase 2.1, 2.2

### Phase 3: 完整 Agent 循环

**3.1 流式 Agent 模式** -- 工具调用实时渲染, StreamBufferManager 适配, UI 状态展示
**3.2 上下文优化** -- historyCompressor, Gemini Context Caching, token 预算管理
**3.3 Normalizer 降级** -- 移除类型映射和枚举归一化 (已由 schema 约束), 保留 NaN 防护等安全网
**3.4 归档过时代码** -- intentRecognizer, progressiveContext, retryLoop, distributedGenerator

### Phase 4: 高级优化

**4.1 MCP 兼容** -- 工具定义对齐 MCP 标准
**4.2 多模型支持** -- providers/gemini.ts, providers/anthropic.ts, providers/openai.ts
**4.3 Session Memory** -- 跨会话记忆用户偏好 (figma.clientStorage)
**4.4 视觉验证** -- captureScreenshot + multimodal LLM 验证渲染结果

---

## 文件影响矩阵

| 文件 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|
| `engine/services/ChatOrchestrator.ts` | 修改 | 并行 | - | - |
| `knowledge/intentRecognizer.ts` | 修改 | - | 归档 | - |
| `engine/llm-client/generator.ts` | - | 重构 | 修改 | 修改 |
| `engine/llm-client/knowledge/knowledgeHub.ts` | - | 包装 | - | - |
| `engine/llm-client/context/sectionRegistry.ts` | 修改 | - | 降级 | - |
| `engine/llm-client/context/promptComposer.ts` | 修改 | - | - | - |
| `engine/pipeline/Normalizer.ts` | - | - | 精简 | - |
| `engine/pipeline/RenderOrchestrator.ts` | - | 修改 | - | - |
| `engine/figma-adapter/renderers/*.ts` | - | 包装 | - | - |
| `engine/llm-client/retryLoop.ts` | - | - | 归档 | - |
| `shared/protocol/events.ts` | 修改 | - | - | - |
| `main.ts` | 修改 | 修改 | - | - |
| `features/chat/useChat.ts` | - | 修改 | 修改 | - |
| `engine/llm-client/types.ts` | 修改 | 修改 | - | - |

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Gemini Function Calling latency 过高 | 中 | 高 | 方案 A (流式 JSON + 后验证) 作为保底 |
| IPC Bridge 消息丢失/超时 | 低 | 高 | 重试 + ACK 确认 + requestId 追踪 |
| Agent 循环无限执行 | 中 | 中 | 硬编码 max iterations (20), token budget limit |
| LLM 不正确使用工具 | 高 | 中 | 工具参数 schema 验证, 详细 description, few-shot examples |
| 用户体验退化 (速度) | 高 | 高 | Feature flag 双模式并行, A/B 测试 |
| Figma Plugin Sandbox 限制 | 低 | 高 | 提前测试所有工具在 sandbox 的可行性 |

## 验证方案

### 每个 Phase 完成后的验证

**Phase 1 验证:** Tool Interface 层的单元测试 (knowledgeTools 正确包装 knowledgeHub 的搜索结果); IPC Bridge 的集成测试 (UI Thread 发送 TOOL_CALL, Sandbox Thread 返回 TOOL_RESULT, 测试超时和错误传播); 现有功能回归测试 (intent optional 不影响线性管线)。

**Phase 2 验证:** 用一个简单 prompt (如 "create a button") 端到端走通 Agent 循环: LLM -> searchDesignKnowledge("button") -> getComponentAnatomy("button") -> createFrame() -> createText() -> validateLayout() -> 完成; 对比 Agent 模式与线性管线的输出质量和耗时。

**Phase 3 验证:** 多轮对话测试 (创建 card, 然后 "add a badge to the top-right corner"); 上下文压缩后 LLM 仍然记住之前创建的节点; Normalizer 精简后 LLM 直接输出正确格式的比率统计。

**Phase 4 验证:** MCP server 能被外部 LLM 客户端 (如 Claude Code) 调用; 多模型切换 (Gemini -> Claude) 功能正常; Session Memory 正确持久化和恢复用户偏好。
