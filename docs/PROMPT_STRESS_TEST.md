# Prompt Stress Test — 测试目标、环境还原与基准记录

> 文件路径: `src/engine/agent/__tests__/prompt_stress.test.ts`
> 运行命令: `DASHSCOPE_API_KEY=sk-xxx npx vitest run src/engine/agent/__tests__/prompt_stress.test.ts --reporter=verbose`
> 支持环境变量: `DASHSCOPE_MODEL` (默认 `qwen3-coder-plus`)

## 1. 测试目标

本测试用**真实 LLM API + 模拟 Figma 工具**来量化两个维度的 prompt 工程质量：

| 维度 | 定义 | 衡量方式 |
|------|------|----------|
| **A. 初始设计质量** | 模型能否一次性生成结构正确、属性完整的 XML | 违规数、首次 create 的 XML 长度、迭代次数 |
| **B. 多轮跟随合规** | 后续修改是否使用 edit（而非重建）、是否引用正确 ID | edit vs create 比例、ID 引用率、recreation 检测 |
| **C. 对话连续性** | 5 轮以上多轮对话中，模型是否保持一致行为 | 跨轮次 edit 一致性、上下文 summarizer 正确性 |

### 不测什么

- 不测视觉美观度（无渲染引擎）
- 不测 Figma API 运行时行为（属性顺序、auto-layout 解算）
- 不测 executor 正确性（那是 Figma 桌面端 smoke test 的职责）

### 与 TESTING.md 的关系

本测试属于 TESTING.md 中的 **"Real API Harness"** 层——测试价值仅次于 Figma 桌面端手动测试。

```
Figma 桌面端 smoke test  ──  视觉+运行时（无法自动化）
Prompt Stress Test        ──  agent 行为层（本文档）← 你在这里
vitest 纯逻辑             ──  算法/解析器（最快）
```

---

## 2. Figma 环境模拟：还原与边界

### 2.1 架构

```
┌──────────────────────────────────────────────────────┐
│  真实组件（与生产环境完全一致）                          │
│  ├─ DashScope LLM Provider (真实 API 调用)             │
│  ├─ AgentRuntime (3 层上下文、turn 管理、hook 管道)      │
│  ├─ 系统提示词 (从 prompt-catalog.json 加载)            │
│  ├─ 循环检测 hook (指纹+计数+中止)                      │
│  └─ 空响应 hook (重试逻辑)                             │
├──────────────────────────────────────────────────────┤
│  模拟组件（MockFigmaState）                             │
│  ├─ create → 解析 XML 标签, 分配 mock:N ID, 建立父子树   │
│  ├─ edit   → 计数 edited/deleted, 不实际修改属性         │
│  ├─ read   → 从内存树递归生成 XML（含 id/name/类型属性）  │
│  └─ query  → 返回静态知识文本 / 按名称搜索已有节点        │
└──────────────────────────────────────────────────────┘
```

### 2.2 还原度评估

| 维度 | 还原度 | 说明 |
|------|--------|------|
| **LLM 推理** | ★★★★★ 100% | 真实 API 调用，响应完全来自模型 |
| **系统提示词** | ★★★★★ 100% | 从 prompt-catalog.json 构建，与生产一致 |
| **3 层上下文** | ★★★★★ 100% | AgentRuntime 真实运行，summarizer 在 turn 边界真实执行 |
| **工具调用协议** | ★★★★★ 100% | 参数验证、tool dispatch、loopDetection hook 全部真实 |
| **XML 生成质量** | ★★★★★ 100% | 模型输出的 XML 是真实的，验证器检查属性完整性 |
| **create 父子关系** | ★★★★☆ 85% | 通过标签解析建立树，但不处理 tempId→realId 映射链 |
| **read 返回内容** | ★★★☆☆ 70% | 返回正确的树结构，但属性值是硬编码默认值，非模型指定值 |
| **edit 属性修改** | ★★☆☆☆ 40% | 仅计数，不实际修改节点属性（后续 read 不反映 edit 结果） |
| **视觉渲染** | ☆☆☆☆☆ 0% | 无 Figma 渲染引擎 |
| **auto-layout 解算** | ☆☆☆☆☆ 0% | fill/hug 的实际尺寸计算无法验证 |
| **属性应用顺序** | ☆☆☆☆☆ 0% | 真实 executor 有 PROP_ORDER（layoutMode 先于 sizing） |
| **字体加载** | ☆☆☆☆☆ 0% | FONT_FALLBACK 无法触发 |

