# JS-Only E2E 测试实验记录 (2026-03-24)

## 实验目标

强制 agent 只使用 `run js` 命令（直接调 Figma Plugin API），创建一个与参考设计完全一致的 Login Card。测试 agent 在无 jsx/inspect/edit 抽象层时的能力。

## 实现的机制

### 1. toolFilter — 工具过滤

通过 dev bridge trigger 的 `toolFilter` 参数限制 agent 可用的工具。

**代码链路：**
- `useDevBridge.ts`: TriggerPayload 增加 `toolFilter?: string[]`
- `useChat.ts`: `generateFromPrompt()` 接受 `GenerateOptions`，过滤 `agentTools`
- 当 toolFilter 激活时，销毁现有 orchestrator 重建（工具集变了）

**用法：**
```json
{
  "prompt": "...",
  "toolFilter": ["run"],
  "reset": true
}
```

### 2. JS Error Memory — 错误自学习系统

`jsHandler.ts` 自动从 Figma API 错误中学习。

**架构：**
- 存储: `figma.clientStorage` key `js_api_lessons`，最多 20 条
- 格式: `{ error, errorCodeSnippet, fixCodeSnippet?, timestamp }`

**流程：**
1. **错误发生** → 自动保存 `{error, errorCodeSnippet}` 到 lessons
2. **成功执行**（前一条是未解决的错误）→ 配对保存 `fixCodeSnippet`
3. **每次执行前** → 加载所有 lessons，通过 `_stderr` 返回给 agent

**错误捕获：** `globalThis.onunhandledrejection` 捕获 Figma 异步 validation errors（如 `set_effects` 缺少 `visible` 字段），这些错误不会被 try/catch 捕获。

**snippet 提取：** 根据错误信息定位代码位置（property name 匹配、行号匹配），比盲目截取前 N 字符更精准。

### 3. BLOCKED_PATTERNS 放开

移除了 `figma.currentPage.children`（验证需要遍历子节点）和 `.insertChild`（结构操作需要）的安全限制。保留了 `.remove()`、`figma.root`、`figma.closePlugin` 等高危操作。

## 实验结果

### 测试 1: jsx-only（基线）
- 1 次 jsx 调用创建 30 节点 + 几次 edit 修复
- ~52s，4 次工具调用，1 次错误
- 效果好

### 测试 2-3: js-only（无 API 规则提示）
- LLM 不知道 Figma API 精确 schema
- `effects` 缺少 `visible: true` + `blendMode: 'NORMAL'` → 异步 validation error
- `counterAxisSizingMode: 'STRETCH'` → 不存在（只有 'FIXED'|'AUTO'）
- Agent 看不到错误（返回 `success: true`），盲人摸象

### 测试 4: js-only + API 规则提示
- Prompt 里加了 Figma API cheatsheet → LLM 直接写对
- 3 次 js 调用全部 success，无 API 错误
- ~430s（~7 分钟），主要耗时在 LLM 生成长 JS 代码

### 测试 5: js-only + 验证循环
- 创建成功，验证返回 `pass: false, mismatches: [...]`
- Agent 说 "Let me fix..." 但只输出了文本没有工具调用 → 被 turn end
- **暴露了 turn model 的根本问题**

## 核心发现

### Turn End 信号问题（架构缺陷）

**现状：** text-only response = turn end（暂停等用户）

**问题：** Agent 在验证发现 mismatch 后输出了修复计划的文本，但没有同时调工具。Runtime 把这个文本当成了 turn end，agent 停了。

**分析：**
- 结束可以是 tool-only、text-only、tool+text — 任何类型都可能是中间步骤或最终结果
- 当前启发式无法区分 "我在思考下一步" vs "我完成了"
- 缺少的是**显式完成信号**

**正确方案：** `_done` 参数
- 任何工具调用都可以附带 `_done: true` 表示 "执行完这个就结束"
- 没有 `_done` → 默认继续迭代
- Text-only 也继续（注入 continuation），直到 agent 通过工具调用 `_done: true` 显式结束
- Iteration limit 作为安全兜底

**状态：** 方案已确定，未实现

### Figma Plugin API — Agent 常见错误模式

| 错误 | 原因 | 正确写法 |
|------|------|----------|
| `set_effects` validation failed | 缺少 `visible`, `blendMode` | `{type:'DROP_SHADOW', ..., visible:true, blendMode:'NORMAL'}` |
| `counterAxisSizingMode: 'STRETCH'` | 不存在的枚举值 | 只用 `'FIXED'` 或 `'AUTO'`；填充宽度用 `layoutAlign='STRETCH'` |
| `unexpected token in expression` | 把多行代码放在 `command` 字符串里 | 用 `run({command:"js", input:"<code>"})` |
| `.remove()` blocked | 安全规则 | 用 `rm` 命令代替 |

### 性能对比

| 模式 | 调用次数 | 耗时 | 错误率 |
|------|---------|------|--------|
| jsx (标准) | 4 | ~52s | 25% |
| js-only (无提示) | 3 | ~430s | 0% (但盲) |
| js-only (有验证) | 6 | ~513s | 0% |
| js-only (有修复循环) | 15 | ~799s | 33% |

**结论：** js-only 模式比 jsx 慢 8-15x，主要瓶颈在 LLM 生成长 JS 代码的延迟。适合用作测试手段验证 Figma API 理解，不适合作为生产模式。

## 待办

- [ ] 实现 `_done` 信号参数（runtime 架构改动）
- [ ] 验证 `onunhandledrejection` 在所有 Figma sandbox 环境中可用
- [ ] 考虑 js error memory 的 dedup 逻辑（相同错误不重复存储）
