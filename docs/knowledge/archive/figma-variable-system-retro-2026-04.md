# Figma Variable System — 全量构建复盘 (2026-04)

> 任务：从零构建双层 variable 体系（primitive → semantic）+ 10 个 section 三断点响应式 + 12 种 mode 组合完整 landing page  
> 工具：HTTP Bridge + genable 工具集 + js 工具执行原生 Figma Plugin API  
> 结果：全部 12 种组合（2 theme × 2 lang × 3 breakpoint）验证通过

---

## 一、核心心得

### 1. alias_variable 不支持 per-mode，是两层体系最大的工具缺口

`alias_variable` 工具对源变量的所有 mode 设同一个 alias。但语义层的核心价值是：
- Light mode → alias gray-50
- Dark mode → alias gray-900

这要求每个 mode 指向不同的原始变量。工具目前做不到，必须绕到 `js` 工具调用 `setValueForMode` + `createVariableAlias`。

**建议**：给 `alias_variable` 工具加 `mode` 参数：
```
alias_variable({ variable: "LP-Theme/bg", target: "LP/Prim/Color/white", mode: "Light" })
alias_variable({ variable: "LP-Theme/bg", target: "LP/Prim/Color/gray/900", mode: "Dark" })
```

### 2. 绑定后属性值被覆盖，原始值永久丢失

Figma 中，一旦对属性绑定变量，`node.paddingTop` 返回的是**当前 mode 下的变量解析值**，不是绑定前的原始值。

```
原始值 64 → 错误绑定到 2xl（Desktop=48）→ node.paddingTop 变成 48
重新读取 → 48 → 错误地匹配到 xl（Tablet=40）→ 仍然错
```

绑定一旦错误，没有 undo 机制。只能**硬绑**（直接指定目标变量，不经过 nearest() 匹配）。

### 3. Token 匹配必须 mode-aware

对 Tablet 组件的 padding 做 token 匹配，应该匹配 **Tablet mode 下的 token 值**，而不是 Desktop 值。

```
Tablet Hero paddingTop = 64
LP-Spacing 3xl: Desktop=80, Tablet=64, Mobile=40

错误做法：nearest(64, desktopMap) → 2xl(Desktop=48, diff=16) vs 3xl(Desktop=80, diff=16) → 任意选一个，大概率错
正确做法：nearest(64, tabletMap) → 3xl(Tablet=64, diff=0) → 精确匹配 ✓
```

**规则**：variant 名称包含 "Tablet"/"Mobile" → 用对应 mode 的 token 值做匹配。

---

## 二、盲区清单

| 盲区 | 触发场景 | 后果 |
|------|---------|------|
| section 默认无背景 fill | 透明 + 亮色 canvas = 正常显示，但暗色主题失效 | Tablet/Mobile 主题切换无效 |
| grid 改 column 后自身仍 w=hug | 仅改了内部卡片为 fill | 卡片无法扩展宽度 |
| LP-Lang 缺人名、定价细节 | mass binding 前未 audit 内容完整性 | 19 节点未绑定 |
| LP-Type scale 与设计稿不对齐 | h2 设计了 36px 但设计稿是 32px | 绑定后 h2 视觉突变 |
| 同一语义节点在不同 variant 里字号不同 | Mobile H1=36 匹配 h2(Desktop=36)，Desktop H1=64 匹配 display | 跨 variant 绑到不同 token，语义断裂 |
| `getLocalVariableCollections` 须 Async | 习惯同步 API | 报错，需 retry |
| mode 对象 JSON 序列化 | return 含 mode array | `[object Object]`，需手动 `JSON.stringify` |
| `setExplicitVariableModeForCollection` 传 ID | 应传 collection 对象 | 报错，需 retry |
| 克隆后 component 值已被模式覆盖 | 读克隆节点属性做二次绑定 | 读到的是错误 mode 下的值 |

---

## 三、错误频次与重试深度

