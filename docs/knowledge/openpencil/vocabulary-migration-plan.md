# DSL 词汇迁移计划（基于 Open Pencil 对照）

> Date: 2026-04-21
> Parent: [openpencil-deep-dive.md](openpencil-deep-dive.md)
> Source comparison: `~/Projects/open-pencil/` (github.com/open-pencil/open-pencil @ 0f875ee)

## TL;DR

- **之前的判断错了**：我们的 plugin 已经在"Tailwind shorthand 象限"，不是"Figma API CamelCase 象限"。`expandShorthands.ts` 里有 ~40 个 DSL 缩写，system prompt 只暴露 shorthand。
- **真正的问题**是"方言差异"：同义词冗余 + 残留 CSS 污染 + 读写不对称，不是范式错位。
- **推荐**一次**窄迁移**（~12 处具体改动），不是全量重做。分两 wave，Wave 1 低风险直接做，Wave 2 需要 A/B 数据支持。

---

## 1. 修正：我们当前的真实位置

### 已有 shorthand（`expandShorthands.ts` + handlers）

| 类别 | 我们已有 |
|---|---|
| Sizing | `w`, `h`, `minW`, `maxW`, `minH`, `maxH` |
| Padding | `p`, `pt`, `pr`, `pb`, `pl`, `px`, `py` |
| Layout | `layout`, `gap`, `cols`, `rows`, `rowGap`, `colGap` |
| Alignment | `align`, `justify`, `alignItems`, `alignMain`, `alignCross` |
| Typography | `size`, `weight`, `font`, `leading`, `tracking` |
| Color | `fill`, `bg`, `background` |
| Effects | `shadow`, `blur`, `bgblur` |
| Shape | `corner`, `radius`, `borderRadius`, `smooth` |
| Stroke | `stroke`, `strokeW`, `strokeA`, `strokeJ`, `strokeC`, `dash` |
| Misc | `blend`, `overflow`, `clips`, `wrap`, `positioning`, `lockRatio`, `truncate`, `maxLines` |

System prompt 完全基于 shorthand layer，LLM 看不到 `layoutMode/paddingLeft/primaryAxisAlignItems/cornerRadius/fills` 这类 Figma API 原名。

**所以原先的"迁移到 Tailwind"框架错了**——我们已经在 Tailwind 风格里。问题是"细节校准"。

---

## 2. 与 Open Pencil 的具体方言差异

同一个概念两种方案对比，按"问题严重度"排序：

### A. CSS 污染（高优先级，直接修）

| # | 概念 | 我们 | Open Pencil | 问题 |
|---|---|---|---|---|
| 1 | justify 取值 | `'space-between'` | `'between'` | `space-between` 是 CSS class 名，LLM 看到激活 CSS prior → 可能继续写 `space-evenly`、`space-around`（我们不支持） |
| 2 | justify 别名 | `justify` + `justifyContent` | `justify` 单一 | `justifyContent` 是 CSS camelCase，鼓励 LLM 写 CSS 风格 |
| 3 | align 别名 | `align` + `alignItems` + `alignMain` + `alignCross` | `items`（cross）+ `justify`（main）单一 | 4 个同义词 LLM 必错；`alignItems` 激活 CSS |
| 4 | corner 别名 | `corner` + `radius` + `borderRadius` | `rounded` 单一 | `borderRadius` 是 CSS camelCase 原名 |
| 5 | width 取值 | `'100%'` 被接受 | 只接受 number/`'fill'`/`'hug'` | `'100%'` 是 CSS，Figma 不支持百分比 |

### B. 同义词冗余（中优先级）

