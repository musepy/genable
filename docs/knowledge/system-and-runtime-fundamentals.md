# 系统与运行环境基础

> 学习路径：[1 TypeScript 基础](typescript-symbol-flags.md) → [2 JSON 与数据格式](json-basics.md) → **[3] 本文** → [4 节点模型与序列化管线](figma-node-and-serialization-pipeline.md)
>
> 索引：[学习笔记导航](learning-index.md)

## 程序运行的必要条件

只需要两样东西：
- **CPU**：执行指令（计算）
- **内存**：存放正在用的数据和指令

其他一切都是可选的：文件系统（持久化）、网络（通信）、显示器（给人看）、figma.* API（操作画布）。

## 计算的三种方式

所有程序都是这三个的组合，没有第四个：

```
顺序：从上往下，一步步执行
分支：if/else 选一条路
循环：for/while 重复执行
```

所有"看起来不一样的东西"都是这三个的组合：

| 概念 | 本质 |
|---|---|
| 函数调用 | 顺序（跳过去，跑完，跳回来，继续） |
| 递归 | 函数调用自己（顺序 + 分支决定停不停） |
| async/await | 顺序（等的时候先做别的，不干等） |
| 批量替换 from/to | 循环 + 分支 + 操作（找到 X 换成 Y） |
| import/from | 不是计算，是拿工具（从别的文件引入） |

## 并发

不是同时做两件事（那叫并行，需要多个 CPU）。
并发是**交替做，看起来像同时**——一个厨师烧水的时候去切菜。

async/await 是 JavaScript 实现并发的方式——遇到等待（读存储、网络请求），先做别的，结果回来再继续。

## 进程

进程 = 正在运行的程序。操作系统为它分配独立的内存空间和 CPU 时间。

```
程序（文件）：躺在硬盘上的代码，没在跑
进程（运行中）：加载到内存，CPU 正在执行
```

每个进程内存互不干扰。Figma 崩了不影响 Chrome，因为它们是不同进程。

## 沙箱

有围墙的运行环境。程序能在里面跑，但不能越界。本质是安全隔离。

```
操作系统给进程的沙箱（矮墙）：
  能：文件系统、网络、子进程
  不能：碰其他进程的内存、改系统内核

Figma 给插件的沙箱（高墙）：
  能：figma.* API
  不能：文件、网络、其他一切
```

所有层级都是同一个模式——"你不能直接碰，通过我来"：
- 操作系统给程序：只能通过系统调用操作硬盘/网络
- Figma 给插件：只能通过 figma.* API 操作画布

## JS 运行环境

JavaScript 语言本身只有基础能力（变量、函数、对象、循环）。**不自带文件系统、不自带网页、不自带画布**。是宿主程序注入额外能力：

| 宿主 | 注入的能力 | 例子 |
|---|---|---|
| 浏览器 | DOM + window + fetch | Chrome、Safari |
| Node.js | 文件系统 + 网络 + 进程 | 服务器、CLI 工具 |
| Figma 插件沙箱 | figma.* API | 我们的插件 |

JS 环境 = JS 语言核心 + 宿主注入的 API。

## Node.js

把 Chrome 的 V8 JS 引擎拿出来，让 JS 能在操作系统上直接运行。
Node.js/Rust/Python 都运行在操作系统上，天然能访问文件系统。

| | Node.js | Rust | Python |
|---|---|---|---|
| Agent 例子 | Claude Code | Codex (OpenAI) | Devin, OpenHands |
| 为什么选它 | npm 生态 + 异步 I/O | 性能 + 沙箱安全 | LLM 库多 |

对 LLM 来说**没区别**——agent 用什么语言写的，LLM 不关心，只看到暴露给它的工具接口。

## TypeScript 与 JavaScript

TypeScript = JavaScript + 类型标注。运行环境只认识 JavaScript。

```typescript
// TypeScript（开发者写的）
function add(a: number, b: number): number { return a + b }

// JavaScript（编译后，机器执行的）
function add(a, b) { return a + b }
```

编译 = 把类型标注删掉。类型的价值在于**写代码时**检查错误，跑之前就发现 bug。
就像考试打草稿纸 → 誊到答题卡。草稿帮你算对，交的是干净的答题卡。

继承关系：

```
JavaScript
  ├── + 类型标注 → TypeScript
  ├── + XML 标签 → JSX
  └── + 类型 + XML → TSX
```

## figma.* API

不是语言，是 Figma 注入到沙箱里的一组函数：

```typescript
figma.createFrame()         // 创建 frame
figma.currentPage.children  // 读取页面节点
figma.getNodeById("1:2")    // 按 ID 找节点
figma.clientStorage         // 本地持久存储（key-value，几 MB）
```

API = Application Programming Interface，宿主提供给你的可调用函数清单。

### clientStorage

Figma 在沙箱高墙内开的一个小柜子。不是文件系统，只是扁平的 key-value 存取。

```typescript
await figma.clientStorage.setAsync("key", value)  // 存
const data = await figma.clientStorage.getAsync("key")  // 取
```

可以用作 LLM 跨对话的持久记忆（in-context learning），但容量有限，不能搜索、不能遍历。

## 文件系统

### 文件的读取过程

CPU 只能处理内存里的数据，不能直接改硬盘上的文件：

```
硬盘上的文件 → 读取到内存 → CPU 计算修改 → 写回硬盘
```

具体层级：

