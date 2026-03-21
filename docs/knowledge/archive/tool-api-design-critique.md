# 工具 API 设计批判 — 从 Workflow 自查报告看系统性缺陷

> 来源: 新对话按 workflow 文档执行 Codex Blog 生成任务，总分 1.6/5
> 日期: 2026-03-17
> 目的: 不是修 workflow 文档，而是找出工具设计本身的问题

## 核心发现

**Workflow 失败不是因为文档写得差，而是因为工具 API 让"按文档执行"这件事本身很难。**

具体表现：
- 30+ 次 MCP 调用 vs 目标 8 次（375% 膨胀）
- 12 次失败重试（修复占 50%+ 调用量）
- Phase 2/3 被跳过（因为 js 和 mk 之间的数据传递断裂）
- 创建了变量和样式但没绑定（因为没法可靠地引用它们）

---

## 缺陷 1: mk shorthand 不可发现、不可预测

### 现象
新对话用了 `ph:120`, `pv:96`, `cross:center`, `alignH:center`, `wrap:true` — **全部失败**。

### 根因
60+ 个 shorthand 没有在工具描述中列出。LLM 只能从名字猜测，而猜测的准确率很低：

| LLM 猜的 | 实际支持的 | 差异原因 |
|---|---|---|
| `ph:120` | `padding:120` 或 `pl:120 pr:120` | CSS 里 `ph` 不存在，Tailwind 有 `px-` 但缩写不同 |
| `pv:96` | `padding:96` 或 `pt:96 pb:96` | 同上 |
| `cross:center` | `alignCross:center` | `cross` 不是任何约定的缩写 |
| `alignH:center` | `textAlign:center` | `alignH` 暗示水平对齐，但 `align` 其实是 layout align |
| `wrap:true` | `wrap:wrap` | boolean 值 vs enum 值 |

### 设计问题
1. **三套心智模型冲突**: CSS props (`justifyContent`) + Figma native (`primaryAxisAlignItems`) + 自定义缩写 (`alignMain`) 混在一起，没有一致的命名规律
2. **错误静默忽略**: 无效 shorthand 不报错，直接被当成 passthrough 传给 Figma API，也可能静默失败。LLM 以为成功了但属性没生效
3. **没有 `man mk --props` 快速查表**: `man mk` 存在但需要知道去调用它。工具描述里应该内嵌 top-20 常用属性

### 建议
- **A. 在 `run` 工具描述的 mk 部分直接列出 top-15 常用 shorthand**（不需要 man 调用）
- **B. 无效 shorthand 应该返回 warning**（"'ph' is not a recognized shorthand, did you mean 'padding' or 'pl/pr'?"）
- **C. 统一命名风格**: 要么全用 CSS 名（`padding-inline`），要么全用 Figma 名（`paddingLeft`），要么全用自定义缩写（`pl`）。不要三者混用

---

## 缺陷 2: js 返回值不可靠 / 不可预知

### 现象
新对话报告: js 命令只返回 `{"success": true}`，无法获取创建的变量 ID。

但在原始对话中，js 命令**是可以返回值的**（返回了完整的 ID map）。

### 根因分析
两种可能：
1. **调用方式差异**: `command: "js code"` vs `command: "js", input: "code"` 可能有不同的返回行为
2. **return 语法问题**: 在 `jsHandler.ts` 中，expression form 自动 return，statement form 需要显式 `return`。如果代码有 `return` 关键字但 `hasReturn` 检测不对，可能走了错误分支

### 设计问题
1. **两种调用模式行为不一致**: command 参数放代码 vs input 参数放代码，应该行为完全一致
2. **return 机制不透明**: 用户不知道什么时候需要写 `return`，什么时候自动 return
3. **序列化边界不清**: 返回 Figma 节点只取 `{id, type, name, width, height}`，其他属性被丢弃。用户不知道能拿到什么

### 建议
- **A. 统一 command 和 input 的行为**：两种方式应该完全等价，只是输入格式不同
- **B. 在工具描述里明确写**: "Expression form (无 return/=>) 自动返回最后一个表达式的值。Statement form (有 return/=>) 需要显式 return。"
- **C. 返回值应该 echo 在工具输出里**: 即使 `run` wrapper 包装了结果，`data` 字段不应该被吞掉

---

## 缺陷 3: mk command vs input 模式的行为分裂

### 现象
- `command: "mk /path/ type props..."` — upsert 模式（存在则更新）
- `input: "mk /path/ type props...\nmk /path2/ ..."` — **总是创建新节点**，导致出现 `Title_2`, `Body_2` 等重复节点

### 设计问题
1. **同一工具两种语义**: 表面上是"多行 vs 单行"的区别，实际上是"create vs upsert"的区别。这是隐藏的语义变化
2. **修复成本高**: 创建了重复节点后需要手动 `rm` 清理，浪费 2+ 轮调用
3. **Workflow 无法描述**: 文档写"用 mk 创建/更新"——到底用哪种模式？什么时候 upsert 什么时候 create？

### 建议
- **A. input 模式也应该支持 upsert**（和 command 行为一致）
- **B. 或者明确文档**: "input 模式 = batch create（总是新建），command 模式 = upsert（存在则更新）"
- **C. 创建重复节点时返回 warning**: "Node 'Title' already exists, created 'Title_2'. Use command mode for upsert."

