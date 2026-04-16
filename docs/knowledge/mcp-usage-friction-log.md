# MCP 使用摩擦日志

> 完整记录本次 session 中创建和使用 figma-plugin MCP 遇到的所有挫折。
> 按时间顺序，每条标注根因和修复状态。

## 1. MCP Server 启动

### 1.1 Server 启动 crash — 6 个死导入
**现象**: `npx tsx tools/mcp-server/index.ts` 立即报 MODULE_NOT_FOUND
**根因**: index.ts 引用了 6 个已删除的模块（commandParser, commandRegistry, guidelines-catalog.json, style-catalog.json, styleGuideMatcher, helpIndex）— 旧 CLI/knowledge 系统残留
**修复**: 重写 index.ts（440→105 行），只保留 unifiedTools + wsRelay
**教训**: MCP server 和主工程代码不同步。重构主工程时没更新 MCP server。

### 1.2 Plugin 反复断开
**现象**: MCP 连上后用几次就断开，需要用户手动 `/mcp` 重连
**根因**: Figma 插件在 build 后需要重新加载，WS 连接随之断开
**未解决**: 没有自动重连机制。每次 `node build.js` 后都需要用户手动重连。
**影响**: session 中至少 5 次中断，每次丢失 1-2 分钟。

## 2. Variable 工具

### 2.1 create_variable 返回 CLI 格式错误
**现象**: `create_variable({collection: "Theme", modes: ["Light","Dark"]})` → `"Usage: var mk --collection <name>"`
**根因**: `varAdapter.ts` 参数名不匹配 — adapter 发送 `{collName, modesStr, varPath}`，handler 期望 `{collection, modes, variable}`
**修复**: 改 adapter 发送正确 key 名
**教训**: adapter 模式（结构化 JSON → 旧 CLI handler）容易产生参数名失配。没有类型检查。

### 2.2 已有 Theme collection 的 mode 名被污染
**现象**: Dark mode 名是 `"Dark\nvar"` 而不是 `"Dark"`
**根因**: 旧 CLI 模式解析时把 `\n` 嵌入了 mode 名
**绕过**: 创建新 collection `LP-Theme` 替代旧的
**未修复**: 无法通过 API 重命名 mode 或删除 collection

### 2.3 `$var` inline 语法不生效
**现象**: `<frame p="$LP-Spacing/xl" bg="$LP-Theme/surface">` → padding=0, bg 无色
**根因**: `variableBindingHandler` 的 cache 用 `v.name`（"xl"）作 key，但 `$LP-Spacing/xl` 查找用 `"LP-Spacing/xl"` → 找不到
**修复**: cache key 改为 `collection.name + "/" + v.name`，保留 bare name 作 fallback
**教训**: 多 collection 同名 variable（如 Spacing/xl 和 Radius/xl）不能用 bare name 区分

### 2.4 `$var` 在对象形式 padding 里失效
**现象**: `p={{top: "$LP-Spacing/md"}}` → paddingTop=0
**根因**: `expandShorthands` 对象形式 padding 调 `Number(v.top)` — `Number("$LP-Spacing/md")` = NaN → 0
**修复**: 加 `isVarRef()` 检查，string 保留不 Number()
**教训**: expandShorthands 的每个分支都要考虑 `$var` 引用

## 3. Component Props 工具

### 3.1 edit 设置 component props 静默失败
**现象**: `edit({node: instanceId, props: {Label: "Email"}})` 返回 `updated: true` 但文字没变
**根因**: `normalizeProps` Step 7 "unknown property filter" 把 `Label` 作为未知 Figma 属性删除了，`resolveInstanceProps` 永远看不到它
**修复**: `editHandler.ts` 加 `splitComponentProps()` — 在 normalize 前先把 component props 抽出来
**教训**: property pipeline 的过滤层会静默吞掉合法的自定义属性。返回 `updated: true` 不代表真的更新了。

