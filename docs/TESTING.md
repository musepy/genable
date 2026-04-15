# Testing Guide — Figma AI Generator Plugin

> 本项目是 Figma 桌面端插件，运行在三线程架构（UI / Sandbox / Main thread）中，
> 依赖 Figma Plugin API（仅桌面端可用）和 LLM API（Gemini Flash）。
> 这决定了大部分真实 bug 无法被传统单元测试覆盖。

## 测试价值分层

```
                        发现真实 bug 的能力
                        ▲
                        │
  Figma 桌面端手动测试 ──┤█████████████████████████  最高（但最慢）
                        │
  Real API harness ─────┤███████████████████        高（LLM 行为 + agent 循环）
                        │
  tsc --noEmit ─────────┤██████████████             中高（重构安全网）
                        │
  vitest 纯逻辑 ────────┤█████████                  中（算法正确性）
                        │
  vitest mock Figma ────┤████                       低（虚假安全感）
                        │
  eslint ───────────────┤██                         最低（风格噪音）
                        └─────────────────────────→
```

## 规则：什么该测，什么不该测

### MUST — 必须写测试

| 场景 | 原因 | 示例 |
|------|------|------|
| 纯算法/纯数据变换 | 不依赖外部运行时，测试结果可信 | `loopDetector.ts`, `topologicalSort`, `tokenEstimator.ts` |
| 状态机转换逻辑 | 分支组合多，人工难以覆盖 | `agentLoopPolicy.ts` phase 判定 |
| 解析器/序列化器 | 输入输出明确，边界条件多 | `toolResultCleaner.ts`, `errorParser.ts` |
| prompt 组装 | 确保关键 section 不丢失 | `promptComposer.ts` 必须包含 schema rules |

### SHOULD — 建议写，但要注意方式

| 场景 | 注意事项 |
|------|----------|
| Tool 参数验证 | 测 validator 本身，不要 mock 整个 Figma 去测 executor |
| IPC 消息格式 | 测序列化/反序列化，不测实际 message passing |
| LLM response 解析 | 用真实的 Gemini 响应 JSON 做 fixture，不要自己编造 |

### MUST NOT — 禁止写的测试

| 场景 | 原因 |
|------|------|
| Mock 整个 `figma.*` 来测节点创建 | Figma API 行为无法模拟（属性顺序依赖、layoutMode 前置、字体加载等），mock 通过 ≠ 真实通过 |
| Mock LLM SDK 来测流式响应 | 真实问题是网络中断、partial JSON、流中途切换 tool call，mock 测不出来 |
| Mock IPC 来测三线程通信 | 真实问题是消息丢失、超时、序列化溢出 |
| 凑覆盖率的测试 | 不如把时间花在 real API harness 上 |

## 测试类型详解

### 1. tsc --noEmit（类型检查）

```bash
npx tsc --noEmit
```

**用途**：重构时的安全网。改了一个类型定义后，tsc 告诉你所有下游调用点是否更新。

**局限**：项目中大量 `(node as any)[key] = value` 写法绕过了类型系统，tsc 对这些代码无能为力。

**规则**：
- 每次 PR 必须通过 tsc
- 新代码尽量避免 `as any` 强转
- 如果必须 `as any`，在旁边加注释说明为什么

### 2. vitest 单元测试（纯逻辑）

```bash
npx vitest run                          # 全量
npx vitest run src/engine/agent         # 指定目录
npx vitest run --reporter=verbose       # 详细输出
```

**只测纯逻辑**，判断标准：这个函数的输入输出是否完全不依赖 Figma API 或 LLM API？

```typescript
// GOOD — 纯函数，值得测
describe('topologicalSort', () => {
  it('should order parent before child', () => {
    const actions = [
      { tempId: 'child', dependsOn: ['parent'], action: 'createFrame' },
      { tempId: 'parent', action: 'createFrame' },
    ];
    const sorted = executor.topologicalSort(actions);
    expect(sorted[0].tempId).toBe('parent');
  });
});

// BAD — mock 了整个 Figma，通过了也说明不了什么
describe('createFrame', () => {
  it('should create frame with layout', () => {
    const mockFrame = { id: '1', appendChild: vi.fn() };
    vi.spyOn(figma, 'createFrame').mockReturnValue(mockFrame);
    // ... 这个测试通过了，但真实 Figma 里 layoutMode
    // 必须在 layoutSizingVertical 之前设置，mock 测不出来
  });
});
```

### 3. Real API Harness（LLM 集成测试）

```bash
# 基础用法
GEMINI_API_KEY=xxx npx vitest run src/engine/agent/__tests__/agent_realapi_harness.test.ts

# 指定模型
GEMINI_API_KEY=xxx GEMINI_MODEL=gemini-2.5-flash npx vitest run ...

# OAuth 模式
GEMINI_API_KEY=oauth-mode npx vitest run ...
```

