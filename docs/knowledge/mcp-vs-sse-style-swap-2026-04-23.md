# MCP Direct Drive vs SSE Autonomous — 同任务风格替换 A/B (2026-04-23)

> 任务：把一张移动端外卖订单页换成 "Fresh Mint Light" 薄荷色主题  
> Phase A：Claude Sonnet 子 agent，通过 MCP 直驱 genable 工具  
> Phase B：Kimi K2.5 驻插件，SSE 自主 agent loop  
> 结果：A 全覆盖但 6.8 min / 41 calls，B 快 4× 但漏 7 处，根因 inspect depth 截断

---

## 1. 背景与目标

同一套工具接口（genable MCP 暴露给 Claude Code，也是插件内 agent 的 tool set），两条调用路径：**MCP 外部直驱** vs **插件内 SSE 自主循环**。想观察在完全相同的结构化改写任务上，两条路径的正确率、延迟、工具选择模式有什么差异，并借机暴露工具描述与运行时的真实短板。

Style swap 是理想题目：输入是一棵固定的 Figma 树，输出标准完全可验证（颜色、圆角、阴影都能像素比对），没有 LLM 审美分歧空间。

---

## 2. 实验设置

目标画板：一个 390 × 844 的移动端外卖订单页 `1734:22071`，共约 119 节点，最深嵌套 7 层，中文内容（"订单详情"/"配送中" 等）。克隆两份作为独立实验容器：

- `CloneA`（`1762:22403`）— Phase A 用
- `CloneB`（`1762:22522`）— Phase B 用

原始风格是 dark-slate + indigo accent：背景 `#0F172A`、卡片 `#1E293B`、accent `#818CF8`。

目标风格 "Fresh Mint Light"：

| 角色 | 目标色 |
|---|---|
| Root 背景 | `#F7FBF8` |
| 卡片 | `#FFFFFF` |
| 分隔线 | `#D1E7DD` |
| Primary text | `#1B3A2F` |
| Secondary text | `#5C7A6E` |
| Accent | `#10B981`（emerald） |
| Success | `#059669` |
| Inactive progress | `#E5E7EB` |
| 图标容器底 | `#D1FAE5` |
| Vector stroke | indigo → emerald |

外加：圆角 × 1.5（取整），阴影颜色改为 `rgba(16,185,129,0.10)`，offset/blur/spread 保持原值。

---

## 3. Phase A — MCP 直驱（Claude Sonnet）

**耗时**：408 s（6.8 min）  
**工具调用**：41 次 — `inspect` × 3，`js` × 18（其中约 11 次是抛弃式 parser 探测，7 次真正写入），剩下是 schema 载入等开销  
**主力工具**：`js`（被当作 batch 逃生舱用）  
**覆盖率**：**100%** — 18 根 VECTOR stroke 全对，所有圆角缩放，所有阴影重染，零语义错误

子 agent 在过程中记录的 `js` 沙箱限制：

- `function name() {}` 声明被 parser 拒绝
- 方法链赋值 `figma.getNodeById(x).fills = Y` 被拒
- 箭头函数、predicate 回调 `findAll(function(n){...})` 都抛错
- 同步 `findAll` 提示 "Use `findAllAsync` instead"；异步版带回调又抛 "not a function"
- **唯一稳定模式**：顶层 `var n = figma.getNodeById(id); n.prop = value;`

`inspect detail` 把 shadow 序列化成压缩字符串 `"0,2,8,0,#0000000A"`，无法还原 offset/blur/spread/visible/type。`edit` 也没有暴露 effects 属性，所以阴影重染只能走 `js` 原生赋值。

`edit` 工具描述里写的 `maxItems: 8` 劝退了子 agent 走批量路线，转去堆 `js`。

Parser 报错只给 `"expecting ';'"`，不给行号，子 agent 只能二分注释代码定位语法问题。

---

## 4. Phase B — SSE 自主 agent（Kimi K2.5）

