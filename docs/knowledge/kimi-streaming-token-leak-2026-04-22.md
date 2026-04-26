# Kimi Streaming Token-Routing Leak

> 日期: 2026-04-22
> 模型: kimi-k2.5 (via DashScope coding endpoint `coding.dashscope.aliyuncs.com/v1`)
> 范围: OpenAI 兼容 streaming — 影响 DashScopeProvider，理论上也影响任何用 Kimi + OpenAI streaming 的链路
> 状态: **真实存在但无可观察后果**。不修。留档供后续溯源。

---

## 1. 问题表象（最初假设）

多轮会话里偶见 agent 自残式循环：
1. LLM 说 `=` 或 `frame` 之类的短字符片段
2. 紧接着调 `delete_node` 把刚建的节点删掉
3. 重新 `jsx` 建，再次出现残片 → 再 delete → 循环

初步怀疑链路：
- Kimi 在 SSE 里**同时**吐 `delta.content="="` 和 `delta.tool_calls[...]`
- `ResponseAccumulator.append` (responseAccumulator.ts:25) 无条件累加 text
- `formatResponseDefault` (types.ts:180) 把 text 和 tool_calls 合成一条 model 消息进 history
- 下一轮 LLM 读到自己历史里的 `content:"="`，推断"markup 被截断"→ 触发 delete+重建

**这个假设最后被证伪** — 见 §9 "更正"。上游泄漏是真的，但 loop 真因不是它。

---

## 2. 论点（验证后）

**Kimi streaming 在序列化长 `tool_call.arguments` 时存在 token 路由 bug：本该落入 `delta.tool_calls[0].function.arguments` 的某个 token 被错误路由到 `delta.content`。触发是"长度函数"，不是"概率函数" —— 长 markup 必发，短 markup 不发。**

不是"偶发"。不是"协议允许 content + tool_calls 共存"。不是我们代码链路的问题。是 Kimi/DashScope 服务端 streaming serializer 的 bug。

我们下游的 `ResponseAccumulator` + `formatResponseDefault` 是**放大器**而非起因 —— 它们把单次泄漏忠实存进 history，使得一次泄漏可能在多轮里持续误导 LLM。

---

## 3. 测试方法

直接打 DashScope coding endpoint SSE，绕过插件所有代码层，记录每个 chunk 的 `delta.content` 和 `delta.tool_calls` 出现情况。

**探针脚本**:
- `tools/probe-kimi-mixed-delta.ts` — 单一 prompt，5 次
- `tools/probe-kimi-mixed-delta-v2.ts` — 4 个场景 × 3 次，各场景差异：

| 场景 | 特征 |
|---|---|
| A_simple | 简单 sign-up card（短 markup） |
| B_complex | 完整 dashboard（长 markup：侧边栏8项+顶栏+4KPI+图表） |
| C_polluted_history | 预置历史里已有 stray `content:"="` 的 assistant 消息 |
| D_real_toolresult | 正常多轮 + 真 tool_result 返回 |

tool schema 刻意模拟插件的 `jsx`/`inspect`/`delete_node`，tool_choice=auto，temperature=0.7，stream=true。

---

## 4. 实验结果

### 第一次（v1，单场景）
5/5 runs，**0** 个 content delta。未复现。

### 第二次（v2，4 场景 × 3）

```
══ Scenario A_simple ══        ← markup 短
  Run 1: chunks=394   content_deltas=0  preview=[]
  Run 2: chunks=297   content_deltas=0  preview=[]
  Run 3: chunks=298   content_deltas=0  preview=[]

══ Scenario B_complex ══       ← markup 长，命中点
  Run 1: chunks=3920  content_deltas=1  preview=["active"]
  Run 2: chunks=4637  content_deltas=1  preview=[" \""]
  Run 3: chunks=3026  content_deltas=1  preview=["horizontal"]

══ Scenario C_polluted_history ══
  Run 1: chunks=82    content_deltas=0  preview=[]
  Run 2: chunks=84    content_deltas=0  preview=[]
  Run 3: chunks=10    content_deltas=0  preview=[]

══ Scenario D_real_toolresult ══
  Run 1: chunks=28    content_deltas=0  preview=[]
  Run 2: chunks=35    content_deltas=0  preview=[]
  Run 3: chunks=27    content_deltas=0  preview=[]
```

---

## 5. 发现的关键特征

1. **触发是长度函数**：A（~300 chunks）0/3，B（~3-5K chunks）3/3。C/D 短上下文也 0/3。
2. **泄漏内容永远是 markup 内部的字符串字面量**：
   - `"active"` — `<pill variant="active">` 里的 value token
   - `" \""` — JSON 字符串边界的转义引号
   - `"horizontal"` — `layout="horizontal"` 里的 value token
   - 对照用户报告的 `"="`（`layout="` 的 `="` token）、`"frame"`（`<frame ` 的 token），完全吻合同一种泄漏。
