# CLI is All Agents Need — \*nix Agent 设计宝典

> CLI 是所有代理所需——\*nix 代理设计宝典
>
> Why a single `run(command)` outperforms sprawling tool catalogs

当所有人在为 Agent 设计复杂的函数调用框架时，我发现：一个 `run(command="...")` 就够了。

*本文由 AI Agent 协作完成，但每一个设计决策、每一次生产踩坑、以及把它们提炼成原则的思考过程，都是本人完成的。*

---

## 1. 为什么是 \*nix

Unix 在 50 年前做了一个设计决策：**一切皆文本流**。程序之间不交换复杂的二进制结构，不共享内存对象——它们通过文本管道沟通。小工具各司其职，通过 `|` 组合成强大的工作流。程序用 `--help` 描述自己，用 exit code 报告成败，用 stderr 传递错误上下文。

LLM 在 50 年后做了一个几乎相同的决策：**一切皆 token**。它只理解文本，只输出文本。它的"思考"是文本，它的"行动"是文本，它从世界获得的反馈也必须是文本。

这两个决策跨越半个世纪，从完全不同的出发点，收敛到了同一个接口模型。Unix 为人类终端操作者设计的文本系统——cat、grep、pipe、exit code、man page——对 LLM 来说不是"也能用"，而是**天然适配**。LLM 在工具使用这件事上，本质就是一个终端操作者，只不过它比任何人类都快，而且它的训练数据里有大量 shell 命令与 CLI 用例。

> 这就是 \*nix Agent 的核心哲学：不发明新的工具接口，把 Unix 已经验证了 50 年的设计直接交给 LLM。

---

## 2. 为什么只有一个 run

### 2.1 单工具假说

主流 Agent 框架给 LLM 一堆独立工具：

```bash
tools: [search_web, read_file, write_file, run_code, send_email, ...]
```

LLM 每次调用前要做工具选择——用哪个？参数怎么填？工具越多，选择越难，准确率越低。认知负荷花在了"选工具"上，而不是"解决问题"上。

我的做法：**一个 `run(command="...")`**，所有能力通过 CLI 命令暴露。

```bash
run(command="cat notes.md")
run(command="cat log.txt | grep ERROR | wc -l")
run(command="see screenshot.png")
run(command="memory search 'deployment issue'")
run(command="clip sandbox bash 'python3 analyze.py'")
```

LLM 仍然需要选择"用什么命令"，但这和"从 15 个不同 schema 的工具中选一个"是完全不同的认知任务。命令选择是在一个统一的 namespace 里做字符串组合——而函数选择是在多个不相关的 API 间做模式切换。

### 2.2 LLM 的 CLI 母语

为什么 CLI 命令比结构化函数调用更适合 LLM？

因为 LLM 的训练数据里，CLI 是最密集的工具使用范式。GitHub 上数十亿行代码充满了：

```bash
# README 里的安装指南
pip install -r requirements.txt && python main.py

# CI/CD 里的构建脚本
make build && make test && make deploy

# Stack Overflow 里的解决方案
cat /var/log/syslog | grep "Out of memory" | tail -20
```

我不需要教 LLM 如何使用 CLI——它已经会了。这种熟悉度是概率性的、模型相关的，但在主流模型上经验证非常可靠。

对比两种方式完成同一个任务：

```
任务：读取日志文件，找出错误行数

函数调用方式（3 次 tool call）：
1. read_file(path="/var/log/app.log") → 返回完整文件
2. search_text(text=<entire file>, pattern="ERROR") → 返回匹配行
3. count_lines(text=<matched lines>) → 返回数字

CLI 方式（1 次 tool call）：
run(command="cat /var/log/app.log | grep ERROR | wc -l")
→ "42"
```

一次调用替代三次。不是因为做了特殊优化——而是 Unix 管道天然支持组合。

### 2.3 让管道和链式执行成为可能

光有一个 `run` 不够。如果 `run` 只能执行单条命令，LLM 还是要多次调用才能完成组合任务。所以我在命令路由层实现了一个链式解析器（`parseChain`），支持四种 Unix 操作符：