```
代码调用：     fs.readFile("file.txt")         （人话）
Node.js：     open("file.txt", O_RDONLY)       （系统调用）
操作系统内核：  扇区 48320，读 4096 字节         （硬盘指令）
硬盘控制器：    磁头移到物理位置，读磁信号        （物理动作）
返回：         01001000 01100101 ...            （二进制）
Node.js：     "Hello World"                    （人话）
```

每层都在做翻译——上层的请求翻译成下层的指令，结果翻译回来。

### 文件系统索引——目录树

不是全盘扫描找文件。文件系统有目录树结构，逐级跳转：

```
/Users/daxiaoxiao/file.txt

第 1 步：查根目录 /          → "Users" 在扇区 100
第 2 步：查扇区 100 的目录表  → "daxiaoxiao" 在扇区 5000
第 3 步：查扇区 5000 的目录表 → "file.txt" 在扇区 48320
```

3 次跳转，不是扫描百万文件。路径里的每个 `/` 是一次查表。

### inode——文件的真正 ID

inode = index node（索引节点）。文件名不是唯一标识，inode 号才是。

```
目录表：
  "file.txt"  → inode 82451  → 硬盘扇区 48320
  "photo.png" → inode 82452  → 硬盘扇区 50000
```

与 Figma 对比：

| | 文件系统 | Figma |
|---|---|---|
| 给人看的 | 路径/文件名 | name |
| 真正 ID | inode | node id ("1:2") |
| 按 ID 查 | 底层用，人不直接用 | getNodeById() 直接跳 |
| 按名字查 | 逐级查目录表 | 遍历整棵树（无 getNodeByName） |

### 删除与垃圾桶

删除 = 删目录条目（名字→inode 的映射），不删数据。数据还在硬盘上，只是标记为"可覆盖"。
垃圾桶 = 特殊文件夹，"删除"只是移动过去，清空垃圾桶才真正断开映射。

## LLM 与工具调用

### LLM 输出的是文本，不是代码执行

LLM 不会"调用函数"，它只输出符合格式的文本。插件识别格式后执行：

```
LLM 输出文本 → 插件解析文本 → 找到内存中的节点 → 改属性 → 画布更新
  （文本）      （翻译）       （索引查找）      （赋值）   （渲染）
```

```typescript
// LLM 输出的（文本）
'edit({ node: "Card#1:2", fill: "#FF0000" })'

// 插件做的（代码执行）
const ref = "Card#1:2"
const id = ref.split("#")[1]                   // "1:2"
const node = figma.getNodeById(id)             // 找到内存中的活对象
node.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]  // 修改
// Figma 自动检测变化 → 重新渲染画布
```

### Figma 怎么检测属性变了

推断（Figma 闭源，无法确认内部实现）：`node.fills` 不是普通变量，是 setter——赋值动作本身触发通知，不是扫描检测。

```typescript
// 所有需要"改了自动更新画面"的系统都用类似模式
set fills(value) {
  this._fills = value   // 存新值
  this.markDirty()      // 通知：我变了，需要重新渲染
}
```

这就是"活对象"——赋值操作有副作用，不只是存数据。

### 只有名字没有 ID 怎么找节点

```typescript
// 有 ID → 直接跳到，O(1)
figma.getNodeById("1:2")

// 只有名字 → 遍历全树，O(n)
figma.currentPage.findAll(node => node.name === "login")
```

这就是 jsx 创建后返回 ID 的意义——有 ID 就从遍历变成直接跳转。

### 现有 LLM API 格式

所有主流 LLM API 都用 JSON 格式通过 HTTP 传输（OpenAI、Anthropic、Google、DashScope、Kimi）。
流式输出用 SSE，但每块数据仍是 JSON。JSON 是 LLM API 的通用语言。

## CLI 与工具设计

### CLI = 命令行界面

用文本命令操作系统。mkdir、grep、rm 是具体命令。

### 插件工具 vs CLI 命令

看起来像（都是文本命令操作树结构），但运行环境不同：
- CLI 命令在操作系统执行，有文件系统
- 插件工具在 Figma 沙箱执行，只有画布

不能直接把工具给 CLI 用，因为依赖 figma.* API。但可以通过桥接间接调用（dev bridge 就是这个模式）。

### 工具 schema 占注意力的问题

LLM 对 CLI 模式（--flag value）已经很熟悉，但每个工具的 JSON schema + description 占用大量 token。
可以考虑统一成 CLI 风格的单一工具，减少 schema token（~1000 → ~50），靠 LLM 已有的 CLI 知识。

### 插件的边界

插件只需要做好一件事：在 Figma 画布上生成好的 UI 设计。
不需要变成通用 agent。每个 agent 都是"在有限环境里做好特定的事"。
做好设计质量 > 增加通用能力。

## 700B 大模型本地运行

700B 参数模型需要的内存：
- FP16（半精度）：700B × 2 字节 = 1.4 TB
- INT4（4bit量化）：700B × 0.5 字节 = 350 GB
- 加上 KV 缓存 + 文件本身 → 400+ GB

1GB 文本 ≈ 几十亿 token，远超任何模型的上下文窗口（128K-1M token）。
必须分块处理。普通电脑内存 16-64 GB，连模型都装不下，所以大模型基本跑在云端。

## 树形索引无处不在

到处都用同样的思路——用树/索引避免遍历：

| 领域 | 索引方式 | 查找 |
|---|---|---|
| 文件系统 | 目录树 | 按路径逐级跳转 |
| 数据库 | B+ 树索引 | 按索引找记录 |
| 字典 | 拼音/部首目录 | 按目录找字 |
| Figma 画布 | 节点 ID 索引 | getNodeById 直接跳 |
| 项目 name#id | ID 做寻址 | 解析 # 后直接定位 |
