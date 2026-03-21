# 官方转换能力源码级逆向分析

> 分析日期: 2026-03-19
> 目标: 学习 Figma 官方转换能力背后的核心原理与可见实现，不复述 MCP 工具使用说明。

---

## 0. 结论先行

Figma 官方这几组“转换能力”不能被理解成 3 个对等的生成器：

- `generate_figma_design` 的核心更像一个 `rendered UI capture + import` 系统。
- Code Connect 的核心更像一个 `design node <-> code component anchor system`。
- `create_design_system_rules` 的核心更像一个 `policy synthesis layer`。

它们解决的是三种不同问题：

- 如何把运行时 UI 抓成稳定的中间表示。
- 如何给设计节点和代码组件建立可持久化的锚点。
- 如何在转换前注入统一约束，降低后续生成的自由度。

所以真正值得学习的不是工具名，而是底层模块：

- `capture`
- `anchor extraction`
- `mapping persistence`
- `policy injection`
- `validation loop`

---

## 1. 证据分级与方法

### 1.1 证据等级

- `Confirmed`: 有源码、抓到的 payload、或本地可见返回样本直接支持。
- `Inferred`: 有稳定输入输出行为支持，但中间实现不可见。
- `Unknown`: 当前没有足够证据，不能假装知道内部算法。

### 1.2 主要证据源

- [figma-capture-js-analysis.md](/Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/docs/knowledge/figma-capture-js-analysis.md)
- [figma-capture-pretty.js](/Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/docs/knowledge/figma-capture-pretty.js)
- [figma-design-to-code-analysis.md](/Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/docs/knowledge/figma-design-to-code-analysis.md)
- [figma-tools-and-prompts.md](/Users/daxiaoxiao/.codex/skills/figma/references/figma-tools-and-prompts.md)
- [SKILL.md](/Users/daxiaoxiao/.codex/skills/figma/SKILL.md)
- [SKILL.md](/Users/daxiaoxiao/.codex/skills/figma-implement-design/SKILL.md)
- 本地历史会话中缓存的官方文档摘要与 MCP 交互样本

### 1.3 方法约束

- 不把 MCP tool surface 当成内部算法。
- 能从源码确认的地方，只说源码能证明的东西。
- 需要依赖黑盒推断时，显式标为 `Inferred`。
- 当前没有可靠证据的地方，保留为 `Unknown` 并列出验证实验。

---

## 2. `generate_figma_design` 背后的捕获与导入链

### 2.1 已知实现链路

#### `Confirmed`

- Figma 官方存在一段可下载的前端捕获脚本 `capture.js`，会被注入到目标网页，对 DOM 树做递归遍历并序列化为结构化 JSON。
- 脚本入口有两类：
  - URL hash 自动触发
  - `window.figma.captureForDesign(options)` 程序化触发
- 脚本会处理：
  - DOM 递归遍历
  - computed style 提取
  - 默认值差量压缩
  - 图片/视频/canvas/font 资源收集
  - React Fiber 与 `data-fg-*` 源码元数据提取
  - 剪贴板或 HTTP POST 提交
- 提交通道有两种：
  - 剪贴板 HTML 注释载荷
  - `POST /capture/{captureId}/submit`

这些都能在 [figma-capture-js-analysis.md](/Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/docs/knowledge/figma-capture-js-analysis.md) 和 [figma-capture-pretty.js](/Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/docs/knowledge/figma-capture-pretty.js) 中直接看到。

#### `Inferred`

- `generate_figma_design` 真正依赖的不是“HTML 语义理解”，而是“已渲染页面的视觉/布局快照”。
- 服务端接收 capture payload 后，会执行一次“JSON intermediate -> Figma node tree”的导入编译。
- 多 capture 场景大概率不是一次性全量导入，而是 capture session + capture index 的增量提交模型。

#### `Unknown`

- 服务端如何从捕获 JSON 决定具体 Figma node 类型。
- 服务端如何做 Auto Layout 推断、绝对定位降级、组件合并与图像落盘。
- 服务端是否存在专门的 DOM->Figma 规则表，还是通用布局求解器。

### 2.2 可见数据结构与输入输出

#### 输入面

`Confirmed`:

- 输入并不是源码 AST，而是浏览器中的运行时页面。
- 可接受来源包括：
  - 网页 URL
  - HTML
  - 本地页面或 dev server

从可见实现看，真正被处理的是“运行后的 DOM + computed styles + 资源上下文”。

#### 中间载荷

`Confirmed`:

捕获脚本输出的顶层 JSON 至少包含：

- `root`
- `documentTitle`
- `documentRect`
- `viewportRect`
- `devicePixelRatio`
- `assets`
- `fonts`
- `experimental.reactFiberTree`

节点上可见字段包括：

