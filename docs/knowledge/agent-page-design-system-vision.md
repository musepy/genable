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

## 待实现

### Phase 1：.agent page 生命周期
- [ ] 自动检测/创建 .agent page
- [ ] `var sheet [collection]` 命令 — 一键生成可视化色卡
- [ ] Palette 读取集成到 agent context assembly（`AgentOrchestrator.generate()` 层）

### Phase 2：双向同步
- [ ] agent 创建变量时自动更新 Palette
- [ ] 用户修改 Palette 色卡 → agent 下轮读取到最新状态（已天然支持，因为读的是画布节点）

### Phase 3：跨文件
- [ ] clientStorage 存储设计系统摘要
- [ ] 新文件检测到无 .agent page → 从 clientStorage 引导初始化
- [ ] 品牌指南 → 变量 → Palette 的一键提取流程

### Phase 4：完整 .agent page
- [ ] Components/ — 组件库索引
- [ ] Brief/ — 设计方向文本
- [ ] Memory/ — agent 决策记录、用户偏好

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
