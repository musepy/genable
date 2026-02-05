# 研究报告：超时故障分析 (Timeout Failure Analysis)

**日期**: 2026-01-20
**主题**: Request exceeded 90s limit
**关联**: [Generation Failure Analysis](./generation_failure_analysis_2026_01_20.md)

## 1. 问题描述
用户反馈在应用了“放宽空容器校验”的修复后，出现了请求超时错误：
`[Timeout] Request exceeded 90s limit. Network might be unstable.`

## 2. 核心矛盾
我们的修复代码位于 **Post-Generation** 阶段（即 API 返回结果之后）。
- **逻辑悖论**: 一个在 API 返回之后才运行的 `if` 判断，理论上不可能导致 API 请求本身超时。
- **用户观察**: "当前修复会导致这个问题"。这表明可能存在我们忽略的 **副作用 (Side Effect)** 或 **相关性 (Correlation)**。

## 3. 假设树 (Hypothesis Tree)

| ID | 假设 (Hypothesis) | 置信度 | 理由 (Rationale) | 验证方法 |
| :--- | :--- | :--- | :--- | :--- |
| **H1** | **Schema 复杂度导致的延迟** | **70%** | 我们启用了 `responseJsonSchema` [P0]。Gemini 在处理约束解码（Constrained Decoding）时，如果 Schema 过于复杂（递归），计算量会指数级上升，导致服务端处理时间超过 90s。之前的 "Truncated" 可能是因为它很快就放弃了或者崩了，而这次它试图“努力计算”直到超时。 | 暂时禁用 `responseJsonSchema` 测试。 |
| **H2** | **网络/模型波动 (Coincidence)** | **40%** | Google Gemini API 偶尔会有高延迟。这可能是一个巧合，恰好在修复后出现。 | 多次重试。 |
| **H3** | **构建副作用 (Build Side Effect)** | **20%** | `npm run build` 可能更改了打包配置，或者引入的新依赖 (`minisearch`) 影响了初始加载性能（虽然不太可能影响 API 请求时长）。 | 检查 Bundle 大小。 |

## 4. 关键分析：为什么之前是 Truncated 而现在是 Timeout？

这是一个关键的区别。
- **Truncated**: API 在 90s 内返回了数据，但是数据不完整（达到了 maxTokens）。
- **Timeout**: API 在 90s 内**没有返回任何数据**（或首字节）。

这暗示了 **Time-to-First-Byte (TTFB)** 的显著增加。
什么会导致 TTFB 增加？
1.  **Thinking Mode**: 如果模型在 "思考" (Thinking) 阶段花费了太长时间。
2.  **Schema Validation**: 服务端在生成第一个 Token 之前，需要构建巨大的状态机来验证 Schema。

## 5. 建议的调查步骤

1.  **检查 Config**: 确认 `generator.ts` 中的 `GEMINI_CONFIG`。
2.  **禁用 Schema**: 尝试临时禁用 `responseJsonSchema`，退回到纯文本 JSON 模式，看是否秒回。如果秒回，则是 Schema 问题。
3.  **检查 Schema 定义**: 查看 `src/services/gemini/schema.ts`，是否存在过深的递归。我们在这个版本中是否无意中修改了 Schema？（未修改）。

## 6. 临时解决方案建议

如果必须立即恢复服务：
1.  将 `REQUEST_TIMEOUT_MS` 增加到 120s 或更多（治标不治本）。
2.  **退回 (Rollback)**: 暂时禁用 P0 Schema Validation (`responseSchema: undefined`)，牺牲结构稳定性换取速度。

---

## 7. 追加研究：截断错误在动态性能配置后仍发生 (2026-01-23)

### 7.1 结构化检索结果 (Structured Search)

**内部证据 (Internal)**
- 输出截断判断逻辑：`isTruncatedOutput` 会在输出不完整或极短时触发 “设计太复杂，输出被截断”。  
  证据：`src/types/errors.ts`
