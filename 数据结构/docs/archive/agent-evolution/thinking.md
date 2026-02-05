---
name: thinking
description: 实时捕捉浏览器 UI 并映射为 Figma 节点的技能
version: 1.0.0
---

# Skill: 思路 (thinking)

## 思考
Renderer：我们项目目前的renderer是否可以作为一个tool？基于figma规范，能力边界的工具。
Knowledge hub：主要使用了ui-ux-pro-max的skill作为rag的source，但并非完全闭环为agent的动态工具（Tool）


## 定义
1. Function calling：llm如果发现需要查资料，而是输出一段特殊JSON（比如：{ "name": "get_weather", "args": { "city": "Beijing" } }）。


2. Tool use：如果在项目里声明一个工具（Tool），工具其实是让llm从云端本地（程序），接受llm传来的json，运行代码，返回结构；
声明：声明一个工具，是要给工具写一段Description，
API 接口定义 (Schema)：
单纯的数据 (Static Data)：就像我们项目目前生成的figma dsl（特定格式的json）。
静态RAG：系统逻辑是检测到用户输入关键词，搜索相关片段，放进prompt，发给llm；对于llm来说只有RAG猜出来的几条；决策权在程序，程序好坏决定了llm的输出，如果程序预判不到用户的隐性意图，LLM 就无法获得 Knowledge Hub 里的知识。

真正的tool use是对llm说：“我想在这个节点加个圆角，请运行 Renderer 的 setRadius 工具”

Tool 是原子的 (Atomic)：例如 createRect()。它不知道为什么要创矩形，它只负责创矩形。



1. MCP (Model Context Protocol): MCP 采用的是 Client-Server (客户端-服务器) 架构，其逻辑是标准的 JSON-RPC：
Lister (列表)：Agent 问 Server：“你有哪些工具？”。Server 回：“我有 
search
 和 read”。
Call (调用)：Agent 发送一个结构化请求：“请运行 
search
，参数是 { "q": "Figma" }”。
Result (结果)：Server 运行本地代码，返回结果给 Agent。


mcp的好处是：typescript的agent可以使用python工具，不同语言的agent可以使用不同语言的工具。



2. Skill: 更像组合了工具，prompt，examples，mcp，协议的专业技能包；让llm在执行不同skill时需要加载多余的指令和工具，专注于当前skill的工作任务。

Skill 是目标的 (Goal-oriented)：例如 LayoutGeneration。它知道为了画一个列表，需要先调用 createRect() 画背景，再调用 createText() 画文字，并且知道它们之间的间距要遵守规范。



## 上下文

1. 结构化数据 (Structured Context) —— “看账本”
这是最适合 Token、布局、配色 等硬数据的形式。

形式：JSON, CSV, YAML。

2. 叙述性/指令性上下文 (Narrative Context) —— “听报告”
这是最适合 设计规范、用户意图、业务背景 的形式。

形式：Markdown, Plain Text。

3. 环境上下文 (Environmental/Resource Context) —— “看现场”
这是最近 MCP (Model Context Protocol) 大力推行的一种形式。

形式：URI 资源（如 figma://file/123/node/456 或 file:///src/main.ts）。

4. 视觉上下文 (Visual Context) —— “看照片”
这是 Multimodal (多模态) 时代最强大的形式。

形式：Screenshot, Image, SVG。

1. 如果llm没有遵循要求输出，我们项目有一套基础原理：
   1.1 我发了1000字（input prompt），llm输出500字（output），
   1.2 发现错误：需要修正。
   1.3 重试：必须把之前第一次对话的input，output（历史记录）加上报错信息一起发回去，
   1.4 结果第二次请求的input变成了：第一次的（1000+500）+报错（100）=1600字
但这样也意味着复杂度会随着重复次数变多，越来越高，llm注意力越分散，所以很多agent优化了上下文；
比如：
1. 上下文缓存（context caching）：
   原理：把第一次input的背景信息（1000字）存在服务器上，拿回一个cach ID；

2. 提示词缓存（prompt compression）：
   agent调用一个便宜模型对上下文进行总结：把1500字总结成200字，再发送给llm；
3. 感知增量（Delta Feedback）：
   原理：只把上一次对话的“差异”和“错误”发给llm，而不是把完整的对话记录发回去；

