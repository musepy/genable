export const quizConfig = {
    title: "高维架构与底层边界考核 (Architecture & Boundaries V2)",
    description: "本习题系统包含基于 TS基础、序列化管线、跨进程通信以及 OpenPencil 架构对照的精选情境题。难度呈渐进式，跨域交叉验证。",
    passingScore: 80,
    domains: {
        RUNTIME: "Runtime (JS基础/系统界限)",
        SERIALIZATION: "Serialization (数据序列化管控)",
        ARCHITECTURE: "Architecture (IPC/沙箱边界/代理结构)",
        PIPELINE: "Pipeline (管线/AST/文本代码转化)"
    }
};

const DOC_BASE = "/Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator-dogfood/docs/knowledge";

export const questions = [
    {
        id: "q1",
        domain: ["RUNTIME"],
        difficulty: 1,
        type: "single",
        question: "在 TypeScript 对接 Figma API 时，如果声明了 `const selectedNodes = figma.currentPage.selection`，随后执行了 `selectedNodes.push(newNode)`，Figma 界面并不会发生变化，原因是？",
        options: [
            { id: "a", text: "因为 const 限制了对象的任何变更操作，push 方法在底层抛出了一个静默错误。" },
            { id: "b", text: "因为 figma.currentPage.selection 返回的是一个按值传递的纯净数组快照，修改这份额外的快照不会触发底层 C++ 的指针替换。", isCorrect: true },
            { id: "c", text: "Figma 官方只允许通过 `figma.ui.postMessage` 修改画布节点。" },
            { id: "d", text: "因为 newNode 还没有调用 `appendChild`，需要先 append 才能出现。" }
        ],
        explanation: "Figma 的 `selection` 获取的是一个“浅层快照”。修改你的 JS 数组变量不会引发任何内部 setter 回调。只有在你执行 `figma.currentPage.selection = [newNode]` 这个赋值操作时，才会触发 Figma底层的 Setter 修改画布的焦点状态。\n\n[深度溯源：TypeScript基础认知与底层界限](file://" + DOC_BASE + "/typescript-symbol-flags.md)"
    },
    {
        id: "q2",
        domain: ["SERIALIZATION"],
        difficulty: 1,
        type: "single",
        question: "在重构 Figma 节点序列化管道 (Pipeline) 时，为什么我们选择采用 BLACKLIST 黑名单剔除部分属性，而不采用 WHITELIST 白名单？",
        options: [
            { id: "a", text: "因为白名单很难通过 TypeScript 类型系统进行推断验证。" },
            { id: "b", text: "白名单会导致在新版 Figma API 增加了新的重要属性（如新的 LayoutMode）时，这些属性会默认被漏掉，从而使得 LLM 看不到这些关键新属性而盲目生成错误视图。", isCorrect: true },
            { id: "c", text: "黑名单运行速度基于 O(1) 的 Hash 查找，比白名单 O(N) 快。" },
            { id: "d", text: "其实白名单更安全，我们最终用的是极简白名单。" }
        ],
        explanation: "由于 Figma API 处于快速演进期，采用白名单会导致系统在面对未来未知属性时“过度防御（丢弃未知）”。这会导致 LLM 信息匮乏，生成“幻觉”。相反，黑名单仅剔除确定有毒（如方法和废弃字段）或废料的属性，最大化保留状态供推断。\n\n[查阅知识原件：系统原理与节点管线](file://" + DOC_BASE + "/figma-node-and-serialization-pipeline.md)"
    },
    {
        id: "q3",
        domain: ["ARCHITECTURE", "PIPELINE"],
        difficulty: 2,
        type: "single",
        question: "【跨维架构】我们对比了自身的 “正则与字符串匹配” 和 OpenPencil 的 “Sucrase AST / 代码模板引擎” 方案。从认知的角度来看，引入模板引擎能帮 LLM 解决什么根本难题？",
        options: [
            { id: "a", text: "模板引擎比原生 JSON 序列化小 80%，极大节省了上下文 tokens。" },
            { id: "b", text: "防止 LLM 记错属性拼写，例如把 justify 写成了 align。" },
            { id: "c", text: "让 LLM 视角的输出从“死记硬背拼凑复杂的深层嵌套结构对象(如 fills=[{...}])”，转变为“调用一组具名工具函数(如 solid('red'))”，这是调用栈维度的降维打击。", isCorrect: true },
            { id: "d", text: "为了能支持 React 语法，因为 LLM 仅能生成纯粹的 React 组件流。" }
        ],
        explanation: "让 LLM 手写特定的嵌套结构是非常容易出错的。工具函数（如 `solid('red')`）在内部会将极简传参封装成那坨长字符串，这大大解放了 LLM 对格式的肌肉记忆负担，使它专注于排版组合和逻辑本身。\n\n[相关论证：Domain 体系与管线对比](file://" + DOC_BASE + "/domain-architecture-and-pipeline.md)"
    },
    {
        id: "q4",
        domain: ["ARCHITECTURE"],
        difficulty: 2,
        type: "single",
        question: "由于 Figma 严格的沙箱约束：Main(操作沙箱) 不能进行网络访问，UI(同源环境) 不能调用 Figma底层命令。这致使 Agent 工具派发必须进行 IPC。此处的关键脆弱点并不仅是通信延迟，而是：",
        options: [
            { id: "a", text: "在 Main 进程中执行可能引发未捕获的 Error，由于跨进程黑洞，如果不携带 requestId 并在 UI 侧设置 Timeout 兜底，Agent pipeline 可能会因为拿不到工具回调而永远假死。", isCorrect: true },
            { id: "b", text: "UI 侧的跨域策略会无理由拒绝 Main 的 postMessage 返回。" },
            { id: "c", text: "Figma 官方限制了每秒 IPC 调用不能超过 10 帧。" },
            { id: "d", text: "Main 中的 setTimeout 会立即失效，导致无法做任何延时操作。" }
        ],
        explanation: "在分离的环境中，`UI` 向 `Main` 派发了动作指令（如修改树），若 `Main` 因为参数类型抛错且未有效拦截抛回 `UI`，或者 `Main` 崩溃，`UI` 侧悬挂的 `Promise` 将无限期 `Pending`。Agent 就因为等不到回调在此处变成植物人。因此必须设置 `timeout` 保障。\n\n[实战比对依据：对照池概念验证](file://" + DOC_BASE + "/contrastive-grounding.md)"
    },
    {
        id: "q5",
        domain: ["ARCHITECTURE", "RUNTIME"],
        difficulty: 3,
        type: "multiple",
        question: "【跨域复合题】在工具返回值设计上，我们放弃了深层封装的 `{ success: false, error: { code: 'NOT_FOUND', msg: '...' } }`，转而使用极扁平的 `{ error: '...' }`。关于这一理念，以下描述正确的有哪些？（多选）",
        options: [
            { id: "a", text: "大语言模型（LLM）不是代码解析器。嵌套结构不仅浪费 Token，而且增加了模型拆包（Unpack）时的认知推理层。", isCorrect: true },
            { id: "b", text: "TypeScript 和 Vercel AI SDK 底层强行要求所有的 `ToolResponse` 返回的都是扁平键值对，不支持嵌套格式。" },
            { id: "c", text: "模型能直接利用扁平文字来关联自己的执行上下文原因。无需用错误码（Code）来执行 switch 分支判断，它能直接读懂句子。", isCorrect: true },
            { id: "d", text: "Figma Sandbox JSON.stringify 不支持深层对象的序列化，超过两层会报错。" }
        ],
        explanation: "模型依赖语言本身的语义而非控制流代码分支。层层嵌套的套匣子结构是古典软件工程（为 Switch 判断、Error 强类型捕获服务）的遗留习惯。面对 LLM，给一长串直接说明原因的一维字符串效果最佳。\n\n[延伸阅读：Vercel SDK与Agent循环本质](file://" + DOC_BASE + "/vercel-sdk-architecture-overview.md)"
    },
    {
        id: "q6",
        domain: ["PIPELINE", "ARCHITECTURE"],
        difficulty: 3,
        type: "single",
        question: "【综合设计体系】在 OpenPencil 中，工具通常会含有类似 `mutates: boolean` 的标记位。从 Agent Pipeline 工作流的视角来看，设计这个属性旨在解决什么深层隐患？",
        options: [
            { id: "a", text: "为了防止读操作造成越权漏洞（如越界修改只读结点）。" },
            { id: "b", text: "为了精确区分该工具到底是“获取信息”还是“实质变更”。仅当其实质变更后，Pipeline 才会触发快照更新（用于撤销或重计算界限），避免 LLM 无限循环执行无用操作（noop loop）而不自知。", isCorrect: true },
            { id: "c", text: "这只是 TypeScript 编译层用于区分 Readonly 和 Writable 属性的安全卫士。" },
            { id: "d", text: "为了强制沙箱立即释放内存中的垃圾回收标记（GC）。" }
        ],
        explanation: "许多时候 LLM 面临困难会“摆烂”，比如反复执行 `search()` 或者毫无目的地在原地打转更新同一个字段甚至毫无改动。有了 `mutates` 信号，系统能够在确信画布状态变更且确实完成生效后，抛出更新后的 Snapshot 给下一步作为环境观察反馈（如同强化学习中感知的新 Environment）。这是让连续推理能稳步前行的基石。\n\n[详见：Agent管线漏洞解析](file://" + DOC_BASE + "/domain-architecture-and-pipeline.md)"
    }
];