- `tag`
- `attributes`
- `styles`
- `rect`
- `childNodes`
- `content`
- `placeholderUrl`
- `pseudoElementStyles`
- `declaredStyles`
- `sources`
- `relativeTransform`

这说明该工具的核心中间表示是“视觉/布局事实”，不是“设计意图”。

#### 输出面

`Confirmed`:

- 客户端侧输出是 capture payload，而不是 Figma 节点。
- HTTP 返回中出现 `claimUrl`、`fileUrl`、`nextCaptureId` 之类会话信息。

`Inferred`:

- Figma 服务端会将 capture payload 重建为 Figma 设计文件或插入到既有文件。
- 不同 `outputMode` 只是导入产物的落点差异，不改变客户端捕获逻辑本身。

### 2.3 核心算法与机制猜测

#### `Confirmed`: Rendered DOM Capture

- 不是读源码，而是读浏览器最后渲染结果。
- 文本通过 `Range` 与 `getClientRects()` 取真实几何。
- SVG 会克隆后内联样式。
- Canvas/Video 会栅格化成图片。

#### `Confirmed`: Style Diff Compression

- 维护一份默认样式字典，只输出非默认值。
- Grid 还会额外抓取声明值而非 computed 值，以保留 `fr/minmax/auto`。

#### `Confirmed`: Asset Normalization

- 图片会抓 blob 并序列化。
- AVIF/HEIF/HEIC 会被转成 PNG。
- 字体会记录 family、face、stretch、usage。

#### `Inferred`: Transport Envelope

- 剪贴板通道与 HTTP 通道共享同一类 capture payload。
- Figma 识别的关键并不是 HTML 结构本身，而是包在注释或 POST body 中的专用 envelope。

#### `Inferred`: Import Compiler

- 真正的“HTML/网页 -> Figma node”算法主要在服务端导入器。
- 它至少要解决：
  - node selection
  - absolute/flex/grid 降解
  - image/vector/text 落地
  - transform 映射
  - 资源与字体重建

### 2.4 我们真正该学什么

- 客户端采集器的价值远高于“自然语言描述网页结构”。
- 真正稳定的输入不是 DOM 语义，而是：
  - 几何
  - 差量样式
  - 资源
  - 源码元数据
- `generate_figma_design` 的强项是“高保真采集”，不是“高层语义建模”。
- 如果我们做自己的替代品，最值得直接学习的是：
  - DOM walker
  - style diff serializer
  - asset/font collector
  - transport envelope
- 最不该误学的是：把这个能力理解成“LLM 把代码翻成 Figma node”。

### 2.5 当前未知点与验证实验

- `Unknown`: 服务端导入器的 node synthesis 规则。
  - 实验: 用极小 HTML 样本分别只覆盖 `flex/grid/absolute/svg/canvas/video`，比较导入后的 Figma 结构差异。
- `Unknown`: Auto Layout 推断策略是否规则驱动。
  - 实验: 构造只差一条 CSS 的页面，观察导入产物是 `Frame+AutoLayout` 还是绝对定位。
- `Unknown`: capture session 是否支持服务端多阶段合并。
  - 实验: 使用多 capture 页面，记录 `nextCaptureId` 与导入结果的增量行为。

---

## 3. Code Connect 工具组背后的锚点系统

### 3.1 已知实现链路

#### `Confirmed`

- `capture.js` 明确存在源码位置提取逻辑：
  - 扫描 React Fiber
  - 从 props 或 DOM attributes 中提取 `data-fg-*`
  - 解析成 `SourceLocation`
- `SourceLocation` 结构中可见字段包括：
  - `fileGuid`
  - `filePath`
  - `fileVersion`
  - `line`
  - `column`
  - `pos`
  - `len`
  - `name`
  - `childTypes`
  - `isComponentDefinition`
  - `assetKey`
  - `makeLibraryId`
  - `libraryId`
  - `componentId`
  - `isLibraryInstance`

这说明 Figma 官方至少在一部分链路里，已经把“设计元素与代码实体的来源关系”编码进运行时元数据，而不是只靠后续猜测。

- 工具面上又存在三类分离操作：
  - `get_code_connect_map`
  - `add_code_connect_map`
  - `get_code_connect_suggestions`

这说明 Code Connect 至少被拆成：

- 已有映射读取
- 映射持久化
- 映射建议生成

#### `Inferred`

- Code Connect 的本体不是“代码生成器”，而是“稳定锚点系统”。
- 设计到代码时，锚点系统会把某个 Figma node 关联到：
  - 组件名称
  - 源码路径
  - 可能的 snippet/template
  - 设计属性到代码 props 的映射信息
- 历史官方文档摘要表明，映射存在时，design-to-code 结果里会注入 `CodeConnectSnippet` 一类结构，而不是重新自由生成整段组件代码。

#### `Unknown`