| # | 概念 | 我们 | Open Pencil | 问题 |
|---|---|---|---|---|
| 6 | fill 别名 | `fill` + `bg` + `background` | `bg` 主，`fill` 别名 | 3 选 1 导致 LLM 随机化 |
| 7 | layout 值 | `'row'` / `'column'` / `'horizontal'` / `'vertical'` / `'grid'` / `'none'` | `'row'` / `'col'`（`'column'` 别名）+ boolean `grid` | `'horizontal'/'vertical'` 冗余；`col` 比 `column` 短 |
| 8 | pointCount | `points` + `pointCount` | `points` 单一 | Figma API 原名混入 |

### C. 取值约定差异（中优先级）

| # | 概念 | 我们 | Open Pencil | 问题 |
|---|---|---|---|---|
| 9 | weight 值 | `'semi-bold'` → 内部归一化为 `'Semi Bold'` Figma style name | `400/500/700` 数值 或 `'normal'/'medium'/'bold'` | Figma style name（`'Semi Bold'`）本地化敏感，Inter 有 `'Semi Bold'` 但 Roboto 没有；数值更稳 |
| 10 | lineHeight | number（≤5 被当 multiplier） | number（绝对 px） | 启发式魔法，LLM 不可预测；Open Pencil 纯 px 更一致 |
| 11 | stroke 格式 | 空格分隔字符串 `"1 #E5E7EB inside"` | `stroke="#hex"` + `strokeWidth={N}` | 空格分隔 = 自创 syntax，LLM 解析错误率高 |
| 12 | overflow | boolean or `'hidden'/'clip'` | `'hidden'/'visible'` 纯 string | boolean/string 二义性 |

### D. 读写不对称（高优先级，我们特有）

`inspect` / `describe` 返回 Figma API 原名（`fills`, `primaryAxisAlignItems`, `cornerRadius`, `paddingLeft`...），但写入用 shorthand（`fill`, `justify`, `corner`, `pl`...）。**LLM 学到"读是 A，写是 B"**，每次 inspect 后的 edit 都要心里翻译一次。

Open Pencil 读写对称：读写都用 shorthand。

---

## 3. Wave 1：低风险直接做（~12 处）

目标：去 CSS 污染 + 删同义词 + 读写对称。**不改执行层语义**，只在 parser / 返回值层面改名。

### Wave 1.1 — 值域收紧（deprecation，保留读旧、推新）

| 改动 | 老值接受？ | 新值 |
|---|---|---|
| `justify: 'space-between'` → `'between'` | ✅ 保留一段 + warn | `'between'` |
| `w/h: '100%'` → 删除 | ❌ 直接报错 | `'fill'` |
| `weight: 'semi-bold'` → `500` | ✅ 保留 | 数值或 `'normal'/'medium'/'bold'` |
| `overflow: true/false` → `'hidden'/'visible'` | ✅ 保留 | string 值 |

### Wave 1.2 — 别名收敛（drop 同义词）

| 保留 | 删除（system prompt 不再示范，旧 JSX 仍能跑） |
|---|---|
| `justify` | `justifyContent` |
| `items`（新增，CSS `align-items` 的 Tailwind 名）| `alignItems`, `align`（当 cross 用时），`alignCross` |
| 继续用 `align`（当两轴快捷用） | `alignMain` |
| `bg`（主）, `fill`（别名）| `background` |
| `rounded`（新增）→ 别名 `corner`, `radius` | `borderRadius` |
| `points` | `pointCount` |
| `layout` 值 `'row' / 'col' / 'grid' / 'none'` | `'horizontal'`, `'vertical'`, `'column'`（或保 `'column'` 作别名）|

### Wave 1.3 — 读写对称

修改 `inspect.ts` 和 `describe.ts` 的返回格式，加一个 `summarizeToShorthand()` 函数，把 Figma API 返回包装成 shorthand：

```ts
// inspect 返回
{
  id: "1:2",
  type: "FRAME",
  // 之前: layoutMode: "HORIZONTAL", primaryAxisAlignItems: "SPACE_BETWEEN"
  // 之后:
  layout: "row",
  justify: "between",
  items: "center",
  gap: 12,
  // 之前: paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8
  // 之后:
  px: 16,
  py: 8,
  // 之前: cornerRadius: 8
  rounded: 8,
  // 之前: fills: [{type: 'SOLID', color: {r:1,g:1,b:1,a:1}}]
  bg: "#FFFFFF",
  ...
}
```

