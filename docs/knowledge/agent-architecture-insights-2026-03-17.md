# Agent 架构认知沉淀 (2026-03-17)

从 Claude Visualizer 逆向分析出发，对比我们的 Figma agent 架构，得出以下认知。

---

## 一、Runtime 即浏览器

### 核心类比

```
Claude Visualizer:  LLM 输出 HTML → 浏览器渲染（浏览器是 runtime）
Claude Code:        LLM 输出命令 → shell 执行（操作系统是 runtime）
我们的 Figma Agent: LLM 输出 mk 命令 → executor 翻译成 Figma API（executor 是 runtime）
```

三者做的是同一件事：**LLM 表达意图，runtime 负责执行。** 区别在于 runtime 的成熟度。

### 为什么我们必须自己造 runtime

- 浏览器是现成的通用 runtime，理解 HTML
- 操作系统 shell 是现成的通用 runtime，理解 bash 命令
- **Figma 没有对应的通用 runtime** — 不存在一种"语言"扔进 Figma 它就能直接渲染
- 我们的插件跑在 iframe 沙盒里，无法访问操作系统 shell
- 所以 commandParser + toolDispatcher + executor + handlers = 我们自己造的"浏览器"

### 我们的 runtime 链路

```
LLM 输出 → commandParser（HTML Parser）→ toolDispatcher（请求路由）
         → executor（渲染引擎核心）→ handlers（CSS 属性引擎）
         → Figma canvas（屏幕）→ presentation（DevTools 输出）
```

---

## 二、核心问题：Runtime 不够聪明

### 属性遗漏不是语法问题

- CLI 语法 vs JSON 参数 → 跟属性遗漏无关
- 参数多 vs 参数少 → 设计本来就需要很多属性，躲不掉
- **真正的问题：LLM 承担了太多 Figma 专业知识，runtime 承担得太少**

### 浏览器 vs 我们的 runtime

```
浏览器：忘了 display:flex → 默认 block → 页面还能看
我们：  忘了 layout:column → 没有自动布局 → 看起来像坏了
```

浏览器对遗漏是**宽容的**，我们的 runtime 对遗漏是**严格的**。

### 理想的职责分工

```
LLM 的职责（少）：
  1. 读文档（man）
  2. 表达设计意图（颜色、大小、布局方向、内容）

Runtime 的职责（多）：
  1. 属性依赖补全（alignMain → 自动加 layout）
  2. 值映射（column → VERTICAL）
  3. 节点类型适配（TEXT 不支持 layout → 静默忽略）
  4. 画布自动排列（自动计算 x/y，不重叠）
  5. readonly 容错（已实现 ✅）
  6. 渲染到 Figma
```

---

## 三、属性推断补全 — 让 runtime 变聪明

### 原理

Figma plugin-api.d.ts 的 Mixin 分组已经编码了属性依赖关系：

```typescript
interface AutoLayoutMixin {
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL'   // ← 前提条件
  primaryAxisAlignItems: ...   // ← 依赖 layoutMode
  counterAxisAlignItems: ...   // ← 依赖 layoutMode
  itemSpacing: number          // ← 依赖 layoutMode
  paddingLeft: number          // ← 依赖 layoutMode
  // ...
}
```

同一个 Mixin 里的属性共享同一个前提条件。

### 实现方式

不是新的架构层。在 executor 内部，handlers 之前加一步：

```typescript
const props = inferMissingProps(rawProps);  // ← 就这一行
for (const [key, value] of Object.entries(props)) {
  await applyProperty(node, key, value);
}
```

inferMissingProps 是一张声明式规则表：

```typescript
const IMPLIES: [string[], Record<string, any>][] = [
  [['primaryAxisAlignItems', 'counterAxisAlignItems', 'itemSpacing',
    'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'],
   { layoutMode: 'VERTICAL' }],
  // 从依赖链补充更多...
];
```

### 已有的容错（不需要重做）

- readonly 属性 → defaultHandler.ts 已静默跳过
- 无 setter 属性 → defaultHandler.ts 已处理
- COMPONENT_SET 的 layoutMode=NONE → 已拦截