**这是本项目最有价值的测试**。它用真实 LLM + mock Figma state，验证：
- Agent 是否能在合理 iteration 内完成任务
- Phase 转换是否正常（PLANNING → EXECUTION → VERIFICATION → complete_task）
- Tool call 序列是否合理（不是反复调同一个 tool）
- Token 消耗是否在预期范围内

**写新 harness case 的规则**：
- 每个 case 测一个具体的用户意图（"创建登录表单"、"修改按钮颜色"）
- 设置合理的 timeout（60-120s）
- 记录 iteration trace 和 token 用量，输出到 `docs/reports/`
- Mock Figma state 要能正确响应 inspect/patch，不要返回空数据

### 4. Figma 桌面端 Smoke Test（手动）

无法自动化，但最有价值。每次改动 executor 或 tool 逻辑后：

**最小验证流程**：
1. `node build.js` 构建插件
2. Figma 桌面端 → Plugins → Development → Import plugin from manifest
3. 输入 "Create a blue button with white text"
4. 验证：节点创建成功、颜色正确、文字可见、auto-layout 正常

**关注点**：
- `applyProps` 的属性顺序是否正确（layoutMode before sizing）
- 字体加载是否成功（fontBus fallback 是否生效）
- tempId → realId 映射是否正确
- 错误是否被 auto-retry 正确处理

## 写测试时的 Mock 规则

### 可以 Mock 的

```typescript
// LLM Provider — 测 agent 循环逻辑时
const mockProvider = {
  generateContent: vi.fn().mockResolvedValue({
    text: '',
    toolCalls: [{ name: 'complete_task', args: { summary: 'done' } }],
  }),
};

// IPC emit/on — 隔离 sandbox 线程依赖
vi.mock('@create-figma-plugin/utilities', () => ({
  on: vi.fn(),
  emit: vi.fn(),
}));
```

### 禁止 Mock 的

```typescript
// NEVER — Mock 了等于没测
vi.spyOn(figma, 'createFrame').mockReturnValue(fakeFrame);
vi.spyOn(figma, 'loadFontAsync').mockResolvedValue(undefined);
vi.spyOn(figma, 'getNodeByIdAsync').mockResolvedValue(fakeNode);

// 这些 mock 隐藏了真实问题：
// - createFrame 后 appendChild 的时序
// - loadFontAsync 失败时的行为
// - getNodeByIdAsync 返回已删除节点的边界情况
```

### 替代方案：Stateful Mock

如果确实需要模拟 Figma 状态（比如 real API harness），使用 `MockFigmaState` 模式：

```typescript
// 参考 agent_realapi_harness_true_agent.test.ts 中的 MockFigmaState
// 它维护了一个内存中的节点树，能正确响应 inspect/patch
// 比逐个 vi.fn() mock 有用得多
class MockFigmaState {
  private nodes: Map<string, MockNode> = new Map();
  registerNodes(nodesFromLLM: any[]) { /* 建立节点树 */ }
  inspect(mode: string) { /* 返回当前状态的 DSL */ }
  recordPatch() { /* 记录修改 */ }
}
```

## Agent 修改代码后的检查清单

修改了以下文件后，对应的验证动作：

| 修改的文件 | 必须做 | 建议做 |
|-----------|--------|--------|
| `agentRuntime.ts` | tsc + 现有 vitest | real API harness |
| `executor.ts` / `batchExecutor.ts` | tsc | Figma 桌面端 smoke test |
| `tools/*.ts` (tool 定义) | tsc + prompt 测试 | real API harness |
| `promptComposer.ts` | tsc + prompt 单元测试 | real API harness（观察 LLM 行为变化） |
| `agentLoopPolicy.ts` | tsc + policy 单元测试 | real API harness |
| `loopDetector.ts` | tsc + vitest 单元测试 | — |
| `errorParser.ts` | tsc + vitest 单元测试 | — |
| UI 层 (`src/ui/**`) | 手动 Figma 桌面端 | — |

## 命令速查

```bash
# 类型检查（每次 PR 必须通过）
npx tsc --noEmit

# 单元测试
npx vitest run

# 指定文件
npx vitest run src/engine/agent/loopDetector.test.ts

# Real API harness（本地手动跑）
GEMINI_API_KEY=xxx npx vitest run src/engine/agent/__tests__/agent_realapi_harness.test.ts --reporter=verbose

# 构建插件（桌面端测试前）
node build.js

# Lint（优先级最低）
npx eslint "src/**/*.{ts,tsx}"
```

## 常见陷阱

1. **不要追求覆盖率数字** — 一个 mock 了 Figma API 的 100% 覆盖率测试 < 一个能跑通的 real API harness case
2. **不要在 CI 里跑 real API harness** — 它依赖外部 API，不稳定、有费用、有速率限制。本地手动跑就好
3. **不要为 `as any` 代码写类型测试** — 如果你需要 `as any`，说明类型系统在这里帮不了你，写运行时验证（validator）比写类型测试有用
4. **LLM 输出不可预测** — 不要写 `expect(toolCalls[0].name).toBe('generateDesign')` 这种断言，LLM 可能换顺序。测行为结果（"最终是否完成任务"），不测中间步骤
