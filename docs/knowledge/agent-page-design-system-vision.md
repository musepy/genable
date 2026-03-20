# .agent Page — 可视化设计系统与持久记忆

> 2026-03-17 讨论总结。从"agent 不会管理 variable/variant"出发，推演出 .agent page 作为 agent 与用户的共享工作台。

## 问题链

### 1. 起点：agent 不会创建/管理 variable 和 variant

用户选中品牌指南让 agent 生成设计系统，结果 agent 只创建了：
- 文本节点写着 `$color/primary/100`（不是真变量）
- 嵌套的子 frame（不是真 variant）
- 51 个散落节点，全是"描述"而非"实现"

**根因**：agent 没有结构化的 variable/variant 管理命令。

### 2. 解决：新增 `var` 和 `comp` 命令组

已实现并验证（commit bf2d069）：

```
var ls / var mk / var bind / var alias    — 变量 CRUD
comp create / comp combine / comp prop / comp ls / comp instance  — 组件/变体管理
```

12 个子命令全部在真实 Figma 环境中通过 MCP 验证。

### 3. 新问题：agent 怎么感知已有的变量和组件？

工具有了，但 agent 不知道：
- **去查** — 不会主动 `var ls` 发现已有 799 个变量
- **用** — 即使知道有 `Colors/Gray/12`，也不会用 `$varName` 而是硬编码 `#hex`

### 4. 进一步：操作变量/样式不直观，模型容易混淆

- 变量藏在 Variables 面板，对用户不可见
- LLM 在抽象的文字列表里容易混淆新旧变量
- 如果每一步都能**可视化在画布上**呢？

### 5. 再进一步：跨文件持久化

- 用户打开新文件，agent 如何快速了解设计系统？
- 能不能有一个专用空间，agent 可以创建、索引、读写，作为持久记忆？

## 核心方案：.agent Page

### 概念

一个专用 Figma page，同时是三件事：

| 角色 | 说明 |
|------|------|
| **Agent 的 context** | 每轮 `tree /Palette/` 读取 token，不用遍历 799 个变量 |
| **用户的编辑面板** | 不满意？切到 .agent page 直接改色卡/加 token |
| **持久记忆** | Figma 自动保存，下次打开文件 agent 直接读 |

### 结构

```
📄 .agent (page)
│
├── 🎨 Palette/              ← 当前设计系统 token
│   ├── Colors/               ← 色卡，fill 绑定 Figma 变量
│   │   ├── Primary/          ← Swatch(绑定$primary) + Name + Value
│   │   ├── Secondary/
│   │   └── ...
│   ├── Spacing/              ← 间距可视化条 (frame width = 实际值)
│   │   ├── xs (w:8)
│   │   ├── sm (w:16)
│   │   └── ...
│   └── Typography/           ← 字体样本 (实际 size/weight/leading)
│       ├── H1 48px
│       ├── H2 36px
│       └── ...
│
├── 🧩 Components/            ← 组件库索引（instance 预览）
│
├── 📋 Brief/                 ← 设计方向、品牌简述
│
└── 📝 Memory/                ← agent 工作记忆（决策记录、用户偏好）
```

### 关键设计决策

**色卡 fill 绑定 Figma 变量（不是硬编码）**：
- 改变量 → 色卡自动更新
- agent 读色卡 = 读变量的可视化表示
- 用户看到的就是 agent 使用的

**Palette 是策划后的子集，不是全部变量**：
- 文件可能有 799 个 Radix 色彩变量
- Palette 只放当前项目实际使用的 5-10 个 token
- Agent 读 Palette 获取**有用的** context，不被无关变量淹没

**间距用 frame width 编码**：
- `xs` frame w:8 → agent 读到 width=8 就知道 xs=8px
- 视觉上也直观：越宽 = 间距越大

**字体用实际样式渲染**：
- H1 节点本身就是 48px Medium → agent 从属性直接读到规范
- 不需要额外的元数据

### 运行时流程