| 操作符 | 语义 |
|--------|------|
| `\|` | 管道：前一个命令的 stdout 作为后一个的 stdin |
| `&&` | 与链：前一个成功才执行后一个 |
| `\|\|` | 或链：前一个失败才执行后一个 |
| `;` | 顺序：无论前一个成败都执行后一个 |

有了这个机制，LLM 的每一次 tool call 都可以是一个完整的工作流：

```bash
# 一次 tool call：下载 → 查看
curl -sL $URL -o data.csv && cat data.csv | head 5

# 一次 tool call：读文件 → 过滤 → 排序 → 取前 10
cat access.log | grep "500" | sort | head 10

# 一次 tool call：尝试 A，失败则尝试 B
cat config.yaml || echo "config not found, using defaults"
```

N 个命令 × 4 种操作符，组合空间急剧扩大。而在 LLM 看来，这只是一个字符串——它已经从训练数据里学会了怎么写。

> **命令行就是 LLM 的母语工具接口。**

---

## 3. 启发式设计：让 CLI 引导 Agent 顺滑工作

单工具 + CLI 解决了"用什么"的问题，但 Agent 还需要知道**"怎么用"**。它没有搜索引擎，没有同事可以问。我通过三个递进的设计手段，让 CLI 自身成为 Agent 的导航系统。

### 3.1 渐进式 `--help` 自发现

一个设计良好的 CLI 工具，用户不需要读文档就能上手——因为 `--help` 告诉了一切。我把同样的理念用在 Agent 身上，并且做成了**渐进式披露**：Agent 不需要一次加载所有文档，而是按需逐层深入。

#### 第零层：Tool Description → 命令列表注入

`run` 工具的 description 在每次对话开始时动态生成，列出当前所有已注册命令的一行摘要：

```
Available commands:
cat — Read a text file. For images use 'see'. For binary use 'cat -b'.
see — View an image (auto-attaches to vision)
ls — List files in current topic
write — Write file. Usage: write <path> [content] or stdin
grep — Filter lines matching a pattern (supports -i, -v, -c)
memory — Search or manage memory
clip — Operate external environments (sandboxes, services)
...
```

Agent 从第一轮就知道有哪些能力，但不需要知道每个命令的所有参数——那会浪费上下文。

> **注：** 命令列表全量注入 vs 按需发现，随着命令增多这里存在上下文预算的权衡。目前还在探索更优的平衡方式，欢迎讨论。

#### 第一层：`command`（无参数）→ 命令用法

Agent 对某个命令感兴趣时，直接调用它。没给参数？命令返回自己的用法：

```
→ run(command="memory")
[error] memory: usage: memory search|recent|store|facts|forget

→ run(command="clip")
clip list — list available clips
clip <name> — show clip details and commands
clip <name> <command> [args...] — invoke a command
clip <name> pull <remote-path> [name] — pull file from clip to local
clip <name> push <local-path> <remote> — push local file to clip
```

现在 Agent 知道 `memory` 有五个子命令，`clip` 可以 list/pull/push。只花了一次调用，没有多余信息。

#### 第二层：`command subcommand`（缺参数）→ 具体参数

Agent 决定用 `memory search`，但不确定参数格式？继续深入：

```
→ run(command="memory search")
[error] memory: usage: memory search <query> [-t topic_id] [-k keyword]

→ run(command="clip sandbox")
Clip: sandbox
Commands:
  clip sandbox bash <script>
  clip sandbox read <path>
  clip sandbox write <path>
File transfer:
  clip sandbox pull <remote-path> [local-name]
  clip sandbox push <local-path> <remote-path>
```

**渐进式披露：概览（注入）→ 用法（探索）→ 参数（深入）。** Agent 按需探索，每一层只获取当前需要的信息量。

这和把所有文档塞进 system prompt 是完全不同的思路。system prompt 里塞 3000 字的工具文档，大部分信息在大部分时候都用不到——白白占用上下文预算。渐进式 help 让 Agent 自己决定什么时候需要更多信息。

这也对命令设计提出了要求：**每个命令、每个子命令都必须有完整的 help 输出。** 不仅是给人看的，更是给 Agent 看的。一条好的 help 能让 Agent 一步到位，一条缺失的 help 意味着一次盲猜。