### 2.3 关键局限及其影响

#### 局限 1: edit 不持久化

```
Turn 1: create → 模型创建 card，bg='#FFFFFF'
Turn 2: edit → 模型将 bg 改为 '#1F2937'
Turn 3: read → 返回的 XML 仍然是 bg="#FFFFFF"（mock 未更新）
```

**影响**：模型在 Turn 3 可能再次尝试修改，触发不必要的迭代。B4（换配色）测试中观察到此问题——模型在 Turn 2 执行了 3 次 read→edit 循环，因为每次 read 都返回旧状态。

**缓解方案**（未实施）：让 `processEdit` 解析 XML 中的属性变更并更新 `MockNode.props`，`generateReadXml` 使用更新后的属性。

#### 局限 2: read 属性为硬编码默认值

```typescript
// 当前实现
if (tag === 'frame') attrs += ` layout="column" w="fill" h="hug" bg="#FFFFFF"`;
```

模型创建了 `bg='#0F0F1A'` 的深色 frame，但 read 返回 `bg="#FFFFFF"`。这可能误导模型的后续决策。

#### 局限 3: 验证器对 edit XML 的误报

edit 操作只传递被修改的属性（如 `<frame id="mock:1" bg="#374151"/>`），验证器不应检查 `layout`/`w`/`h` 等完整属性。当前 B4 的 82 个 warning 中 100% 来自此误报。

### 2.4 什么可以被视为"有效还原"

定义：**如果一个行为在测试中表现正确，在真实 Figma 环境中也大概率正确，则为有效还原。**

| 行为 | 有效还原？ | 置信度 | 理由 |
|------|-----------|--------|------|
| 模型首次 create 输出完整 XML 骨架 | ✅ | 高 | XML 是模型生成的，与环境无关 |
| 后续 turn 使用 read→edit（非 recreate） | ✅ | 高 | 工具选择是模型决策，与环境无关 |
| edit XML 引用正确的 node ID | ✅ | 高 | ID 来自 read 返回，链路完整 |
| batch edit 一次修改多个节点 | ✅ | 高 | XML 内容是模型生成的 |
| 循环检测中止死循环 | ✅ | 高 | hook 真实运行 |
| 空 xml 参数错误后恢复 | ✅ | 高 | 验证器+错误反馈真实运行 |
| create 的 XML 在 Figma 中渲染正确 | ❌ | 低 | 需要真实 executor + 渲染引擎 |
| edit 后视觉状态符合预期 | ❌ | 低 | edit 不持久化，无渲染 |
| auto-layout 尺寸解算正确 | ❌ | 无 | 完全依赖 Figma 引擎 |

---

## 3. 测试基准（Baseline）

> 基准日期: 2026-03-07
> 模型: qwen3-coder-plus (DashScope)
> Prompt 版本: 含 4 项改进（xml 参数规则、batch edit、TOOL_VALIDATION_ERROR、最小正确模板）

### 3.1 A 组：初始设计质量

| 测试 | 耗时 | 迭代 | 首次 create XML 长度 | Error | Warning | 状态 |
|------|------|------|---------------------|-------|---------|------|
| A1: 复杂 Dashboard | 71.4s | 12 | 7001 chars | 1 (max iter) | 9 (sizing) | ⚠️ 可通过 |
| A2: 移动端 App | 21.5s | 5 | 2346 chars | 0 | 0 | ⚠️ 后续空 xml |
| A3: Landing Page | 13.2s | 1 | 全量 | 0 | 0 | ✅ 完美 |
| A4: 联系表单 | 13.7s | 1 | 全量 | 0 | 0 | ✅ 完美 |

**A 组基准线**：
- 简单/中等设计（≤15 nodes）应 1 次 create 完成，0 violations
- 复杂设计（40+ nodes）允许多次 create，但 error ≤ 15