### 3.2 INSTANCE_SWAP 创建但未绑定
**现象**: `add_component_prop({type: "INSTANCE_SWAP", bind: childInstanceId})` → 属性创建但 "No matching child found to bind"
**根因**: `compHandlers.ts` 只有 TEXT 和 BOOLEAN 的 binding 分支，缺 INSTANCE_SWAP
**修复**: 加 `mainComponent` componentPropertyReferences 绑定
**教训**: 3 种 prop type 要完整覆盖。测试时只测了 TEXT 就以为全部 OK。

### 3.3 ComponentSet prop 只绑定了一个 variant 的子节点
**现象**: `add_component_prop` 在 Button ComponentSet 上加 Label prop，只有 Primary variant 的 Label 绑定了
**根因**: handler 用 `resolvePathToNode` 找子节点，只匹配到第一个 variant 里的
**绕过**: 用 js 手动给其他 variant 设 `componentPropertyReferences`
**未修复**: handler 应该遍历 ComponentSet 的所有 variant 并绑定同名子节点

## 4. Instance 创建

### 4.1 所有 instance 命名为 "instance"
**现象**: 层面板里 30+ 个节点全叫 "instance"
**根因**: `templateCompiler.ts` line 326 `instanceProps.name = name` 把 Figma 默认的组件名覆盖为 `"instance"`（nodeType fallback）
**修复**: 删除该行，让 Figma `createInstance()` 的默认命名保留
**教训**: Figma API 的默认行为（实例名=组件名）比手动设置更合理

### 4.2 `<instance ref>` 不应用 component prop overrides — 有意设计
**现象**: `<instance ref="Button" Label="Email"/>` → Label 仍显示默认值
**根因**: jsx 在 tree walk 创建过程中不 resolve component property display names
**正确做法**: `jsx` 建结构 → `edit` 填内容
```
jsx({markup: `<instance ref="Button"/>`})           // 结构
edit({node: instanceId, props: {Label: "Email"}})    // 内容
```
**设计决策**: 不在 jsx 里加 component prop 解析。原因：
1. component props 需要异步读取（创建后才有 componentProperties），会增加 templateCompiler 复杂度
2. editHandler 已有 splitComponentProps → resolveInstanceProps 完整逻辑，不应在 jsx 里重复
3. jsx 已有 3 种 instance 特殊语法（ref / variant / `__set_X`），第 4 种增加维护负担
4. 一个 edit 批量改 N 个 instance 比 N 个 jsx 内联属性更高效
**结论**: jsx 管结构，edit 管内容——关注点分离。不是 bug，是设计边界。

### 4.3 Instance 内创建 instance 有时失败
**现象**: 第二次创建 `<component>` 内含 `<instance ref="..."/>` 时 instance 没出现
**表现**: jsx 返回 `created: 3` 而非 `created: 4`，instance 静默消失
**未查根因**: 不稳定复现。可能是组件注册表 timing 问题。

## 5. 批量操作副作用

### 5.1 全局清除 #000000 strokes 误删了有意边框
**现象**: 8 张 card 失去 border
**根因**: instance 有 stroke override（从 source 继承的 #E2E8F0 被 Figma 显示为 #000000 或其他原因），我的 `n.strokes = []` 创建了 empty override
**修复**: 重新绑定 border variable 到每个 instance
**教训**: 批量 `findAll → modify` 必须有 before/after diff。影响范围不可预测。

### 5.2 全局 #FFFFFF → bg binding 污染 Icon frame
**现象**: Icon frames（本应透明）被加上白色 fill → 遮住内部 vector
**根因**: 全局扫描匹配了所有 #FFFFFF fill，包括不应该有 fill 的容器
**修复**: 手动清除 Icon frame fills
**教训**: 全局颜色绑定需要排除列表（透明容器、icon frames、已绑定节点）

### 5.3 Icon vector stroke 丢失
**现象**: 3 个 feature icon 显示为空方块
**根因**: 清除 #000000 strokes 时把 icon vector 的 stroke 也清了（vector stroke 可能恰好是 #000000 或被 instance override 影响）
**修复**: 用 js 重新绑定 vector strokes 到 accent color variables
**教训**: `findAll → clear` 不区分节点类型，Vector 的 stroke 是它的"身体"而非装饰