- 当前 `MAX_OUTPUT_TOKENS` 来源于性能配置（默认 `balanced=4096`），且 `REQUEST_TIMEOUT_MS` 与 `thinkingLevel` 挂钩。  
  证据：`src/engine/llm-client/config.ts`, `src/engine/llm-client/performance.ts`
- Prompt 依赖多个上下文段落（结构蓝图、指南、风格、组件知识），可能诱导模型输出更完整、更长的 JSON。  
  证据：`src/engine/llm-client/context/sectionRegistry.ts`, `promptComposer.ts`

**外部证据 (External)**
- Gemini 输出截断与 token 预算相关，`total_token_count - prompt_token_count` 可能小于预期。  
  证据：Google AI Developers Forum 讨论（Truncated responses despite being under limits）
- `responseMimeType: application/json` 有助于结构化输出，但在超出预算时仍会出现空/截断响应。  
  证据：Google Cloud 官方文档与社区案例（structured output / response_mime_type）
- 当 `max_output_tokens` 过大时，服务端生成时间显著增长；过小时会更快触达截断。  
  证据：官方示例与社区配置实践

### 7.2 竞争假设 (Competing Hypotheses)

| ID | 假设 | 置信度 | 解释 | 证据/反证 |
| :--- | :--- | :--- | :--- | :--- |
| H1 | **输出规模超预算** | 70% | 动态性能将 `maxOutputTokens` 降到 4096，但模型仍尝试生成完整页面级 JSON，触发截断判定。 | `performance.ts` 默认 balanced=4096；截断来自 `isTruncatedOutput` |
| H2 | **Prompt 注入诱导“完整页面”** | 55% | 结构蓝图、规则、风格与产品趋势等上下文叠加，暗示模型输出更完整、更细。 | `sectionRegistry.ts` 多段注入；未见显式输出上限 |
| H3 | **邻接表格式导致节点数量膨胀** | 45% | Flat adjacency list 会增加 id/parent 字段重复，降低有效信息密度。 | 角色模板中强制邻接表 |
| H4 | **生成时间波动导致空/截断响应** | 35% | 模型在高思考/复杂输出时抖动，返回半截或空响应被判截断。 | 外部社区讨论：截断在限额内仍出现 |
| H5 | **重试/纠错链路导致额外复杂化** | 25% | 验证失败时增加反馈提示，可能要求更复杂修复，继续扩展输出。 | `generateLayoutWithValidation` 的 retry 机制 |

### 7.3 进度笔记 (Progress Notes + Confidence)

- **2026-01-23**：确认动态性能配置已接管 `MAX_OUTPUT_TOKENS` 与 `REQUEST_TIMEOUT_MS`，默认 `balanced=4096`。  
  置信度：0.75 → 0.85（通过代码路径确认）
- **2026-01-23**：截断与“提示词 1-2k tokens”不矛盾，因为输出预算是瓶颈，且邻接表对输出长度更敏感。  
  置信度：0.55 → 0.7（结合结构格式与生成逻辑推导）
- **2026-01-23**：尚未记录 “rawText.length / tokens” 的运行期证据，需补充仪表盘。  
  置信度：0.4 → 0.6（缺乏实时数据）

### 7.4 方法自我批评 (Self-Critique)

- 过度依赖静态代码路径推断，缺少真实请求的 token 使用与响应长度统计。
- 外部资料未区分 Gemini 具体版本与平台差异（AI Studio / Vertex），可能影响结论适用性。
- 缺乏失败样本分布（首次尝试 vs 重试）与输入类型的切分统计。

### 7.5 下一步验证计划 (Systematic Plan)

1. **输出预算仪表**：记录 `promptLength`、`rawText.length`、`estimateTokens(rawText)`、`MAX_OUTPUT_TOKENS`，并保存到日志。
2. **Prompt 分段对照**：按 section 开关逐一禁用（结构蓝图、指南、风格等），比较输出长度与截断率。
3. **拆分生成试验**：先生成骨架（结构/布局），再生成内容与样式，测量截断下降幅度。
4. **格式替换实验**：对比邻接表 vs 树结构输出对 token 长度的影响。
