# Execution Bug Reference Log

This document records critical bugs and architectural issues discovered during the agentic refactoring process to prevent regression and provide a quick reference for similar problems.

---

## 🚫 Critical Anti-Patterns

1.  **Environment Assumption Errors (环境假设错误)**: Assuming a specific runtime (e.g., Node.js) in a cross-platform or specialized environment (e.g., Figma Sandbox).
2.  **Protocol Integrity Issues (协议完整性问题)**: Improperly mapping or flattening internal abstract roles to provider-specific roles, breaking the LLM logic chain.

---

## 🔍 Detailed Bug Analysis

### 1. `NodeJS.Timeout` Type Leakage
- **File**: `ipcBridge.ts`
- **Category**: Environment Assumption (环境暴露)
- **Problem**: The code used the `NodeJS.Timeout` type in the Figma Sandbox. While the sandbox supports JavaScript, it is not a Node.js environment; `setTimeout` there returns a `number`.
- **Risk**: Hardcoding environment-specific types creates brittle code and can lead to compilation errors or subtle runtime behavior differences.
- **Solution**: Use `ReturnType<typeof setTimeout>` to ensure environment-agnostic type safety.

### 2. Improper 'tool' Role Mapping
- **File**: `agentRuntime.ts` & `gemini.ts`
- **Category**: Protocol Integrity (协议完整性)
- **Problem**: Internal `tool` role messages were being mapped to the `user` role in the Gemini provider.
- **Impact**:
    - **Context Confusion**: Gemini relies on specific roles to maintain the "Function-Calling Chain". Mapping tool responses to `user` makes the model think the tools' output is a direct user command.
    - **Hallucination Risk**: The model loses the boundary between user intent and tool-provided facts, leading to potential logic hallucinations.
- **Solution**: Explicitly map the internal `tool` role to the Gemini provider's expected `function` role format.


## gemini 3.0/2.0 的thinking 模型要求 ##
functionCall 时会附带 thought_signature，必须在后续对话的history中对应part原样返回此签名。
强制要求：Gemini 3 和 Gemini 2.0 (Thinking) 模型在生成 functionCall 时会附带 thought_signature。在后续对话中，必须在 history 的对应 Part 中原样返回此签名。


## figma插件环境要求 ##

属性更新工具 (updateNodeProperties) - 关键失效点
错误信息: Error: in getNodeById: Cannot call with documentAccess: dynamic-page. Use figma.getNodeByIdAsync instead.
技术根源:
过耦合问题: 该工具实现中直接使用了 Figma 的同步 API getNodeById。在启用了 dynamic-page 的现代 Figma 插件环境中，节点访问必须是异步的。

同步 VS 异步

在编程中，**同步（Synchronous）**意味着“阻塞”，即程序必须等这一步完成才能走下一步；**异步（Asynchronous）**意味着“非阻塞”，程序发起请求后可以先去干别的，等结果回来了再处理。


// ❌ 错误做法：同步阻塞调用
case 'updateNodeProperties': {
  const { nodeId, properties } = parameters;
  
  // 这里是关键！figma.getNodeById 是同步的
  // 它会立即寻找内存中的节点，但在复杂的 dynamic-page 环境下，
  // 节点可能还在磁盘或远程服务器上，直接调用会抛出 Error
  const node = figma.getNodeById(nodeId) as SceneNode; 

  if (!node) {
    // 处理找不到节点的情况...
  }
  // 执行后续操作...
}