**注意**：对称需要**反向映射表**。之前是 `expandShorthands()`（写入方向），现在要加 `collapseToShorthand()`（读取方向）。

### Wave 1 工作量

| 文件 | 改动 |
|---|---|
| `src/engine/agent/tools/unified/expandShorthands.ts` | 删别名 key + warn 老值 |
| `src/engine/agent/tools/unified/collapseToShorthand.ts` | **新增**文件，反向映射 |
| `src/engine/agent/tools/unified/inspect.ts` | 用 `collapseToShorthand()` 包装返回 |
| `src/engine/agent/tools/unified/describe.ts` | 同上 |
| `src/prompts/CORE.md` + `EXAMPLES.md` | 更新 value 约定 |
| knowledge entries 里的 style/anatomy 示例 | grep & 替换 |

估算：**1 人天完成 + 1 人天测试**。风险：knowledge entries 里的 JSX 示例要批量过一遍（100 个条目）。

---

## 4. Wave 2：需要 A/B 数据支持（~5 处）

这些改动有 prior 迁移成本（LLM 要重新习惯），不确定纯收益，先做 A/B 再决定。

| # | 改动 | 假设 | 风险 |
|---|---|---|---|
| 13 | `layout="row"` → `flex="row"` | `flex` 更短 + 匹配 CSS `display:flex`（LLM 看到更容易激活"这是 layout 容器"） | `flex` 激活 CSS flex 整套 prior，可能引入 `flex-wrap`/`flex-grow` 误用 |
| 14 | `layout="grid"` → `grid` (boolean) | 和 CSS `display:grid` 对齐 | 同上 |
| 15 | `stroke` 空格字符串 → 拆成 `stroke`（hex）+ `strokeWidth`（num）| 语法更规则 LLM 更少解析错 | 多一个 prop，JSX 更长 |
| 16 | `lineHeight` 删启发式（纯 px） | 可预测 > 便利 | 老的 `lineHeight={1.5}` 写法会失效 |
| 17 | 完全对称（连 `inspect` 返回的枚举都 lowercase，`'SPACE_BETWEEN'` → `'between'`）| 读写完全一致 | 工程大，value 映射表翻倍 |

### A/B 实验协议

对每个 Wave 2 改动：

1. **固定 prompt 集**：10 个设计 prompt，覆盖 layout 密集场景（login、dashboard、card grid、nav bar、form）。从现有 dev bridge history 里选过去跑过的案例。
2. **双版本 plugin build**：一个老 DSL，一个新 DSL。其他一切相同。
3. **Trigger 并行**：每个 prompt 对两 version 各跑 3 次（36 次 × 2 = 72 triggers），取平均。
4. **指标**：
   - Layout 正确率（人审 + `describe` lint 数）
   - Token 总数（prompt + response）
   - 首次成功率（无 retry）
   - 工具调用次数
   - 总耗时
5. **决策阈值**：新版本在 3/5 指标 improve ≥ 10% → 铺开；否则回滚。

这是一个完整 afternoon 的工程（build + 72 triggers @ 15min each = 18 hours 机器时间，但可并发）。建议 Wave 2 单开一个任务，Wave 1 完成后再启动。

---

## 5. **不要做**的事（反模式警告）

### 不要做：直接复制 Open Pencil 的 `flex="row"` + ⚠ 十几条硬警告

原因：Open Pencil 的 ⚠ 警告密集是因为 `flex` 激活了完整 CSS flex prior → LLM 误用 → 加警告 → 又误用 → 加警告。这是一个 **因** 换 **果** 的折腾。