- 映射是保存在 Figma 文档、Figma 后端、还是混合存储。
- 建议算法基于规则、嵌入、AST 还是混合召回。
- 组件匹配时如何权衡：
  - 名称相似度
  - 视觉结构相似度
  - props 兼容度
  - 现有设计系统规则

### 3.2 可见数据结构与输入输出

#### 源数据面

`Confirmed`:

`capture.js` 可见的源数据入口是 `data-fg-*` 与 React Fiber props。也就是说，至少有一条官方链路会在前端运行时暴露可追踪的 source metadata。

这类元数据已经不只是“这段 DOM 来自哪个文件”，还包含：

- 是否组件定义
- 是否库实例
- 组件/库 ID
- 资产键

这已经接近一个 anchor extraction payload。

#### 映射对象

`Confirmed`:

从当前工具说明可见，返回的 map 至少有：

- `codeConnectSrc`
- `codeConnectName`

`Inferred`:

- 内部持久化对象很可能还包含：
  - Figma node identity
  - component identifier
  - 可选 template/snippet
  - prop mapping 或 variant mapping
  - label/framework 信息

#### 建议对象

`Inferred`:

- `get_code_connect_suggestions` 很可能返回一组候选映射，而不是单一答案。
- 候选结果大概率包含：
  - 候选组件
  - 来源路径
  - 匹配解释
  - 待确认映射项

### 3.3 核心算法与机制猜测

#### `Confirmed`: Anchor Extraction

- 通过 `data-fg-*` 和 Fiber props，可把运行时 UI 追溯回源码位置与组件身份。
- 这说明官方至少不完全依赖“视觉相似度反推组件”，而是优先拿可验证锚点。

#### `Inferred`: Component Identity Resolution

- `componentId/libraryId/isLibraryInstance` 这类字段表明，官方在意的不是单纯文件路径，而是跨库稳定身份。
- 真正稳定的 anchor 应该是多键组合：
  - 文档节点 ID
  - 组件名
  - 源码路径
  - 库/组件 ID

#### `Inferred`: Mapping Persistence

- 既然有 `get` 和 `add/update` 两类 API，映射必然不是即时推断，而是持久化资产。
- 这类资产的意义不是“帮助一次生成”，而是让后续转换可复用、可审计、可修正。

#### `Inferred`: Suggestion Loop

- `get_code_connect_suggestions` 更像召回与排序系统。
- 用户或 agent 确认后，再写回映射存储。
- 一旦写回，后续 design-to-code 就应优先消费映射而不是重新猜。

### 3.4 我们真正该学什么

- Code Connect 的核心启发不是“如何把 Figma 变成 React”，而是“如何给转换系统建立稳定锚点”。
- 真正值得学的是分层：
  - 抽取锚点
  - 持久化锚点
  - 检索锚点
  - 在生成阶段消费锚点
- 最值得重视的设计原则是：
  - 优先确定 identity，再做 translation
  - 映射应该是资产，而不是瞬时提示词
  - 建议生成与映射确认应解耦
- 最不该误学的是：把 Code Connect 当成“更聪明的代码生成器”。

### 3.5 当前未知点与验证实验

- `Unknown`: suggestions 的排序依据。
  - 实验: 准备多个名称接近但 props 结构不同的组件，比较建议结果排序。
- `Unknown`: 映射是否直接影响 design-to-code 输出结构。
  - 实验: 同一 Figma node 在映射前后分别做 design-to-code，比对输出是自由生成还是组件调用。
- `Unknown`: `data-fg-*` 是否是 Code Connect 唯一锚点来源。
  - 实验: 去掉运行时标记，仅保留组件路径映射，看 suggestions 是否还能稳定命中。

---

## 4. `create_design_system_rules` 背后的策略层

### 4.1 已知实现链路

#### `Confirmed`

- 当前可见工具说明里，`create_design_system_rules` 被描述为：
  - 无需 Figma 文件上下文
  - 生成一份 rule file
  - 这份规则文件会被后续 design-to-code 流程读取
- `figma` skill 也明确把“项目规则”放进 Figma 转代码流程里，要求所有 Figma-driven change 都遵守这些 rules。

这足以确认：它不是转换器本体，而是一个预先生成的约束层。

#### `Inferred`

- 这类工具的目标不是“直接产出代码”或“直接产出设计”，而是为后续 agent 提供 stack-aware guidance。
- 它大概率会根据：
  - 项目语言
  - 框架
  - 组件目录
  - token 约束
  - 设计系统约定
  生成一份可被后续流程反复消费的 rule bundle。

#### `Unknown`

- 服务端内部是模板拼装、规则检索，还是 LLM 生成。
- 输出的 rule file 是否有结构化 schema，还是纯自然语言。
- 规则与 Code Connect / design-to-code 在服务端是否共用同一 policy store。