### 3.2 Error Message 纠偏

Agent 不可能永远走对路。关键不是阻止它犯错，而是**让每个错误都指向正确方向**。

传统 CLI 的错误信息给人看——人可以 Google。Agent 不能 Google。所以我要求每个错误同时包含"出了什么问题"和"该怎么做"：

```
传统 CLI：
$ cat photo.png
cat: binary file (standard output)
→ 人会 Google "how to view image in terminal"

我的设计：
[error] cat: binary image file (182KB). Use: see photo.png
→ Agent 直接调用 see，一步修正
```

更多例子：

```
[error] unknown command: foo
Available: cat, ls, see, write, grep, memory, clip, ...
→ Agent 立刻知道有哪些命令

[error] not an image file: data.csv (use cat to read text files)
→ Agent 从 see 切换到 cat

[error] clip "sandbox" not found. Use 'clip list' to see available clips
→ Agent 知道先列出 clips
```

手段一（help）解决"我能做什么"。手段二（error）解决"做错了怎么办"。两者配合，Agent 的试错成本极低——通常 1-2 步就能找到正确路径。

#### 真实案例：stderr 被丢弃的代价

有段时间，我的代码在调用外部沙箱时，如果 stdout 非空就丢弃 stderr。Agent 运行 `pip install pymupdf`，exit code 127。stderr 里有 `bash: pip: command not found`，但 Agent 看不到。它只知道"失败了"，不知道"为什么"——于是盲猜了 10 种包管理器：

```
pip install → 127 (不存在)
python3 -m pip → 1 (模块不存在)
uv pip install → 1 (用法错误)
pip3 install → 127
sudo apt install → 127
... 又试了 5 种 ...
uv run --with pymupdf python3 script.py → 0 ✓ (第 10 次)
```

修复后 stderr 永远可见，Agent 第一次就看到 `"pip: command not found"`，立刻换方向。

> **stderr 是 Agent 最需要的信息，恰恰在命令失败的时候。永远不要丢弃它。**

### 3.3 Output Format 持续反馈

前两个手段解决了 Agent 的"发现"和"纠错"。第三个让 Agent 在持续执行过程中越来越懂系统。

我在每个 tool result 末尾追加一致的元数据：

```
file1.txt
file2.txt
dir1/
[exit:0 | 12ms]
```

LLM 从中提取两个信号：

**退出码**（Unix 约定，LLM 已掌握）：
- `exit:0` — 成功
- `exit:1` — 一般错误
- `exit:127` — 命令不存在

**耗时**（成本感知）：
- `12ms` — 廉价操作，可以放心多调
- `3.2s` — 中等成本
- `45s` — 昂贵操作，需要谨慎

Agent 在对话中看到几十次 `[exit:N | Xs]` 后，内化了这个模式。它开始预判——看到 `exit:1` 就知道检查错误，看到耗时很长就减少调用。

> **一致的输出格式让 Agent 越用越聪明。不一致让每次都像第一次。**

### 3.4 三个手段的递进关系

| 手段 | 解决的问题 | 模式 |
|------|-----------|------|
| `--help` | "我能做什么？" | 主动发现 |
| Error Msg | "做错了怎么办？" | 被动纠偏 |
| Output Fmt | "做得怎么样？" | 持续学习 |

---

## 4. 双层架构：把启发式设计落地的工程

上面讲了 CLI 如何在语义层面引导 Agent。但要真正落地，还需要解决一个工程问题：CLI 执行的原始输出，和 LLM 需要看到的结果，往往不是一回事。

### 4.1 LLM 的两个硬约束

- **约束 A：上下文窗口有限且昂贵。** 每个 token 消耗金钱、注意力、推理速度。一个 10MB 文件全文塞进上下文，不仅浪费，还会把之前的对话挤出窗口——Agent "失忆"。
- **约束 B：LLM 只能处理文本。** 二进制数据经过 tokenizer 产生高熵无意义的 token。它不仅浪费上下文，还会扰乱周围有效 token 的注意力，导致推理质量下降。

这两个约束决定了：命令的原始输出不能直接扔给 LLM——需要一个呈现层做加工。但加工不能影响命令的执行逻辑——否则管道会坏。所以需要分层。

