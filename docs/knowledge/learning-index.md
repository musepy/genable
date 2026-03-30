# 学习笔记导航

## 学习路径（按顺序阅读）

```
1. TypeScript 基础     → 语言是什么，怎么编译，怎么运行
2. JSON 与数据格式      → 数据怎么表达，怎么嵌套，怎么传递
3. 系统与运行环境       → 程序跑在哪里，CPU/内存/进程/沙箱
4. 节点模型与序列化管线  → Figma 怎么管理节点，数据怎么给 LLM 看
5. 属性注册表与 LLM 边界 → 属性怎么分类，LLM 能看到/操作什么
```

## 文档索引

### 基础概念（我们的学习笔记）

| # | 文档 | 核心内容 |
|---|---|---|
| 1 | [TypeScript 基础](typescript-symbol-flags.md) | TS 编译器、Symbol/Flags、AST、const/let、class/function、缩写表 |
| 2 | [JSON 与数据格式](json-basics.md) | JSON 6 种值、嵌套、name#id 寻址、NodeSerializer 分析、三层截断、类型擦除 bug |
| 3 | [系统与运行环境](system-and-runtime-fundamentals.md) | CPU/内存、顺序/分支/循环、进程/沙箱、JS 宿主、文件系统、inode、async/await |
| 4 | [节点模型与序列化管线](figma-node-and-serialization-pipeline.md) | ID/type/name、getNodeById、树遍历、管线问题、黑名单、自动发现 |
| 5 | [属性注册表与 LLM 边界](property-registration-and-llm-boundary.md) | PROPERTY_REGISTRY/BLACKLIST/PROPERTY_META、认知盲区、分级可见性、Override、Figma 面板即分类 |

### 概念关联

```
TypeScript（语言）
  │ 编译成 JavaScript
  │ 运行在不同宿主（→ 文档 3）
  │
  ├── Node.js 宿主 → 有文件系统（→ 文档 3 文件系统章节）
  │
  └── Figma 沙箱宿主 → 只有 figma.* API
        │
        ├── 节点是内存中的活对象（→ 文档 4）
        │     有 ID、type、name
        │     通过 getNodeById 索引查找
        │
        ├── 序列化：活对象 → JSON 文本（→ 文档 2、4）
        │     NodeSerializer → NodeLayer → JsonNodeSerializer
        │     问题：类型擦除、三层截断、白名单遗漏
        │
        ├── 属性注册表（→ 文档 5）
        │     PROPERTY_REGISTRY（全量）→ BLACKLIST（过滤）→ PROPERTY_META（使用手册）
        │     LLM 认知边界：读用黑名单守门，写用白名单守门
        │     Figma 面板分组 = 最自然的属性分类
        │
        └── LLM 工具调用（→ 文档 4）
              LLM 输出文本 → 插件解析 → figma.* 执行
              edit = getNodeById + 改属性
```

### 项目专题文档（之前创建的）

这些文档由项目开发过程中积累，不属于学习路径，按需查阅：

| 文档 | 主题 |
|---|---|
| [jsx-pipeline-deep-dive.md](jsx-pipeline-deep-dive.md) | JSX 写入管线详解 |
| [execution-pipeline.md](execution-pipeline.md) | 执行管线 |
| [property-pipeline.md](property-pipeline.md) | 属性处理管线 |
| [figma-plugin-api-gotchas.md](figma-plugin-api-gotchas.md) | Figma API 踩坑记录 |
| [figma-read-api-and-registry-design.md](figma-read-api-and-registry-design.md) | 读取 API 设计 |
| [openpencil-tool-architecture.md](openpencil-tool-architecture.md) | OpenPencil 工具架构 |
| [agent-architecture-insights-2026-03-17.md](agent-architecture-insights-2026-03-17.md) | Agent 架构洞察 |
| [design-quality-methodology-2026-03-22.md](design-quality-methodology-2026-03-22.md) | 设计质量方法论 |
| [domain-architecture-and-pipeline.md](domain-architecture-and-pipeline.md) | domain/ 目录架构、管线三层、IR 过时分析、文本解析 vs 代码模板对比 |
| [template-architecture-design.md](template-architecture-design.md) | 模板架构 5 层设计：14 常量 + ~22 函数替代 ~1200 行 parser，含设计系统接入和画布感知新能力 |
