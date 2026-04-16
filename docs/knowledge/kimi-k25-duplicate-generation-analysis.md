# Kimi K2.5 重复生成分析

> 2026-04-05 — 17 轮 E2E 测试（Kimi K2.5 ×13 + GLM-5 ×4），prompt: "Design a login page with email, password, and sign-in button"

## 核心结论

Kimi K2.5 有 **80% 概率**在一次 turn 中反复调用 `jsx` 创建同一个设计。每次 jsx 是独立 LLM 调用（~20s/次），markup 内容有微小差异（不是 replay 而是重新生成）。**这不是 context/compression 问题，是 LLM 行为问题。**

## 数据汇总

| Run | 时长 | 全页面 jsx | 重复? | knowledge | ask_user | 首次 jsx text |
|-----|------|-----------|-------|-----------|----------|-------------|
| 1   | 143s | 1         | 否    | ✓         | -        | -           |
| 2   | 233s | 7         | **是** | ✓        | -        | 202ch       |
| 3   | 180s | 6+1err    | **是** | ✓        | -        | -           |
| 4   | 210s | 6+4err    | **是** | ✓        | -        | -           |
| 5   | 188s | 4+1err    | **是** | -        | 62s      | -           |
| 6   | 51s  | 1         | 否    | -         | -        | 144ch       |
| 7   | 307s | 2+1err    | **是** | ✓        | 120s     | -           |
| 8   | 204s | 5         | **是** | ✓        | 26s      | 202ch       |
| 9   | 149s | 5+1err    | **是** | ✓        | -        | -           |
| 10  | 107s | 4         | **是** | -        | -        | 115ch       |

- **重复率**: 8/10 = 80%
- **重复时 jsx 次数**: 平均 4.9（范围 3-7）
- **时间损耗**: 干净 run ~50-100s，重复 run ~150-300s（2-3x）

## 关键发现

### 1. 每个 jsx 是独立 iteration（独立 LLM 调用）

**不是**一次 LLM response 里多个 tool call。runtime events 确认每个 iteration 只返回 1 个 tool call。

```
Run 8 (duplicate):
  iter=1  knowledge  dur=2.8s
  iter=2  jsx        dur=20.5s   ← 第一次创建
  iter=3  jsx        dur=19.8s   ← 重复
  iter=4  jsx        dur=20.2s   ← 重复
  iter=5  jsx        dur=21.7s   ← 重复
  iter=6  jsx        dur=22.6s   ← 重复
  iter=7  describe   dur=6.8s    ← 终于切换
```

### 2. Markup 每次不同（非 replay）

每次 jsx 的 markup 有微小差异：tag 数量 18-25，shadow 透明度变化，偶尔结构不同。LLM 在重新生成设计，不是重放相同输出。

```
jsx #2: 2283ch, 23 tags, shadow=#0000000F
jsx #3: 2415ch, 22 tags, shadow=#00000014
jsx #4: 2215ch, 22 tags, shadow=#00000014
jsx #5: 2385ch, 22 tags, shadow=#00000014
jsx #6: 2409ch, 22 tags, shadow=#00000014
```

### 3. Context 大小不是区分因素

干净和重复 run 在 iter 2 的 context 大小相近：

```
Run 6 (clean):  iter 2 turnChars=1331  → calls describe ✓
Run 10 (dup):   iter 2 turnChars=1411  → calls jsx again ✗
```

Intra-turn compression 对两者的行为一致（~50% 压缩率）。LLM 在相似 context 下做出不同决策。

### 4. 首次 jsx 有 text，重复 jsx 无 text

```
Run 6:  iter 1  jsx text=144ch  (有伴随文字说明)
Run 10: iter 1  jsx text=115ch  (有伴随文字说明)
        iter 2  jsx text=0      (静默重复，无解释)
        iter 3  jsx text=0      (静默重复)
        iter 4  jsx text=0      (静默重复)
```

重复 jsx 调用时 LLM 不输出任何 text，只生成 tool call。这暗示 LLM 进入了某种"工具生成循环"。

### 5. 最终都会自行停止