我们的 `layout="row"` 虽然可能"激活略弱"，但 `layout` 不触发 CSS flex 全家桶，prior 可控。保留也许更优。**Wave 2.13/14 必须 A/B 实测验证**，不要盲目复制。

### 不要做：给每个 Figma 概念都造一个 shorthand

Open Pencil 没给 constraints、component variants、variable modes 造 shorthand。这些是 Figma 独有概念，LLM 的 CSS prior 无关，直接用 Figma 原名就好。"shorthand"仅对 CSS 有对应物的概念有价值。

### 不要做：删 `js` 逃生舱

Open Pencil 没有 `js` 工具。我们有。**保留**。当 shorthand 不够用（比如 boolean operations、复杂 vector 操作），LLM 需要 Figma API 直接操作。

### 不要做：删除 knowledge / variable / ask_user 这些我们优势工具

Open Pencil 没有 `knowledge`、`alias_variable`、`ask_user`。这些是**我们的长板**，不是冗余。迁移词汇不等于对齐工具集。

---

## 6. 对照表速查（迁移后）

最终目标态：

| 概念 | 我们（Wave 1 后）| Open Pencil | 一致？ |
|---|---|---|---|
| Layout 方向 | `layout="row"/"col"/"grid"` | `flex="row"/"col"` + `grid` | ❌（Wave 2 决定）|
| Justify | `justify="between"/"center"/"start"/"end"` | 同 | ✅ |
| Items (cross) | `items="center"/"start"/"end"/"stretch"` | 同 | ✅（Wave 1 新增 `items`）|
| Padding | `p/pt/pr/pb/pl/px/py` | 同 | ✅ |
| Gap | `gap` | 同 | ✅ |
| Width/Height | `w/h`（number/`'fill'`/`'hug'`）| 同 | ✅（Wave 1 删 `'100%'`）|
| Min/Max | `minW/maxW/minH/maxH` | `minW/maxW` | ✅（我们多两个）|
| Grow | `grow` | 同 | ✅ |
| Background | `bg` | 同 | ✅（Wave 1 删 `background`）|
| Corner | `rounded` / `corner` / `radius`（我们保多名；OP 单一 `rounded`） | `rounded` | 🟡（Wave 1 首选 `rounded`）|
| Stroke | `stroke` 空格字符串 | `stroke`+`strokeWidth` | ❌（Wave 2 决定）|
| Font size | `size` | 同 | ✅ |
| Font weight | 数值 + 三个 string（normal/medium/bold）| 同 | ✅（Wave 1 迁移）|
| Text color | `fill` | `color` | ❌（我们用 `fill`，文本也是 fill，符合 Figma）|
| Shadow | `shadow` | 同 | ✅ |
| Overflow | `overflow="hidden"/"visible"` | 同 | ✅ |

**Text color** 这条故意保留差异：Figma 里 text 用 fill 是原生模型（text 也是一种 shape），Open Pencil 用 `color` 是 CSS 心智。我们保留 `fill` 更尊重 Figma。

---

## 7. 下一步

### 立即做（Wave 1）
1. 新建分支 `vocab-migration-wave1`
2. 实现 `collapseToShorthand.ts`
3. 改 `inspect.ts` / `describe.ts` 返回值
4. 更新 `CORE.md` / `EXAMPLES.md` value 表
5. 扫 knowledge entries 修 JSX 示例
6. 跑测试 + dev bridge smoke（3-5 个典型 prompt）
7. ship

### 延后做（Wave 2）
8. 设计 A/B 实验（10 prompts × 2 versions × 3 runs）
9. 实现并行 build + trigger 脚本
10. 跑数据 → 决策

### 学到的原则（归档到 memory）
- 不要在没读过自己代码的情况下断言"我们在错误象限"
- 竞品对照研究要先对齐"我们现在是什么"再对比"他们是什么"
- 同义词是 LLM DSL 最容易被忽视的熵源
- 读写不对称 = LLM 每次操作都要翻译 = 隐性 token 税