### 4.2 可见数据结构与输入输出

#### 输入面

`Confirmed`:

工具说明里可见输入非常少，甚至不依赖具体 Figma 节点。

`Inferred`:

真实有效输入更可能来自环境上下文：

- framework
- language
- repo conventions
- existing design system
- token naming
- component organization

#### 输出面

`Confirmed`:

- 输出是“rule file”，而不是设计结果或代码结果。

`Inferred`:

- 这类 rule file 很可能包含：
  - 组件复用策略
  - token 替换策略
  - 何时优先用现有组件
  - 何时允许新增组件
  - 命名和目录约束
  - 与 Figma specs 冲突时的优先级规则

### 4.3 核心算法与机制猜测

#### `Confirmed`: Policy Injection

- 规则先生成，再进入转换流程。
- 这意味着官方把“风格/约束”与“节点/代码生成”解耦了。

#### `Inferred`: Stack-aware Guidance

- 规则生成不是泛化 prompt，而是跟项目栈绑定的约束编排。
- 它的目的不是增加自由度，而是减少自由度，防止每次 design-to-code 都重新猜项目约定。

#### `Inferred`: Rule Synthesis

- 这类工具大概率把若干来源合成到一个可消费规则包中：
  - 项目上下文
  - 设计系统约定
  - 组件复用规则
  - token mapping 规则

### 4.4 我们真正该学什么

- 这类工具最重要的启发不是“如何写一份规则文档”，而是“为什么要把 policy 独立出来”。
- 没有 policy layer，转换器就会在每次运行时重新猜：
  - 用不用现有组件
  - token 如何映射
  - 目录怎么放
  - 命名怎么定
- 所以真正值得学的是：
  - 把约束沉淀成资产
  - 把约束放在转换前注入
  - 让后续生成消费统一 policy，而不是重复猜测

### 4.5 当前未知点与验证实验

- `Unknown`: rule file 的真实结构化程度。
  - 实验: 在不同框架上下文下请求生成 rules，比较输出是否稳定分段、是否包含机器可读字段。
- `Unknown`: rules 对后续结果的约束强度。
  - 实验: 在同一节点上分别带规则和不带规则做转换，比较组件复用与 token 替换差异。
- `Unknown`: 规则是否被服务端工具直接消费，还是仅供 agent 阅读。
  - 实验: 固定 agent 提示，改变规则文件内容，观察后续生成差异幅度。

---

## 5. 三种能力放在一起看

### 5.1 它们不是同一种“转换”

| 能力 | 真正角色 | 主要输入 | 主要输出 | 本质问题 |
|------|-----------|-----------|-----------|-----------|
| `generate_figma_design` | 采集与导入 | 渲染后的页面 | capture payload -> Figma | 如何高保真捕获 UI |
| Code Connect | 锚点系统 | 节点与组件身份信息 | 映射资产 | 如何稳定对应设计与代码 |
| `create_design_system_rules` | 策略层 | 项目上下文 | 规则资产 | 如何统一后续转换约束 |

### 5.2 官方真正稳的地方

- 先拿高确定性上下文，再做转换。
- 先确定 identity/constraint，再做 generation。
- 把可复用知识沉淀成资产：
  - capture payload
  - anchor map
  - rule file

### 5.3 这也解释了为什么不该只盯工具接口

如果只盯 MCP 工具名，会误以为官方有三个“魔法生成器”。

更准确的理解是：

- 一个是采集器
- 一个是锚点层
- 一个是策略层

真正的“转换器”反而可能分散在：

- capture client
- import compiler
- design-to-code compiler
- Code Connect 消费链
- screenshot/asset validation loop

---

## 6. 对我们系统的启发

### 6.1 哪些能力适合直接学习

- 客户端采集器
  - DOM walker
  - style diff
  - asset/font serialization
  - source metadata extraction
- 锚点系统
  - 组件 identity 抽取
  - 映射资产建模
  - suggestions 与 confirm 的两阶段流程
- 策略层
  - 规则先生成，再注入后续转换

### 6.2 哪些必须承认是服务端黑盒

- HTML/capture payload 到 Figma node tree 的导入编译器
- Code Connect suggestions 的真实排序算法
- design system rules 的具体合成实现
- design-to-code 中映射与规则如何在服务端/agent 之间分工

### 6.3 哪些抽象值得进入我方系统

不要复刻工具名，应该复刻能力层：

- `CaptureArtifact`
- `AnchorMap`
- `RuleBundle`
- `GroundingContext`
- `Translator`
- `Validator`

### 6.4 最重要的一句话

官方的强项不是“一个模型直接把 A 变 B”，而是“先把高确定性中间资产准备好，再让后续转换在这些资产约束下发生”。

这才是最值得学的核心原理。