// ✅ 正确做法：异步非阻塞调用
case 'updateNodeProperties': {
  const { nodeId, properties } = parameters;
  
  // 1. 使用 await 等待异步获取节点
  // 此时程序会“挂起”这一步，去处理写其他事情（比如 UI 渲染），
  // 直到 Figma 真正把节点从后台取回来
  const node = await figma.getNodeByIdAsync(nodeId) as SceneNode; 

  if (!node) {
    // 节点可能被删了，或者真的没取到
    response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` } };
    break;
  }

  // 2. 拿到节点后，再继续执行后续的属性更新逻辑
  // ...
}

1. 确认存在同步风险的工具 (Renderer Tools)
这些工具必须升级为异步，否则在大型文档中会随时崩溃：

deleteNode
 (删除节点):
风险: src/main.ts:283 行使用了 figma.getNodeById。
后果: 如果 LLM 想要删除一个不在当前视口/内存中的节点，它会直接报错并停止任务。
handleUnifiedRender
 (渲染核心逻辑):
重大隐患: 这是项目的核心。在 src/main.ts:85 行，当我们尝试在“更新模式”下查找目标节点时，代码依然是同步的。
后果: 这意味着所有涉及“局部更新”或“增量修改”的设计意图，都会因为这个底层的同步调用而失效。


## 底层代码与工具的脱节 ##

技术根源：在 
src/main.ts
 的 TOOL_CALL 监听器中，处理 
createFrame
、
createText
 等工具时，代码直接忽略了 LLM 传回的 parentId 参数。






 ## 大模型幻觉 ##

 工具调用拼写错误 (Tool Name Typos)
现象：日志中显示 updateNode-properties 执行失败（Error: UNKNOWN_TOOL）。
原因：LLM 在调用工具时出现了幻觉，将 
updateNodeProperties
 写成了 updateNode-properties。
建议：在 Tool Definition 中增加更多别名支持，或在 System Prompt 中进一步强调准确性。


## 工具原子化 ##
createframe一个工具完成创建、布局、样式、层级。
将createframe拆分成：

createnode，负责结构与存在性，只保证节点在图层树中产生
setlayout，负责排版规则，Auto Layout 逻辑，内部包含校验与自我修复
setstyles 负责视觉表现，处理颜色、圆角、描边。




Gemini API 不允许 function call 前面有 text 内容
fallback 逻辑包含 text + functionCall 也就是错误
所以：当存在 tool calls 时，只发送 functionCall，不发送 text。



## 污染上下文 ##
不必要的信息进入了上下文；
1. 技术堆栈追踪 (Full Stack Traces)
现象： 当工具调用失败（如 Auto-layout 冲突）时，Agent 将完整的 JavaScript 堆栈信息传回了上下文（见日志第 528-535 行）。
污染点： 包含了 te.applyLayoutSizing、PLUGIN_89_SOURCE、eval at <anonymous> 等插件内部实现细节。
后果： 这些信息对 LLM 修复其输出的 DSL 毫无帮助，反而占据了数百个 Token，并可能诱导 LLM 尝试在设计参数中写出类似代码的“幻觉”。
2. 内部生命周期日志 (Internal Lifecycle Logs)
现象： 日志中充斥着大量的 [Trace], PHASE: [RENDER], Cache warmed, FontBus warmup（见日志第 511-517 行）。
污染点： 这些是 Agent 运行时的监控日志。如果这些日志也被顺序合并到了对话历史中，它们就是纯粹的噪点。
后果： 模糊了 LLM 对“有效互动”的感知。LLM 不需要知道字体总线是否预热完成，它只需要知道它的 Text 节点是否成功。
3. 未经简化的“尝试-失败”循环 (Unfiltered Iteration History)
现象： LLM 在 7349 token 期间重复了多次相同的 Auto-layout 错误。
污染点： 每一轮失败的完整请求和完整报错都在上下文中堆叠。
后果： 当 LLM 看到自己之前 5 次都失败了，且失败信息完全一致时，它可能会进入一种“自我怀疑”的逻辑循环（Looping），或者试图去修正一些本来没问题的参数，导致越改越错。
4. 隐式默认值的“负反馈” (Ghost Properties)
现象： LLM 发出的请求可能只包含 { type: "FRAME" }，但 Agent 的渲染器自动补全了 layoutSizingHorizontal: "HUG"。
污染点： 当报错说“HUG 模式需要 Auto-layout”时，LLM 在上下文里翻遍了自己之前的请求，却发现自己从未写过 HUG 或任何 layout 属性。
后果： 这种“信息差”对于 LLM 来说是极大的干扰。它接收到了一个它没做过的事情的报错，导致它无法通过上下文（Context）进行逻辑闭环的自纠。
5. 冗余的元数据 (Usage Metadata)
现象： 每次 Generate 返回的 usageMetadata（token 统计、缓存统计）包含了大量数字字段（见日志第 901-919 行）。
污染点： 具体的 Token 计数和缓存命中情况是给开发者看的，给 LLM 会干扰其关注设计语义。

关于“未经简化的‘尝试-失败’循环 (Unfiltered Iteration History)”，我用一个更直观的比喻来为你解释：

想象你正在教一个学徒拼装家具，但他犯了一个关于“螺丝拧反了”的错误：

没有污染的情况：
他尝试：螺丝拧反了。
你告诉他：“螺丝拧反了，请顺时针拧。”
他接收到信息，立刻改成了正确的方向。这很高效。
“未经简化”的污染情况（就像日志里 7349 Token 时发生的那样）：
第 1 次尝试：他拧反了。你给了他 10 页纸的报错说明书。
第 2 次尝试：他**由于某种原因（比如记不住 10 页纸的内容）**又拧反了。你又给了他 10 页纸一模一样的报错。
...
第 5 次尝试：他面前堆了 50 页厚的报错记录。
结果： 学徒（LLM）崩溃了。他看着这 50 页一模一样的废话，脑子乱了。他开始想：“既然我拧了 5 次都错，是不是这个螺丝本身就有问题？还是桌腿坏了？” 于是他开始去改那些原本是对的地方，导致越改越乱。


总结：
这个点的核心意思是：我们应该只告诉 LLM “你最近一次错在哪了”，而不是把“它这辈子犯的所有重复错误”都反复念给它听。 过期的失败经验如果没有被总结，就是纯粹的毒药。




MALFORMED_FUNCTION_CALL 错误通常是因为模型尝试调用一个不存在的工具，或者工具调用格式不符合 Gemini 的原生规范。