### 4.2 执行层 vs 呈现层

```
┌─────────────────────────────────────┐
│  Layer 2: LLM 呈现层               │ ← 为 LLM 认知约束设计
│  二进制拦截 │ 截断+溢出 │ 元数据    │
├─────────────────────────────────────┤
│  Layer 1: Unix 执行层               │ ← 纯 Unix 语义
│  命令路由 │ pipe │ chain │ exit     │
└─────────────────────────────────────┘
```

当 `cat bigfile.txt | grep error | head 10` 执行时：

```
Layer 1 内部：
cat 输出 → [500KB 原始文本] → grep 输入
grep 输出 → [匹配的行]      → head 输入
head 输出 → [前 10 行]
```

- 如果在 Layer 1 截断 cat 的输出 → grep 只搜到前 200 行，结果不完整。
- 如果在 Layer 1 加 `[exit:0]` → 它作为文本流入 grep，变成搜索内容。

所以 **Layer 1 必须保持原始、无损、无元数据**。加工只在 Layer 2 发生——管道链执行完毕，最终结果准备返回给 LLM 时。

> Layer 1 服务于 Unix 语义。Layer 2 服务于 LLM 认知。分层不是设计偏好，是逻辑必然。

### 4.3 Layer 2 的四个机制

#### 机制 A：二进制守卫（应对约束 B）

在返回给 LLM 之前，检查内容是否为文本：

| 检测条件 | 判定 |
|----------|------|
| 检测到 null byte | 二进制 |
| UTF-8 校验失败 | 二进制 |
| 控制字符比例 > 10% | 二进制 |

处理方式：
- 图片：`[error] binary image (182KB). Use: see photo.png`
- 其他：`[error] binary file (1.2MB). Use: cat -b file.bin`

LLM 永远不会收到它无法处理的数据。

#### 机制 B：溢出模式（应对约束 A）

```
输出 > 200 行 或 > 50KB？
→ 截断到前 200 行（rune-safe，不切断 UTF-8）
→ 完整输出写入 /tmp/cmd-output/cmd-{n}.txt
→ 返回给 LLM：

    [前 200 行内容]

    --- output truncated (5000 lines, 245.3KB) ---
    Full output: /tmp/cmd-output/cmd-3.txt
    Explore: cat /tmp/cmd-output/cmd-3.txt | grep <pattern>
             cat /tmp/cmd-output/cmd-3.txt | tail 100
    [exit:0 | 1.2s]
```

关键洞察：LLM 已经知道如何用 grep、head、tail 导航文件。溢出模式把"大数据探索"转化为 LLM 已掌握的技能。

#### 机制 C：元数据脚注

```
actual output here
[exit:0 | 1.2s]
```

退出码 + 耗时，追加在 Layer 2 的最后一行。给 Agent 判断成败和感知成本的依据，同时不污染 Layer 1 的管道数据。

#### 机制 D：stderr 附加

```
命令失败且有 stderr 时：
output + "\n[stderr] " + stderr
```

确保 Agent 能看到错误原因，不会盲目重试。

---

## 5. 实现：agent-clip 核心代码

> 以下为简化的伪代码，突出架构骨架。完整实现见源码仓库。

### 5.1 单工具定义

```go
// LLM 只看到一个工具：run(command, stdin?)
// 所有命令及帮助文本列在 description 里
func RunToolDef(commands map[string]string) ToolDef {
    desc := "Execute commands via run(command=\"...\").\n"
    desc += "Supports chaining: cmd1 && cmd2, cmd1 | cmd2.\n\n"
    for name, help := range commands {
        desc += "  " + name + " — " + help + "\n"
    }
    return ToolDef{
        Name:        "run",
        Description: desc,
        Parameters:  { command: string, stdin?: string },
    }
}
```

### 5.2 Layer 1：命令路由与管道