### 3.2 B 组：多轮跟随合规

| 测试 | 操作类型 | T1 迭代 | T2 迭代 | T2 工具模式 | Error | Warning | Recreation |
|------|----------|---------|---------|------------|-------|---------|------------|
| B1: 改标题 | text edit | 1 | 2 | read→edit | 0 | 0 | 0 |
| B2: 改字体 | style edit | 7 | 2 | read→edit | 0 | 0 | 0 |
| B3: 换图标 | icon replace | 1 | 4 | read→edit×3 | 0 | 0 | 0 |
| B4: 换配色 | bulk style | 7 | 7 | read→edit→read→edit→... | 1 (T1 loop) | 82¹ | 0 |
| B5: 加元素 | add child | 1 | 2 | read→create | 0 | 0 | 0 |
| B6: 删元素 | delete | 1 | 2 | read→edit(delete) | 0 | 0 | 0 |

¹ B4 Turn 2 的 82 warning 为验证器误报（edit XML 不该检查完整属性）

**B 组基准线**：
- 后续 turn 必须使用 read→edit 模式（非 recreate）
- T2 迭代 ≤ 5（read + edit + optional verify）
- recreation 违规 = 0

### 3.3 C 组：对话连续性

| 测试 | 轮数 | 总耗时 | 总 Token | Error | Warning | Recreation |
|------|------|--------|----------|-------|---------|------------|
| C1: 5 轮迭代 | 5 | 101.2s | 459K | 12 | 14 | 1 |
| C2: 中英混合 | 3 | 35.8s | 129K | 0 | 0 | 0 |

**C 组基准线**：
- 中英混合指令：应零违规
- 5 轮迭代：允许部分 turn abort（复杂的 T1/T3），但后续简单修改（T2/T4/T5）应 ≤ 5 次迭代完成

### 3.4 已知模型级问题（非 prompt 可修复）

| 问题 | 表现 | 触发场景 | 影响 |
|------|------|----------|------|
| **空 xml 参数** | `create({})` 或 `edit({})`，XML 写入了 text 推理 | 第 2+ 次工具调用，尤其是大型设计 | 触发循环检测，浪费迭代 |
| **progressive creation 低效** | 一个节点一次 create 调用 | 复杂设计（A1 用了 12 次 create） | token 浪费 O(n²) |

这两个问题在 qwen3-coder-plus 上复现率约 40%。切换到 function calling 更强的模型（Gemini Flash、GPT-4o）预期可显著降低。

---

## 4. 测试用例一览

### A 组（初始设计）

| ID | 名称 | 复杂度 | 核心验证点 |
|----|------|--------|-----------|
| A1 | 暗色 Dashboard | 高 (40+ nodes) | 导航栏+侧边栏+指标卡+图表区 |
| A2 | 移动端健身 App | 中 (20+ nodes) | 375×812 约束、圆环进度、渐变 |
| A3 | SaaS Landing Hero | 中 (15 nodes) | 排版层级、48px/18px、CTA 按钮 |
| A4 | 联系表单 | 低 (10 nodes) | 输入框、textarea、提交按钮 |

### B 组（多轮跟随）

| ID | T1 创建 | T2 修改 | 核心验证点 |
|----|---------|---------|-----------|
| B1 | 简单卡片 | 改标题文字 | edit text content |
| B2 | 定价卡片 | 改字号+颜色 | edit style properties |
| B3 | 功能列表 | 换 3 个 icon | replace icon source |
| B4 | 登录表单 | 暗色主题全局换色 | bulk style edit across nodes |
| B5 | 用户卡片 | 底部加按钮+链接 | create child in existing parent |
| B6 | 通知横幅 | 删除 2 个按钮 | edit with delete |

### C 组（对话连续性）

| ID | 轮数 | 特点 |
|----|------|------|
| C1 | 5 | 创建 → 改色 → 加导航 → 改圆角 → 加阴影 |
| C2 | 3 | 英文创建 → 中文改标题 → 英文加区域 |

---

## 5. 违规类型参考

### Error 级（测试失败条件）