```
Agent 启动 (run())
  │
  ├── 检测 .agent page 是否存在
  │    ├── YES → tree /.agent/Palette/ → 读取 token context
  │    │         → 用 $varName 创建新设计
  │    │
  │    └── NO  → 读 clientStorage 摘要（跨文件）
  │             → 提示用户初始化 or 从品牌指南提取
  │
  ├── 执行设计任务
  │    → 创建节点时用 fills:$primary 绑定变量
  │    → 新增 token 时同步更新 Palette
  │
  └── Turn 结束
       → 可选：将摘要写入 clientStorage（跨文件同步）
```

### 跨文件策略

两层结合：

| 层 | 存储 | 范围 | 内容 |
|----|------|------|------|
| clientStorage | figma.clientStorage | 全局（跨文件、跨会话） | 轻量摘要：上次用的 collection 名、主要颜色、风格关键词 |
| .agent page | Figma page 节点 | 当前文件 | 完整可视化：色卡、间距、字体、组件、记忆 |

- 新文件 → agent 从 clientStorage 读摘要 → 快速建立初始 context
- 已有 .agent page → 直接读取
- 用户也可以跨文件复制 .agent page（Figma 原生支持）

## 原型验证

已在 Figma 中通过 MCP 验证：

1. ✅ 创建 .agent page（`figma.createPage()`）
2. ✅ 创建 Palette/Colors — 4 个色卡，swatch fill 绑定变量
3. ✅ 创建 Palette/Spacing — 5 级间距可视化
4. ✅ 创建 Palette/Typography — 5 级字体样本
5. ✅ `tree /Palette/ -d 2` 一次调用读取完整设计系统 context
6. ✅ `var bind` 将变量绑定到色卡 swatch

## 三层认知模型（2026-03-19 扩展）

从 .agent page 出发，推演出 agent 的完整认知生命周期：

### Layer 1: Session Scope（当前会话）

**已实现**（2026-03-19）：`pathResolver.ts` 的 session node preference。

- Agent 创建的节点 → 自动进入 `sessionNodeIds`
- 路径解析遇到同名 siblings → 优先选 session 内的节点
- "新设计"时清空 session

**解决的问题**：画布上有多个同名节点（如多次测试留下的 "Card"），`sed /Card/` 总是命中第一个而非当前 session 创建的那个。

**Agent 主动判断**：扫描 ≠ 进入上下文。Agent ls 一个 page 看到 50 个 frame，它判断哪些值得探索、哪些是草稿。不是被动收录一切。

### Layer 2: Workspace Memory（跨对话持久化）

类比 Claude Code 进入代码仓库后建 CLAUDE.md：

- **`.agent` page**（Figma page）= 工作区的 "CLAUDE.md"
- 包含：对话摘要、提取的 design tokens、palette、learned patterns
- **启动时自动发现**：agent 启动 → 扫描 pages → 找到 `.agent` page → 加载为上下文
- **也支持用户指定**：settings 或对话中指定

### Layer 3: Design System Knowledge（可学习的设计规范）

**核心洞察**：design system 的"可读表示"和"可消费表示"是两件事。

| | 给人看 | 给 Agent 看 |
|---|---|---|
| 色板 | 视觉色块 + 标注 | `{ primary: "#000", secondary: "#475569" }` |
| 字体 | "Aa" 预览 + 尺寸示意 | `{ headline: { family: "Space Grotesk", size: 32 } }` |
| 组件 | 交互式预览 | component set ID + variant properties |

参考 Linearis 插件的 **DESIGN.md** tab 概念 — Theme tab 给人看，DESIGN.md tab 给工具消费。

**结构约定**（类似 skill 的 SKILL.md）：
- Frame `name` = 知识条目名
- Frame 内第一个 text node（或 `_description`）= 描述
- 子节点 = 实际设计内容（样式示例、组件实例）
- 支持富文本：markdown 标记在 text 内容里，agent 解析时识别

### 沟通方式

Agent 不是机械汇报"Learned: X"，而是自然描述**看到什么、理解什么、怎么用**：

> "Your palette uses 4 seed colors with a cool-neutral secondary — I'll match this tone for surfaces and borders."
> → View palette [link:NODE:xxx]

在对话气泡里输出可点击的超链接，指向具体 design system 节点。

### 宽容输入，显式输出