---

## 缺陷 4: js 和 mk 之间没有数据传递通道

### 现象
Phase 1 (js) 创建变量，返回 ID map → Phase 2+ 需要用这些 ID。但：
- 如果 js 返回值不可靠，ID 就丢了
- 后续 Phase 只能用 `figma.variables.getLocalVariablesAsync('FLOAT')` 重新查找
- 或者用 `findOne(n => n.name === 'xxx')` 按名字查找，但名字可能重复

### 设计问题
**工具之间是无状态的**。每次 MCP 调用是独立的，没有会话概念。这意味着：
1. Phase 1 创建的变量 ID 无法传给 Phase 2
2. Phase 2 创建的组件 ID 无法传给 Phase 4
3. 每个 Phase 都要"重新发现"之前创建的东西

### 这是 Workflow 跳过 Phase 2/3 的真正原因

不是因为"想快速出效果"——是因为 Phase 1 创建的变量 ID 无法可靠传递到 Phase 2，LLM 觉得"反正用不到"就跳过了。

### 建议
- **A. js 返回值必须可靠且明确** — 这是最重要的修复。如果 return 能工作，Phase 间数据传递就解决了
- **B. 提供 `vars` 或 `list-vars` 命令** — 列出当前所有变量集合和变量名/ID，类似 `ls` 列出节点
- **C. 提供按名查找变量的快捷方式** — `js figma.variables.getLocalVariablesAsync('FLOAT')` 太长了，可以封装成 `vars list --type=FLOAT`

---

## 缺陷 5: Component Set 创建路径断裂

### 现象
Workflow 要求用 `figma.combineAsVariants()` 创建 Component Set，但新对话完全跳过了（Phase 3 未执行）。

### 根因
Component Set 创建**只能用 js**，但 js 的使用门槛比 mk 高很多：
1. 需要写完整的 Figma API 代码（createComponent, layoutMode, appendChild...）
2. 需要手动 loadFontAsync
3. 需要精确的属性名和值格式
4. 出错没有 rollback

### 设计问题
mk 能创建 frame, text, rectangle, ellipse, component... **但不能创建 component set**。这是一个关键能力断层：

```
简单操作（mk 能做）─────────能力断崖──────────复杂操作（只有 js 能做）
frame, text, component        ←gap→         combineAsVariants()
属性设置                      ←gap→         variable binding
node 创建/更新                ←gap→         style 创建/引用
```

LLM 一旦遇到断崖，倾向于"不做"而不是"切换到 js"。

### 建议
- **A. mk 支持 `component-set` 类型**: `mk /CardGrid/ component-set variants:Desktop,Tablet,Mobile`
- **B. mk 支持 `bind` 操作**: `mk /Section/ bind paddingLeft:layout/containerPad` — 按变量名绑定
- **C. mk 支持 `style` 引用**: `mk /Title text textStyle:Heading/H1 -- Title Text`
- **D. 或者降低 js 门槛**: 提供 js helper 库（pre-loaded 的 `createAutoLayoutFrame()`, `createStyledText()` 等），减少样板代码

---

## 缺陷 6: Font weight 含空格的解析问题

### 现象
`weight:Semi Bold` — `Semi` 被当作值，`Bold` 被当作文本内容。

### 设计问题
mk 用空格分隔 key:value tokens，而 `Semi Bold` 包含空格。这是解析器的根本限制。

### 建议
- **A. 支持引号**: `weight:"Semi Bold"` 或 `weight:'Semi Bold'`
- **B. 支持连字符**: `weight:semi-bold` 自动映射到 `Semi Bold`
- **C. 支持无空格别名**: `weight:semibold` → `Semi Bold`

---

## 总结: 工具设计的系统性问题

| 层面 | 问题 | 影响 |
|---|---|---|
| **可发现性** | 60 个 shorthand 隐藏在 man 命令后面 | LLM 猜错 → 重试 → token 浪费 |
| **一致性** | mk 两种模式行为不同，js 返回值不确定 | LLM 无法建立可靠的心智模型 |
| **连续性** | 工具之间无状态，ID 传递断裂 | 多 Phase 工作流断裂，LLM 跳过步骤 |
| **能力断崖** | mk 做不了 component set / variable bind / style ref | LLM 遇到断崖就放弃而不是切 js |
| **错误反馈** | 无效属性静默忽略，重复节点无 warning | LLM 以为成功了，实际什么都没生效 |

### 优先级建议

1. **P0: js 返回值修复** — 确保 return 值可靠传回。这解决 Phase 间数据传递，是所有多步骤 workflow 的基础
2. **P0: 无效 shorthand warning** — 别静默忽略，告诉 LLM 正确的属性名
3. **P1: mk 支持 variable bind** — `bind paddingLeft:varName`，消除 js 断崖
4. **P1: mk 支持 style 引用** — `textStyle:Heading/H1`
5. **P2: mk shorthand 速查表内嵌到工具描述** — 不需要 man 调用
6. **P2: input 模式 upsert 行为统一** — 或明确文档区分