**耗时**：101 s（1.7 min）— 比 A 快 4 倍  
**工具调用**：4 次 — `inspect` × 1（`depth:6`），`edit` × 2 批量，`describe` × 1  
**主力工具**：`edit` — 第一批 **65 item**（违反 schema `maxItems: 8`，但插件照跑），第二批 4 item 补状态栏  
**覆盖率**：~95% — 7 个具体 bug：

1. **5 个 vector 未替换**：
   - Shop 图标 × 2 仍为 `#4F46E5`
   - Drink 图标 × 2 仍为 `#4F46E5`
   - Phone vector 填成了 `#5C7A6E`（secondary text）而不是 `#10B981`（accent）
2. **TotalRow frame** 多了一条 `#1B3A2F` 填充 — frame 与 text 角色混淆
3. **Status Icon 圆角** 留在 24（应为 36，漏乘 1.5）

Kimi 用纯 ID（`"1:2"` 格式）、Figma 原生字段名（`fill` / `stroke` / `corner` / `shadow`）、零概念翻译，65 item 一次全部成功，说明工具寻址和字段设计是成立的。

---

## 5. 根因分析

### 5.1 Phase B 漏 5 个 vector — inspect depth 静默截断

Kimi 的唯一侦察手段是 `inspect(node, mode:"detail", depth:6)`，返回里没有 `truncated` 标记，看起来像是完整树。实际结构：

```
CloneB > Content > Order Items > Item1 > ItemImage > Food > Vector        (depth 6, 可见)
CloneB > Content > Order Items > Item2 > ItemImage > Drink > Group > Vector   (depth 7, 被截)
CloneB > ... > Restaurant Card > Logo > Shop > Group > Vector                 (depth 7, 被截)
```

Location 和 Rider 图标在源里少套一层 `Group`，vector 恰好落在 depth 6 被看见，Kimi 就改对了；Shop、Drink 多一层 Group 的 vector 就永远看不见。**源数据结构的不对称 + 深度固定的截断 = 看起来随机但其实确定的漏改模式**。

### 5.2 Phase A 达到 100% — 绕开了 inspect

子 agent 不信任 inspect 的完整性，直接在 `js` 里写了自己的树遍历，对整棵子树做穷举式扫描。走原生 API 不受 serializer 深度限制，所以该漏的都看见了。代价是流程本身变长：先写 probe → 被 parser 拒 → 改写 → 再被拒 → 收敛到"只用 top-level `var`"才开始真正跑，前面 11 次调用基本在摸语法。

### 5.3 结论

**不是 Kimi 的判断力问题**。两个模型面对相同的节点信息都会做出正确决策。差异在于谁看到了完整信息 —— Phase A 靠自己绕出去，Phase B 相信 inspect 返回是完整的，直接被坑。

---

## 6. 决定（不再重辩）

### 要改

- **`edit.maxItems: 8` 必须修**：声明的上限未被运行时执行（Kimi 塞 65 个照跑）。要么删掉这个字段，要么设成一个真正测过的数值。经验实测另起一个单独实验确认具体 cliff。
- **`js` 工具描述补充支持子集**：文档里明确说清只支持 top-level `var`，不支持 `function` 声明、方法链赋值、predicate 回调。让 LLM 少走 11 次 probe 的弯路。

### 不改

- **inspect 保持现状**：不加 `truncated` 元数据，不把 effects 变成完整对象。拒绝的理由是 response 体积膨胀和字段耦合风险，成本大于收益。
- **阴影序列化不改**：`"0,2,8,0,#0000000A"` 这种压缩字符串保留。

### 验证策略调整

- **验证走 screenshot，不走 inspect 回读**：`inspect({screenshot:true})` 参数本来就在，只是 system prompt 没推荐。走 visual ground truth 而不是 JSON 回读，天然对齐 `feedback_figma_test_visual_first.md` 的原则。
- **是否要独立 `get_screenshot` 工具**：当前 `screenshot` 是 `inspect` 的 optional param，affordance 太低，LLM 发现不了。独立工具会显著提升使用率，但要多维护一个工具入口。**延后**决定。

### 延后