```go
// Exec 解析命令链，执行管道，返回原始输出 + 退出码
// 这里是纯 Unix 语义——没有截断，没有元数据，没有二进制检测
func (r *Registry) Exec(command, stdin string) (string, int) {
    segments := parseChain(command) // 按 &&, ||, |, ; 分割

    for i, seg := range segments {
        if prevOp == OpAnd && lastExitCode != 0 { continue }
        if prevOp == OpOr  && lastExitCode == 0 { continue }
        if prevOp == OpPipe { stdin = lastOutput }

        lastOutput, lastExitCode = r.execSingle(seg, stdin)
    }
    return lastOutput, lastExitCode
}

func (r *Registry) execSingle(command, stdin string) (string, int) {
    name, args := tokenize(command)

    handler, ok := r.handlers[name]
    if !ok {
        return "[error] unknown command: " + name + "\nAvailable: ...", 127
    }

    output, err := handler(args, stdin)
    if err != nil {
        return "[error] " + name + ": " + err.Error(), 1
    }
    return output, 0
}
```

### 5.3 Layer 2：LLM 呈现层

```go
// execToolCall 把 Layer 1 的原始结果加工成 LLM 能理解的格式
// 所有的截断、溢出、元数据包装都在这里发生
func execToolCall(registry *Registry, tc ToolCall) string {
    command, stdin := parseToolCallArgs(tc)

    // Layer 1: 纯执行
    start := time.Now()
    rawOutput, exitCode := registry.Exec(command, stdin)
    duration := time.Since(start)
    metadata := fmt.Sprintf("[exit:%d | %s]", exitCode, duration)

    // 失败时直接返回（execSingle 已加 [error] 前缀 + stderr）
    if exitCode != 0 {
        return rawOutput + "\n" + metadata
    }

    // 截断检查（仅超限时才持久化到 /tmp）
    result := rawOutput
    if tooLarge(rawOutput) {
        truncated := first200LinesRuneSafe(rawOutput)
        file := persistToTmp(rawOutput)
        result = truncated + "\n--- truncated ---\nFull output: " + file
    }

    return result + "\n" + metadata
}
```

### 5.4 二进制守卫

```go
func fsCat(args []string, stdin string) (string, error) {
    data := readFile(path)

    // 二进制守卫：拦截 LLM 无法处理的数据，引导到正确命令
    if !base64Flag && isBinary(data) {
        if isImage(path) {
            return error("binary image (%s). Use: see %s", size, path)
        }
        return error("binary file (%s). Use: cat -b %s", size, path)
    }
    return string(data), nil
}

func isBinary(data []byte) bool {
    sample := data[:min(8192, len(data))]
    if containsNull(sample)        { return true } // null byte = 一定是二进制
    if !utf8.Valid(sample)         { return true } // 非法 UTF-8 = 大概率二进制
    if controlRatio(sample) > 0.1  { return true } // 控制字符太多
    return false
}
```

### 5.5 Vision 自动挂载

```go
// Agent 不需要显式请求"看图"——see 返回的 URL 被自动挂载到 vision 通道
func extractImagesFromResult(result string) []ImageData {
    urls := findImageURLs(result) // 匹配 pinix-data://...png
    for _, url := range urls {
        data := readFile(urlToPath(url))
        images = append(images, ImageData{
            Base64:   base64Encode(data),
            MimeType: detectMIME(url),
        })
    }
    return images // 附加到下一轮 LLM 调用的 vision 内容
}
```

### 5.6 Agentic Loop

```go
func RunLoop(config, context, registry, output) {
    // 不设硬性迭代上限。LLM 不调用工具时循环自然结束。
    // 如果 Agent 还在调工具，说明它认为任务没完成——
    // 我通过前面的启发式设计（help / error / output format）
    // 让它更快到达终点，而不是粗暴截断它的执行。
    //
    // 实际安全边界由外部机制保障：沙箱隔离、API 预算、用户取消。
    for {
        response := callLLM(context)

        if response.hasToolCalls() {
            for _, tc := range response.toolCalls {
                result := execToolCall(registry, tc)      // Layer 2 包装
                images := extractImagesFromResult(result)  // vision 挂载
                context.append(toolResult(result, images))
            }
            continue
        }

        // LLM 没有调用工具 = 任务完成
        return response.content
    }
}
```

---

## 6. 经验教训：来自生产的故事

### 故事 1：一张 PNG 引发的 20 轮崩溃