| 错误 | 次数 | 重试 | 解法 |
|------|------|------|------|
| Figma API 未加 Async 后缀 | 3 | 各 1 次 | 加 `Async` |
| mode 对象序列化 | 2 | 各 1 次 | `JSON.stringify` |
| `setExplicitVariableModeForCollection` 传 ID | 1 | 1 次 | 改传对象 |
| **spacing mode-aware 绑定** | **1（关键错误）** | **3 轮** | auto → re-bind 读污染值 → 最终硬绑 |
| `create_instance` 参数名错误 | 1 | 1 次 | 查 schema，`component` → `node` |
| section 背景 fill 缺失 | 1 | 0 次 | js 批量补 fill |
| FGrid/PGrid w=hug | 1 | 0 次 | 专项修复 25 节点 |

**最高代价错误**：spacing 绑定跑了 3 轮（第 2 轮读到值已被第 1 轮污染，仍错）。根因是没有在绑定前做 dry-run 验证映射。

---

## 四、Figma Plugin API 必须用 Async 的 API 清单

```js
// 以下全部必须加 Async，否则报错
figma.variables.getLocalVariableCollectionsAsync()
figma.variables.getLocalVariablesAsync()
figma.variables.getVariableByIdAsync(id)
node.getMainComponentAsync()
figma.getNodeByIdAsync(id)
```

另：返回 mode 数组时，必须手动序列化：
```js
// 错误：直接 return modes 数组
return collection.modes  // → "[object Object]"

// 正确：手动 map
return JSON.stringify(collection.modes.map(m => ({ name: m.name, id: m.modeId })))
```

---

## 五、可改进的 Lint 规则

```
❌ Section component 有 padding > 0 但无 LP-Spacing binding
❌ TEXT 节点 fills[0] 无 boundVariables.color（主题切换无响应）
❌ LP-v4/Section/* variant 数量 != 3（缺 Desktop/Tablet/Mobile 之一）
❌ FRAME 在 auto-layout 父容器内 layoutSizingHorizontal = "HUG"
❌ Component set 含 variant "Breakpoint=X" 但 width 与标准不符（Desktop≠1440 等）
❌ Section component 无 background fill（主题切换在暗色下透明）
❌ TEXT 节点有 characters 但无 LP-Lang binding（语言切换无响应）
```

---

## 六、Hook 建议

### pre-binding hook（mass bind 前）
```
dry-run 模式：打印 "node X / prop Y / value Z → token T (mode_value M)"
自动校验：|mode_value M - Z| / Z < 0.2 → 匹配可信
超出容差 → warn + 暂停，不自动执行
```

### post-clone hook（clone_node 后）
```
检查：
1. 克隆节点是否成为 component set 的 component 子节点
2. width 是否已设为目标断点值
3. variant name 是否符合 "Breakpoint=X" 格式
```

### post-js hook（js 工具修改 > 100 节点后）
```
自动采样验证：读前 5 个修改节点的关键属性 → 与预期对比
不匹配 → warn（不回滚，让人工决策）
```

---

## 七、流程建议

### 当前流程的问题
```
设计 token scale → 编辑 Tablet 节点（设具体值）→ mass bind → 发现值被覆盖 → 反复修
```

### 建议流程
```
① 先从设计稿提取所有实际字号/间距值
② 设计 token scale 完全覆盖这些值（不能有 gap）
③ 克隆 variant 后不要手动编辑值，直接 bind 到目标 token
   → token 的 mode 值自动给出正确间距，不需要手动设
④ bind 前 dry-run，确认 mapping 正确
⑤ bind 后立即读验证（不信任"应该 OK"）
```

### 最重要的一条
**Token 设计 → 组件设计 → 绑定** 是单向流，不能在已绑定后改 token scale，会导致级联污染。

---

## 八、本次量化结果

| 类型 | 数量 |
|------|------|
| 原始变量（LP collection） | 78 |
| 语义变量 per-mode alias | 11 COLOR + 8 FLOAT×3 + 8 FLOAT×3 + 5 FLOAT |
| 新增 LP-Lang 变量 | 11 |
| section component 新增 Tablet variant | 10 |
| 文字内容绑定（characters → LP-Lang） | 304 |
| 颜色绑定（fills/strokes → LP-Theme） | 429 |
| 字号绑定（fontSize → LP-Type） | 306 |
| 间距绑定（padding/gap → LP-Spacing） | 648 |
| 布局修复（w=hug → fill） | 25 |
| 验证通过的 mode 组合 | 12/12 |