| 规则 | 含义 | 来源 |
|------|------|------|
| `TURN_ABORTED` | turn 因 max-iterations 或 loop-detection 中止 | AgentRuntime |
| `FRAME_MISSING_BG` | `<frame>` 缺少 `bg` 属性 | CORE.md §Frame Minimum |
| `TEXT_MISSING_FILL` | `<text>` 缺少 `fill` 属性 | CORE.md §Text Minimum |
| `FOLLOW_UP_SHOULD_EDIT` | 后续修改未使用 edit 工具 | WORKFLOW.md §Modification |
| `EDIT_MISSING_IDS` | edit XML 未引用已有 node ID | WORKFLOW.md §edit rules |

### Warning 级（质量指标，不阻塞通过）

| 规则 | 含义 | 来源 |
|------|------|------|
| `FRAME_MISSING_SIZING` | `<frame>` 缺少 `w`/`h`，默认 100×100 | CORE.md §Frame Minimum |
| `FRAME_MISSING_LAYOUT` | 有子节点的 `<frame>` 缺少 `layout` | CORE.md §Layout Context |
| `ICON_FORMAT` | icon 未使用 `prefix:name` 格式 | CORE.md §Icons |
| `FOLLOW_UP_RECREATED` | 后续修改疑似重建整个设计 | 启发式检测（>200 chars create） |

---

## 6. 运行与扩展

### 运行全量

```bash
DASHSCOPE_API_KEY=sk-xxx npx vitest run src/engine/agent/__tests__/prompt_stress.test.ts --reporter=verbose
```

### 切换模型

```bash
# DashScope 其他模型
DASHSCOPE_API_KEY=sk-xxx DASHSCOPE_MODEL=qwen-plus npx vitest run ...

# 对比不同模型需修改 provider 构造（当前仅支持 DashScope）
```

### 添加新测试用例

在 `prompt_stress.test.ts` 对应 group 内添加：

```typescript
it.skipIf(SKIP)(
  'B7: 新场景名称',
  { timeout: 300_000 },
  async () => {
    const { runTurn, getReport } = createStressHarness('B7-name');

    // Turn 1: 创建
    await runTurn('Create a ...');

    // Turn 2: 修改
    const t2 = await runTurn('把...改成...');

    const report = getReport();
    printStressReport(report);

    // 验证跟随合规
    const followUpViolations = checkFollowUpCompliance(t2, 2, {
      shouldUseEdit: true,
      shouldNotRecreate: true,
      shouldReferenceExistingIds: true,
    });
    report.violations.push(...followUpViolations);

    // 断言
    const errors = report.violations.filter(v => v.severity === 'error');
    expect(errors.length).toBe(0);
  },
);
```

### 用测试驱动 prompt 优化

1. 在 `src/prompts/*.md` 中修改 prompt
2. 运行 `node scripts/generate-prompt-catalog.js` 重新生成 catalog
3. 运行压力测试，对比违规数变化
4. 更新本文档 §3 的基准数据

---

## 7. 下一步改进方向

### 测试框架改进

| 优先级 | 改进 | 预期效果 |
|--------|------|----------|
| P0 | edit 持久化（processEdit 更新 MockNode.props） | B4 不再因 read 返回旧值而循环 |
| P0 | 验证器区分 create vs edit XML | 消除 B4 的 82 个误报 warning |
| P1 | read 返回模型指定的属性（非硬编码） | 更真实的模型反馈循环 |
| P2 | 支持多 provider 对比（Gemini / OpenRouter） | 量化模型差异 |

### Prompt/工具优化目标

| 目标 | 当前基准 | 期望目标 |
|------|----------|----------|
| A 组零违规率 | 2/4 (50%) | 3/4 (75%) |
| B 组零违规率 | 5/6 (83%) | 6/6 (100%) |
| A1 首次 create 完成度 | 部分骨架 (7001 chars) 需 12 次补充 | 完整骨架 1-3 次完成 |
| B4 bulk edit 迭代数 | 7 (read→edit 循环 3 次) | ≤ 3 (read→batch edit→verify) |
| 空 xml 参数发生率 | ~40% (A2, B4 T1, C2 T1) | ≤ 10% |