### 还需要补的

| 需要做的 | 量 |
|---------|-----|
| 属性推断（inferMissingProps） | 一张规则表，<20 行 |
| 值映射（column → VERTICAL） | 一个字典 |
| 画布级排列（顶层 frame 不重叠） | 一个算法 |

Figma Auto Layout 本身已经是布局引擎（frame 内部的子元素排列由 Figma 计算），只有画布级的 x/y 需要我们处理。

---

## 四、Tool Call 架构对比

### 三种产品的 tool call

```
Claude Code:      {"name": "Read",        "args": {"file_path": "/src/foo.ts"}}
Claude Visualizer: {"name": "show_widget", "args": {"widget_code": "<div>...</div>"}}
我们的 Agent:      {"name": "run",         "args": {"command": "mk /Card/ frame w:400"}}
```

三者都是 JSON tool call。区别：
- Claude Code：每个操作独立 tool，参数是结构化 JSON
- Claude Visualizer：一个 blob 参数（HTML 字符串）
- 我们：一个 blob 参数（CLI 字符串）— 跟 Bash({command: "..."}) 同构

### 我们的模式和 Bash 同构

```
Bash({command: "npm test"})         → 操作系统 shell 解析执行
run({command: "mk /Card/ ..."})     → 我们的 parser 解析执行
```

不是"模拟 Unix"，是同一个设计模式：tool call 包一个字符串 blob，由专用 runtime 解析执行。

---

## 五、Claude Visualizer 逆向解析

### 架构

两步 tool call：
1. `read_me(modules: ["chart"])` → 懒加载设计规范到上下文
2. `show_widget({widget_code: "..."})` → HTML 直接注入 DOM（不是 iframe）

### 关键设计

- **DOM 注入而非 iframe** → CSS 变量直接继承，JS 函数直接调用
- **流式渲染** → style 先流 → HTML 中间流 → script 最后流
- **morphdom diff** → 不用 innerHTML，最小化 DOM patch，避免闪烁
- **CSP 白名单** → 安全靠 CDN 白名单，不靠 iframe 隔离
- **双向通信** → widget 内 JS 调 sendPrompt() 驱动对话继续

### i_have_seen_read_me 的本质

- 是 show_widget 的必填参数，LLM 自己填 true/false
- runtime 收到但不验证 — 没有人检查 LLM 是否真的调过 read_me
- 本质是 **prompt engineering 技巧**：把"提醒"伪装成"参数"，迫使 LLM 在生成时思考"我读过文档了吗"
- 是君子协定，不是技术强制

### 为什么 Claude Visualizer 质量高

不全是模型强或文档好 — 还因为**浏览器兜底**。
就算 Claude 忘了写 CSS 变量直接写 `color: #333`，页面照常渲染。
我们的 LLM 忘了 layout:column，布局直接坏。
差异不在 LLM，在 runtime 的宽容度。

---

## 六、Figma 插件环境约束

```
能做：✅ 完全操作 Figma 画布 | ✅ 读组件库 | ✅ 导出图片 | ✅ 跑 JS 计算
不能做：❌ 访问文件系统 | ❌ 跑 shell | ❌ 装包 | ❌ 访问操作系统
```

跑在 iframe 沙盒里 → 不能用操作系统 shell → 必须自己造 runtime。
在 Figma 领域做到极致 = **让 runtime 成为 Figma 领域的 shell**。

---

## 七、设计原则总结

1. **LLM 负责意图，runtime 负责细节** — LLM 说"居中的卡片"，runtime 补全 Figma 需要的所有技术属性
2. **runtime 应该像浏览器一样宽容** — 遇到不完整输入时推断补全，而非报错让 LLM 再跑一轮
3. **评估标准** — 改 executor 时问自己：这是让 runtime 更像浏览器还是更像编译器？
4. **Figma 类型定义是知识来源** — Mixin 分组 = 属性依赖关系，不需要从测试中一个个试
5. **语法不重要** — CLI vs JSON vs 其他格式都不影响属性遗漏问题，核心在 runtime 的智能程度