用户上传了一张架构图。Agent 用 `cat` 读取，收到 182KB 的 PNG 原始字节。LLM 的 tokenizer 把这些字节变成数千个无意义的 token，塞进上下文。LLM 完全无法理解，开始反复尝试不同的读取方式——每次都返回同样的乱码。20 轮后进程被强制终止。

- **根因：** `cat` 没有二进制检测，Layer 2 没有拦截。
- **修复：** `isBinary()` 守卫 + 错误引导 `Use: see photo.png`。
- **教训：** Tool result 是 Agent 的眼睛。返回垃圾 = Agent 失明。

### 故事 2：沉默的 stderr 与 10 次盲猜

Agent 需要读取一个 PDF。它尝试 `pip install pymupdf`，exit code 127。但 stderr（`bash: pip: command not found`）被代码丢弃了——因为有一小段 stdout，代码逻辑是"有 stdout 就忽略 stderr"。

Agent 只看到"失败了"，不知道"为什么"。接下来是漫长的试错：

```
pip install        → 127 (不存在)
python3 -m pip     → 1   (模块不存在)
uv pip install     → 1   (用法错误)
pip3 install       → 127
sudo apt install   → 127
... 又试了 5 种 ...
uv run --with pymupdf python3 script.py → 0 ✓
```

10 次调用，每次 ~5 秒推理。如果第一次 stderr 可见，1 次就够了。

- **根因：** `InvokeClip` 在有 stdout 时静默丢弃 stderr。
- **修复：** 失败时永远附加 stderr。
- **教训：** stderr 是 Agent 最需要的信息，恰恰在命令失败的时候。

### 故事 3：溢出模式的价值

Agent 分析一个 5000 行的日志文件。没有截断时，5000 行全文（~200KB）塞进上下文，LLM 的注意力被淹没，回答质量骤降，还把之前的对话挤出了上下文窗口。

加了溢出模式后：

```
[前 200 行日志内容]

--- output truncated (5000 lines, 198.5KB) ---
Full output: /tmp/cmd-output/cmd-3.txt
Explore: cat /tmp/cmd-output/cmd-3.txt | grep <pattern>
         cat /tmp/cmd-output/cmd-3.txt | tail 100
[exit:0 | 45ms]
```

Agent 看到前 200 行，了解了文件结构，然后用 grep 精准定位——总共 3 次调用，上下文占用不到 2KB。

- **教训：** 给 Agent 一个"地图"比给它"全部领土"有效得多。

---

## 7. 边界与局限

CLI 不是银弹。以下场景中，typed API 可能是更好的选择：

- **强类型交互：** 数据库查询、GraphQL API 等需要结构化输入输出的场景，schema 验证比字符串解析更可靠。
- **高安全要求：** CLI 的字符串拼接天然带有注入风险。在不可信输入场景中，typed parameters 比命令字符串更安全。agent-clip 通过沙箱隔离来缓解这个问题。
- **多模态原生：** 纯音视频处理等需要二进制流的场景，CLI 的文本管道是瓶颈。

此外，"不设迭代上限"不意味着没有安全边界。实际安全由外部机制保障：

- **沙箱隔离：** 命令在 BoxLite 容器内执行，无法逃逸
- **API 预算：** LLM 调用有账户级别的费用上限
- **用户取消：** 前端提供取消按钮，后端支持 graceful shutdown

---

## 结语

把 Unix 哲学交给执行层，把 LLM 的认知约束交给呈现层，用 help、error message 和 output format 构建三个递进的启发式导航手段。**CLI is all agents need.**

以上所有设计在 [agent-clip](.) 中均有完整实现。核心代码对应关系：

| 设计 | 代码 |
|------|------|
| 单工具命令路由 | `internal/tools.go` |
| 管道与链式执行 | `internal/chain.go` |
| 双层 agentic loop | `internal/loop.go` |
| 文件系统与二进制守卫 | `internal/fs.go` |
| 外部环境调用与 stderr 处理 | `internal/clip.go` |
| 浏览器自动化与 vision 挂载 | `internal/browser.go` |
| 语义记忆与向量搜索 | `internal/memory.go` |

---

*Built with Go. Powered by Unix. Designed for LLMs.*