- **`edit` 对象语法直接染 effects**：理论上 `edit({shadow:{color:...}})` 应该能工作，但没实测。先不承诺。

---

## 7. 对其他议题的启示（Variable tools 方向）

这次 A/B 里 Kimi 那次 65 item `edit` 批量一次成功，证明：

- **纯 ID 寻址可行**：Kimi 零错写裸 ID，没尝试 `name#id` 也没尝试层级路径
- **Figma 原生字段命名可行**：`fill`/`stroke`/`corner`/`shadow` 没有翻译层，直接用
- **response 体积是核心预算**：Kimi 的高成功率建立在 inspect 输出可控的前提下，`list_variables` 这类未来工具必须把 `limit` 当成 load-bearing 默认值，不能让返回无上限增长

这几条对接下来 variable 工具设计是直接约束：别发明中间抽象层，别让返回失控。

---

## 8. 未决问题

- **LLM 输出截断的真实 cliff**：`maxItems` 没被执行，那 LLM 自己还是会在多少个 item 处开始错漏？需要单独的阶梯实验确认。
- **独立 `get_screenshot` 工具**：affordance vs 工具集膨胀的权衡还没结论。
- **`edit` 改 effects 对象语法**：假设可行但没跑过，留待后续。

---

## 9. 后记（同日晚间）—— maxItems 实测 & 实装变更

### `edit.maxItems` 实测数据

阶梯实验（kimi-k2.5 via dev bridge，3 轮）：

| Round | 目标 | 单次 `edit` 最多 items | 状态 |
|---|---|---|---|
| 1 | `1734:22071` (119 nodes) | 119 | ✅ success, 7KB params |
| 2 | `1730:20294` (142 nodes) | 142 | ✅ success, 6969 chars params, 753ms |
| 3 | 142 nodes × 5 props each | — | ❌ 流式输出卡死 74s，mid-JSON 截断 |

**结论**：
- `maxItems: 8` 是错的，被实际调用超出 17×
- 真实 cliff 是 **LLM 输出流字节数**（~10KB+ rendered params），不是 item count
- 4-prop × 142 items（~7KB）稳；5-prop × 142 items（~12KB projected）炸
- Kimi 有时会主动拆批（R1 先发 64+4 再合成 119）——说明对大 batch 有自我调节倾向
- 一个 id-resolution 次级 bug：89-item call 里 plugin 报 `"Node 'ID1, ID2, …' not found"`，像是 comma-joined string 被当 id 解析，需独立追查

### 实装

1. `edit.ts`: 删除 `maxItems: 8`，description 改成 "No hard item cap — real ceiling is LLM output stream length (~10KB+ of rendered params can stall mid-JSON). If a batch is large and props are rich, split into 2 calls."
2. `jsTool.ts`: description 末尾加 **Gotchas** 段（findAll → findAllAsync、writes 用 flat `var`、不要 method-chain 赋值、fills/effects 是 frozen object、parser 错误无行号要二分）

### 独立 `get_screenshot` 工具（仍未决）

观察：`inspect({screenshot:true})` 这条路很少被 agent 使用，affordance 太深。

设计选项（单推荐）：**新增 `get_screenshot({node, options?})`，同时从 `inspect` 移除 `screenshot` 参数**。理由：

- 命名 = affordance。`get_screenshot` 工具名本身就在告诉 LLM "你可以截图"
- `inspect` 瘦回去只做属性读取，语义更干净
- 代价：+1 工具（schema ~50 tok）、若有现存代码依赖 `inspect.screenshot:true` 需迁移
- 不做双轨（`inspect.screenshot` 保留 + 新增 `get_screenshot`）——两条路做同一件事是最糟的

尚未执行，待单独决策。

---

## 相关资料

- [feedback_figma_test_visual_first.md](../../MEMORY 引用) — Visual output 才是 ground truth
- [project_idmap_hierarchy.md](../../MEMORY 引用) — 单参数 node（纯 ID）寻址决策背景
- [kimi-streaming-token-leak-2026-04-22.md](./kimi-streaming-token-leak-2026-04-22.md) — Kimi 另一个低频 bug