**注意**
以上这些对上下文的优化，在API上并不会有自动实现，需要我们自己实现；API是算力接口。


## 大模型数据规范差异

1. 不同的“思考模型”与“数据标注”倾向
虽然它们都学过 JSON 和 XML，但各家公司在训练模型**“如何呼叫工具”**时，喂的数据标注规范不一样：

OpenAI：早期走 JSON 路线，因为 JSON 是 Web 开发者的通用语言。它的模型被教育成：“看到特殊 Token 后，立刻输出一个完美的 JSON 对象”。
Anthropic：Claude 以前非常推崇使用 XML 标签 (如 <tools>...</tools>)。
原因：JSON 里的括号太多，在大规模生成时容易出错。而特定的 XML 标签在海量文本中非常显眼，模型更容易区分什么时候在“说话”，什么时候在“用工具”。
Google：Gemini 的底层协议更倾向于高效的 Protobuf 风格映射，它在处理超长上下文和多模态（视频、语音）时，对工具参数的解析逻辑有自己的权衡。

1. RLHF（人类反馈强化学习）时训练目标不同，大模型性格特征（权重参数）不同，这些权重参数是从不同偏好数据下训练出来的。

2. 大模型本质仍是输入文字，输出猜测的文字，agent就是告诉llm要输出指定格式的json，性能好的agent可以很好的控制llm输出。

总结：这套系统的核心叫 “Loop” (循环)
所以，LLM 本身并不会“动”，它只是 “指点江山”。 真正“使用工具”的是你写的 外部代码。

环节	谁在动？	动作
大脑	LLM	发出 JSON 形式的指令（Function Calling）
手脚	你的 TS 代码	执行 API，访问数据库或 Figma
反馈	你的 TS 代码	把执行结果贴回对话记录
结论	LLM	根据结果，完成最后的对话

### 深度问答记录：实现细节与成本

1. **观察 `rawText` 的意义**：
   - 它是未经过滤的“真话”。通过它你可以看到 LLM 是否在“碎碎念”，是否带了 Markdown 符号。
   - 如果 `rawText` 里有很多解释性文字，说明我们的 System Prompt（“只输出 JSON”）的约束力还不够，或者模型在“挣扎”。

2. **Agent 如何给反馈？（技术机制）**：
   - 不是靠“骂”模型，而是靠 **“覆盖历史”**。
   - 把错误的输出和报错信息，伪装成一段新的对话记录：`User: "你刚才生成的 JSON 缺了高度参数，请修复"`。
   - 这样 LLM 在下一次生成时，它的“注意力机制”会强制聚焦在这个错误上。

3. **API 使用与成本**：
   - **Agent 模式确实更贵**：每一次 `retry` 都是一次完整的 API 调用。
   - **计费模式（Token 计费）**：AI API 通常不按“次数”或“秒数”计费，而是按 **Token (字符标识符)** 计费。
     - **Input (输入)**：你发给模型的文字（包含 Prompt 和历史记录）。
     - **Output (输出)**：模型回你的文字。
   - **为什么循环费钱？**：在循环（Retry）中，你每次都要把上一次失败的 JSON 和报错重新发一遍，这导致 **Input Token 呈累积式增长**。这意味着第 2 次尝试的成本通常比第 1 次贵，因为它带了更多“包袱”。
   - **权衡**：是用更多的 Token 换取一次成功的 UI 渲染，还是省钱但让用户面对一个报错的按钮？目前项目选择了 `DEFAULT_MAX_RETRIES: 1`，这是在成本与可用性之间的平衡。



## 关于API






## 当前项目所提供的工具 ##

1. 绘图渲染类 (Renderer Tools - 6个)
这是 LLM 用于在 Figma 中构建 UI 的“画笔”：

createFrame: 创建基础容器（如页面、表单区域）。
createText: 插入文本（如标题、标签、按钮文字）。
createIcon: 渲染图标（如 Google/Apple 登录图标）。
createShape: 创建基础几何图形（如分割线、背景装饰）。
updateNodeProperties: [失效点] 精修已存在节点的属性（如对齐、边距、颜色）。
deleteNode: 移除不需要的节点。
2. 设计知识类 (Knowledge Tools - 3个)
这是 LLM 在动手前用于查询“设计说明书”的“参考书”：