LLM 在 4-7 次重复后总会切换到 describe/edit。不会无限循环。

## 对照实验

### GLM-5 对照（4 轮）

| Run | 时长 | 全页面 jsx | 重复? | 总 tool calls |
|-----|------|-----------|-------|--------------|
| G1  | 63s  | 1         | 否    | 5            |
| G2  | 100s | 1         | 否    | 8            |
| G3  | 222s | 1         | 否    | 22           |
| G4  | -    | -         | -     | (未完成)      |

**GLM-5 重复率: 0/3 = 0%**。同样的 prompt、同样的 runtime、同样的 tool 定义和 result 格式，GLM-5 从不重复创建。**确认是 Kimi K2.5 模型特有问题。**

### Temperature 实验（Kimi K2.5, temp 0.7 → 1.0）

| temp | Round | 全页面 jsx | 模式 |
|------|-------|-----------|------|
| 0.7  | 平均  | 4.9       | 静默重复（text=0）|
| 1.0  | R1    | 3         | 静默重复 |
| 1.0  | R2    | 5         | 静默重复 |
| 1.0  | R3    | **18**    | JSX 解析错误 → 创建/删除疯狂循环 |

temp=1.0 不能修复，反而加剧：
- **静默模式**（text=0）仍然存在
- **新增"恢复模式"**：高 temp 导致 JSX 语法出错 → agent 认为"结构有问题" → 尝试"不同方式"重建 → 创建新根节点 → delete → 再创建

Agent 在 temp=1.0 R3 的自述：
> "I'm hitting a persistent JSX parsing error... Let me try a completely different approach — I'll build the login page step by step with a simpler structure"

**排除 temperature 假设。**

## 排除的假设

| 假设 | 证据 | 结论 |
|------|------|------|
| streaming 解析 bug 拆分了 tool call | 每次 iter 只有 1 个 tool call，markup 内容不同 | ❌ 排除 |
| intra-turn compression 丢失了上下文 | 干净和重复 run 的 context 大小相近 | ❌ 排除 |
| knowledge() 触发膨胀 → 过度压缩 | Run 5、10 没有 knowledge 也重复 | ❌ 排除 |
| Gemini fallback 导致 | API fix 后 (Run 6-10) 仍然重复 | ❌ 排除 |
| Temperature 导致 | temp=1.0 仍然重复，且更严重（18 次） | ❌ 排除 |
| Runtime/prompt/tool 设计问题 | GLM-5 同样环境 0% 重复 | ❌ 排除 |

## 确认的根因

**Kimi K2.5 模型的 tool-use calibration 缺陷。** 模型在 tool-use mode 下有高概率进入重复调用模式，表现为两种子模式：

1. **静默重复**（主要，temp=0.7）: LLM 每次 response 只返回 1 个 jsx tool call，text=0，markup 每次微小差异。4-7 次后自行停止。
2. **恢复式重复**（高 temp 加剧）: JSX 语法出错 → agent 自认为需要重试 → 删除旧节点 → 重建 → 循环。

同一环境下 GLM-5 不受影响，排除所有 runtime 层面假设。

## 建议修复方向

### A. Agent Runtime 层（loopDetection 增强）
当前 loopDetection hook 基于 tool call signature 指纹。对 jsx 的重复检测可以更积极：
- 连续 2 次无 parentId 的 jsx → 立即阻止第 3 次
- 或: 第 2 次 jsx 前注入 "You already created Login Page at node 1196:110. Use describe() to validate it instead of creating again."

### B. jsx Tool Result 增强
在 jsx result 中加入更明确的信号：
```json
{
  "data": {...},
  "_hint": "Design created successfully. Next: call describe() to validate."
}
```

### C. System Prompt 强化
在 CREATION FLOW 段落增加：
```
NEVER call jsx a second time for the same design.
After jsx succeeds, proceed to describe — do NOT recreate.
```

### 优先级建议
**A > B > C**。Runtime guardrail 最可靠（不依赖 LLM 遵从指令）。Result hint 是辅助。Prompt 规则对 Kimi K2.5 的约束力最弱（80% 不遵守创建规则）。