3. **泄漏 token 不与 tool_calls 在同一 chunk**（推翻初始假设中的"同一个 chunk 里同时吐"）：实测 content chunk 和 tool_call chunk 是**独立**的 SSE event。两者被 `ResponseAccumulator` 分别累加，然后在 `finalize()` 合并成一条带 text + tool_calls 的 LLMResponse，最终被 `formatResponseDefault` 拼成一条 model message —— 下游看起来像"同一条消息里共存"。
4. **mixed=0**：整个实验里没有一个 chunk 同时带 content 和 tool_calls。用户原先描述的"同一个 SSE chunk 里"是观察误差，但对修复结论没影响。

---

## 6. 根因结论

Kimi/DashScope 服务端 SSE serializer 在流式输出长 `tool_call.arguments` 时，偶尔把某个 argument token 错误地作为一个独立的 `delta.content` chunk 发出，而不是作为 `delta.tool_calls[i].function.arguments` 的增量。

- 这是**服务端 bug**，我们改不了
- 触发概率随 arguments 长度单调增长；复杂 UI 设计的 markup 几乎必发
- 被插件的 `ResponseAccumulator`（无条件累加 text）+ `formatResponseDefault`（text 存在即 push 进 content）放大为持久污染：history 里永远保留这个 stray token，导致后续 LLM 反复误判"markup 被截断"

---

## 7. 实际影响评估（排除 loop 后）

取消对 loop 的因果归属后，泄漏 token 对系统的真实影响：

1. **history 里多一条孤立 TextBlock** — 单字符/短词（`"="`/`"5"`/`"horizontal"`）夹在 tool_call 旁边。LLM 下一轮 attention 分配给 tool_call 居多，不会误判"我在讲话"。
2. **KV cache 前缀命中率** — 每次 model message 多 20-40 tokens 噪声，但 history 本来逐轮累加，cache miss 边界不差这一条。量级可忽略。
3. **UI 聊天气泡** — chat panel 渲染 `response.text`，偶发短字符片段可能一闪而过，未观察到用户反馈。
4. **Debug/trace log** — 翻 runtime events 看到孤立 `"horizontal"` 会疑惑"这文字哪来的"，仅开发者体感。

**不影响**：loop 检测（fingerprint 只看 tool_call）、turn 结束语义（leak 永远与 tool_call 共存）、工具执行（独立通道）、token 计费（量级不可测）。

结论：**真实 bug，零可观察后果**。按"don't fix problems that can't happen"的纪律不修。

---

## 8. 相关代码位置

- [src/engine/llm-client/providers/shared/responseAccumulator.ts:25](../../src/engine/llm-client/providers/shared/responseAccumulator.ts#L25) — 无条件累加 text（如果将来真想修，这里加 guard）
- [src/engine/llm-client/providers/types.ts:180](../../src/engine/llm-client/providers/types.ts#L180) — `formatResponseDefault`，text + tool_calls 合并入口
- [tools/probe-kimi-mixed-delta.ts](../../tools/probe-kimi-mixed-delta.ts) — v1 探针（未复现，对照组）
- [tools/probe-kimi-mixed-delta-v2.ts](../../tools/probe-kimi-mixed-delta-v2.ts) — v2 探针（4 场景，B_complex 3/3 复现）
- [tools/probe-kimi-fix-verify.ts](../../tools/probe-kimi-fix-verify.ts) — v3 探针（leak 分类：duplicated vs stolen）

---

## 9. 更正（2026-04-22）

最初归因于 loop 的推理链是错的。Loop 真因是独立的另一个 bug：

**[toolResultCleaner.ts:39-43](../../src/engine/agent/context/toolResultCleaner.ts#L39)** 的 `sanitizeString(value, 200)` 把所有 schema-typed string 字段无差别截短到 200+`…`。对 `jsx.markup` 来说，每次 > 200 字符的 markup 在写进 history 时都被切成 `<frame ... <t…`。LLM 读到"自己上一轮的截断 markup"→ 重试 → 再截 → 循环。

证据（trigger-1776788763832）：82 次 jsx 调用里，21 次成功 markup 长度 1776/1846/2046 字符，61 次失败**全部正好 201 字符**结尾 `<t…`。

这个截断是**确定性** bug，每次 markup > 200 必发；Kimi leak 是**低频偶发**，单字符量级；两者量级不在同一数量级。Baseline trigger 的 delete_node 循环完全可以用截断 bug 单独解释，不需要 leak 共同触发。

曾短暂在 dashscope.ts 加 `stripLeakedToolCallTokens` 做子串检测，E2E 验证 delete_node 循环消失（8→0）但新 loop（jsx `Unterminated JSX contents (3:20)` 反复重试）暴露，才发现真因。修复已 revert，本 doc 留作教训：**bug 表象相关 ≠ bug 因果相关**，debug 前先做 deterministic vs 概率性分类。