searchDesignKnowledge: 搜索通用设计规范。
getComponentAnatomy: 获取特定组件（如 Input）的标准结构定义。
getFigmaLayoutRules: 查询 Figma 布局引擎的最佳实践。
3. 校验类 (Validation Tools - 1个)
这是 LLM 用于自我检查的“质检员”：

validateLayout: 检查当前生成的布局是否符合预设的比例和对齐规则。



## 数据结构 ##

1. 触发Gemini工具调用需要添加toolconfig
toolConfig: {
        functionCallingConfig: {
          /** 
           *调用模式
           * 'ANY': 强制模型至少调用一个工具 (代码中默认为有工具时强制 ANY)
           * 'AUTO': 模型自主决定
           * 'NONE': 禁用工具
           */
          mode: 'ANY' | 'AUTO' | 'NONE';
          
          /** 允许调用的函数名称列表 (用于过滤) */
          allowedFunctionNames?: string[];
        };
      } | null;


## 报错 ##
就如我们之前所理解的，报错信息也是要在下一轮的对话中塞回llm的； LLM In-Context Learning 能力



4. Kilo Code 启示 (Insights)
在 Kilo Code 中，文件操作被严格区分为：

创建/覆盖 (write_to_file): 类似于 createNode + setStyles (全量)。
修改 (apply_diff): 类似于 updateProperties。
读取 (read_file): 类似于 getNodeDetails。
关键差异点: Kilo Code 的 Agent 在修改文件时，如果 diff 应用失败（如行号不匹配），原来的文件不会被破坏。Agent 只是收到 "Application failed" 并尝试调整 diff。 这与我们推荐的原子化工具一致：不要让一个属性的错误导致整个对象的销毁。


1. 核心理念对比 (Philosophy)
特性	当前架构 (Monolithic)	原子化架构 (Atomic - Kilo Style)
设计模式	All-in-One: 一个工具完成创建、布局、样式、层级。	Pipeline: 类似 Linux 管道，创建 -> 布局 -> 样式。
错误半径	全局炸弹: gap 参数错误会导致整个 Frame 创建失败 (回滚)。	局部故障: gap 设置失败，但 Frame 已创建，Agent 可仅重试布局。
Token 消耗	冗余重复: 每次微调都要重传整个大 JSON 对象。	精准高效: 仅传输变更的属性 (Delta)。
Kilo 参考	-	类似 write_to_file (整体覆盖) vs apply_diff (精准修补) 的分离。




## 工具 ##
项目工具清单与LLM高效指导设计
根据分析，项目共有 15个工具，分为以下几类：

📂 工具分类总览
类别	工具名	执行策略	用途
规划	planDesign	sequential	ReAct模式下的任务分解与规划
渲染创建	createNode	sequential	创建 FRAME/TEXT/RECTANGLE 等节点
渲染布局	setNodeLayout	sequential	Auto Layout、Padding、Gap、Sizing
渲染样式	setNodeStyles	sequential	Fills、Strokes、圆角、透明度
渲染属性	updateNodeProperties	sequential	文字属性、通用属性更新
渲染图标	createIcon	sequential	Iconify 图标创建
渲染删除	deleteNode	sequential	删除节点
知识检索	
searchDesignKnowledge
parallel	搜索设计知识库
知识检索	
getComponentAnatomy
parallel	获取组件结构蓝图
知识检索	
getFigmaLayoutRules
parallel	获取 Figma 布局规则
验证	
validateLayout
parallel	DSL 布局约束验证
读取	getSelection	parallel	获取当前选中节点
读取	getVariables	parallel	获取本地变量(设计令牌)
读取	getStyles	parallel	获取本地样式
读取	getNodeDSL	parallel	获取节点 DSL 结构
🔑 执行策略关键概念
typescript
executionStrategy: 'parallel' | 'sequential'
parallel: 无副作用，可与其他 parallel 工具并行执行
sequential: 有副作用（创建/修改节点），必须按顺序执行
AgentRuntime 执行逻辑 (第493-553行):

工具调用按顺序分组
连续的 parallel 工具用 Promise.all() 并行执行
连续的 sequential 工具逐个执行
sequential 工具失败后，后续 sequential 工具会被跳过（但仍返回响应以满足 Gemini API 约束）
🎯 LLM 调用模式最佳实践
1. 单工具调用 - 精确操作
用户: "创建一个红色按钮"
LLM调用: createNode → setNodeLayout → setNodeStyles
适用场景: 单一明确任务