| 输入方式 | Agent 行为 |
|---|---|
| 粘贴 Figma 链接 | `cat` → 分析 → 提取 |
| 选中 frames | 读取 selection → 分析 |
| Design system page 有清晰命名 | 自动识别 |
| Frame 叫 `Frame 2435367` | 靠内容结构识别（有色块+标注 = 色板） |
| 纯草稿/探索性内容 | 不提取，不进入上下文 |

**"不能无效宽容"**：只有 agent 明确判断为"对后续设计有指导意义"的内容才进入上下文，并在气泡里显式告诉用户它打算怎么用。用户可以纠正。

### Context Budget

不是所有 design system 都塞进 prompt：
- **Indexed but not loaded**：agent 知道有哪些条目（名字+描述），不默认全加载
- **On-demand retrieval**：用到某个 pattern 时才 `cat` 读取详细内容
- 类比 `man [topic]` 的 knowledge 系统——有索引，按需查

### .agent page 内的结构化数据

```
.agent (Figma Page)
├── _config              ← agent 配置（JSON in text node）
├── _design.md           ← 提取的结构化知识
│   "palette: { primary: #000, ... }"
│   "typography: { headline: Space Grotesk/32 }"
│   "source: [link:NODE:xxx]"  ← 回链到原始节点
├── _memory              ← 对话摘要、用户偏好
├── Palette/             ← 可视化色卡（绑定 Figma 变量）
├── Typography/          ← 字体样本
└── Components/          ← 组件库索引
```

### 首次进入（Onboarding）流程

```
Agent 启动
  → 扫描 pages，发现 "Design System" page
  → ls → tree → 选择性 cat 关键节点
  → 判断：这是色板、这是字体规范、这是组件集
  → 提取结构化摘要 → 写入 .agent/_design.md
  → 对话气泡：
    "I found your design system:
     • 4-color palette anchored on pure black → View [link]
     • Space Grotesk headlines + Inter body → View [link]
     • Button component with 4 variants → View [link]
     Need me to adjust anything?"
```

### 再次进入（Warm start）流程

```
Agent 启动
  → 发现 .agent page → 读 _design.md
  → 已有结构化知识，直接加载为上下文
  → 检查 source links 是否仍然有效
  → 如有变化，增量更新
```

## 待实现

### Phase 1：Session Scope + .agent page 生命周期
- [x] Session-scoped path preference（pathResolver.ts）
- [ ] 自动检测/创建 .agent page
- [ ] `var sheet [collection]` 命令 — 一键生成可视化色卡
- [ ] Palette 读取集成到 agent context assembly

### Phase 2：Design System Learning
- [ ] 结构化提取：从 Design System page 提取 tokens → _design.md
- [ ] Onboarding 流程：首次扫描 + 自然语言反馈
- [ ] 双向同步：agent 创建变量时更新 Palette，用户改 Palette agent 下轮读到

### Phase 3：跨文件 + 持久化
- [ ] clientStorage 存储设计系统摘要
- [ ] 新文件 → 从 clientStorage 引导初始化
- [ ] 品牌指南 → 变量 → Palette 的一键提取流程

### Phase 4：完整认知生命周期
- [ ] Agent 主动判断内容价值（不是被动收录）
- [ ] 自然沟通风格（"I'll use this as..." 而非 "Learned: X"）
- [ ] 对话气泡中输出 design system 超链接
- [ ] Context budget 管理（索引 + 按需加载）

## Figma API 能力边界

| 能力 | 支持 | 说明 |
|------|------|------|
| 创建/管理 Page | ✅ | `figma.createPage()` |
| 持久化节点数据 | ✅ | Page 上的节点自动保存 |
| pluginData（文件内） | ✅ | `node.setPluginData(key, val)` — 隐藏存储 |
| clientStorage（跨文件） | ✅ | `figma.clientStorage.setAsync(key, val)` — per-user per-plugin |
| 变量绑定 | ✅ | `node.setBoundVariable()` / `setBoundVariableForPaint()` |
| Library 发布 | ⚠️ | 需要用户手动 publish，API 可触发但需权限 |
| 跨文件直接访问 | ❌ | Plugin API 只能操作当前文件 |