## 6. 工具设计缺陷

### 6.1 describe 不报颜色、不报对齐偏移
**覆盖**: layout gaps, padding, wrap, overflow, text contrast, SPACE_BETWEEN child count
**不覆盖**: unbound colors, default stroke #000000, wasted space (MIN with extra room), instance naming
**影响**: 以为 describe 通过 = 设计合格，实际有大量遗漏

### 6.2 inspect 输出巨大
**现象**: 大 frame 的 `inspect({mode: "detail"})` 返回 300K+ 字符，超 token limit
**绕过**: 用 `depth` 参数限制深度，或只 inspect 子区块
**影响**: 无法一次看全页状态

### 6.3 无法导出截图到磁盘
**现象**: inspect 的 screenshot 只在对话中显示，无法保存为文件给子 agent 审查
**影响**: 无法用 parallel agents 做 per-section 视觉审查
**绕过**: 只能自己看截图并人工判断

### 6.4 `set_stroke` 不传播到 Vector 子节点
**现象**: `set_stroke` 在 Icon frame 上设 stroke → frame 获得 border，但内部 Vector 不变
**预期**: icon 类型的 stroke 应该传播到 vector（因为 vector 的视觉表达就是 stroke）
**绕过**: 用 js 直接设 vector 的 strokes

## 7. 模式系统

### 7.1 Mode 切换的 spacing 响应 ≠ layout 响应
**现象**: Desktop→Mobile 切换 spacing 变小了，但 3-column grid 不会变 1-column
**根因**: Figma variables 只能控制数值属性（padding/gap/fontSize），不能控制 layoutMode（row→column）
**绕过**: 用 `wrap: "wrap"` 让 cards 自动换行。但这是 workaround 不是 responsive。
**现实**: 真正的响应式需要不同断点的 variant（如 Desktop/Mobile section variants），不是纯靠 variable modes

### 7.2 Stats primaryAxisAlignItems 被静默覆盖
**现象**: jsx 写了 `justify="space-between"` 但实际变成 MIN
**根因**: 无法 100% 复现。代码路径正确（expandShorthands → SPACE_BETWEEN）。怀疑是后续某次操作的副作用覆盖了。
**修复**: 用 js 直接设 `primaryAxisAlignItems = 'SPACE_BETWEEN'`
**教训**: layout alignment 是"脆弱属性"——任何触发 Figma layout recalculation 的操作都可能重置它

## 总结: 行得通 vs 行不通

### 行得通的方法思路
1. **先建 variable → 再建 component → 最后组装** — 避免回头补 binding
2. **`$var` inline 语法**（修复后）— 一次 jsx 完成所有 binding
3. **`edit({props: {PropName: value}})` 批量覆盖** — 39 个 instance 一次搞定
4. **js() 做精确操作** — setBoundVariableForPaint, setProperties, findAllWithCriteria
5. **describe + 手动 audit 互补** — describe 查 layout, 手动 scan 查 color/stroke/alignment
6. **setExplicitVariableModeForCollection** 一键切换 theme/breakpoint

### 行不通的方法思路
1. **全局 `findAll → modify`** — 副作用不可控（误删 border, 误加 fill, 清 vector stroke）
2. **信任 `edit` 返回值** — `updated: true` 不代表真的改了（normalizeProps 静默吞）
3. **靠 screenshot 目视检查 1px 属性** — 黑 stroke vs border 看不出
4. **一次 jsx 创建 instance 带 props** — `<instance ref="X" Label="Y"/>` 不生效
5. **只设 source component 期望 instance 继承** — override 优先级高于 source
6. **全局颜色 binding 不加白名单** — 透明 frame 被误绑
7. **以为 describe 通过 = 审计完成** — 颜色/stroke/alignment 不在 lint 范围