2. 并行工具调用 - 信息收集阶段 ✅ 高效
LLM调用: [
  getSelection,      // parallel
  getVariables,      // parallel  
  getStyles,         // parallel
  searchDesignKnowledge  // parallel
]
// 全部并行执行，一次 API 调用获取所有上下文
优化上下文的关键: 在规划阶段先并行收集信息

3. 顺序工具调用 - 创建阶段 ⚠️ 必须有序
LLM调用: [
  createNode(父容器),     // 先创建父级
  createNode(子元素1),    // 依赖父级 ID
  createNode(子元素2),    // 依赖父级 ID
  setNodeLayout(父容器)   // 最后设置布局
]
依赖链约束: 子节点创建必须在父节点之后

4. 混合模式 - 最优实践
第一轮:
  [getSelection, getVariables, getComponentAnatomy] // 并行收集
  
第二轮:
  [planDesign]  // 规划执行步骤
  
第三轮:
  [createNode] → [setNodeLayout] → [setNodeStyles]  // 顺序执行
🔴 缺少信息处理
工具定义中的 errors 字段明确了错误场景:

错误代码	含义	LLM应对策略
PARENT_NOT_FOUND	parentId 不存在	先创建父节点
NODE_NOT_FOUND	nodeId 无效	使用 getSelection 或 getNodeDSL 获取正确 ID
INVALID_LAYOUT_MODE	layoutMode 值非法	使用 enum 限定值
INVALID_SIZING	HUG 需要 Auto Layout	同时设置 layoutMode
FONT_NOT_LOADED	字体不可用	使用默认字体


我们可以把 LLM 的状态分为 “内部世界模型” 和 “外部执行反馈” 两部分来看：

1. 逻辑依赖冲突 (Dependency Conflicts)
LLM 知道吗？ 知道。如果你问它“Figma 里能不能先建子节点再建父节点”，它会告诉你不行。
为什么还会犯错？ 因为在高并发（Parallel Tool Calls）或者长文本推理时，它的“注意力”会优先分配给内容创作，而忽略了 ID 的顺序管理。它会假设 parentId 已经存在。
反馈连接：只有当系统返回 PARENT_NOT_FOUND 时，它才会“猛然醒悟”并进行修正。
2. 属性映射冲突 (ID Mapping Issues)
LLM 知道吗？ 不知道。
认知鸿沟：LLM 认为 ID 是永恒的标签。它不知道在 Figma 插件底层，为了实现某些属性更新，程序可能偷偷删掉并重建了一个节点。
后果：它会固执地向一个已经死掉的 ID 发送指令，收到 NODE_NOT_FOUND 后它会陷入困惑，开始猜测：“是不是刚才没选上？”然后开始循环。
3. 类型幻觉 (Type Hallucinations)
LLM 知道吗？ 它有“大模型通病”。
认知倾向：它对 Figma 的通用知识（如知道有 Group）有时会盖过我们给它的特定工具包限制（只允许 Frame）。
反馈连接：当它尝试 createNode(type: "GROUP") 被系统报错 INVALID_NODE_TYPE 后，它才知道：“哦，这个环境里不能建 Group，只能建 Frame”。
4. 隐形渲染 (Invisible Rendering)
LLM 知道吗？ 完全不知道。
盲点：这是 LLM 最难理解的一点。在它的逻辑里：调用工具 = 任务完成。它看不见画布，如果它创建了一个长宽为 0 且没颜色的矩形，系统返回 Success，它会非常有成就感地向你汇报“设计完成”。
后果：用户说“看不到东西”，模型说“我明明建了”，这直接导致了对话的“驴唇不对马嘴”。


能否在错误时，提供类似这四点错误信息？

逻辑依赖：检测到 PARENT_NOT_FOUND 时，反馈给 LLM：“你正在空中楼阁，请先穿上鞋再走（先建父容器）”。
ID 映射：检测到 NODE_NOT_FOUND 时，提示 LLM 节点已被重构，需要调用 getSelection 刷新感知。
类型幻觉：拦截不支持的 Figma 类型请求，并给出官方推荐列表。
隐形渲染：如果创建的节点长宽为 0，自动在反馈日志中打标，提示 LLM “节点虽然创建成功，但肉眼不可见，请设置尺寸或填充”。