# Design Audit Methodology

> 从 LP-v4 session 提炼。补充 `describe` lint 无法覆盖的 4 个审查维度。

## 何时触发

- jsx 创建后（describe 只查 layout，不查颜色/变量覆盖）
- 批量 edit/js 修改后（每次 findAll→modify 都是 regression 风险）
- mode 切换验证后（Dark/Mobile 可能暴露新问题）
- 用户反馈"看起来不对"时

## Audit 1: 颜色变量覆盖率

### 问题
所有参与 theme 切换的颜色必须绑定到 variable。硬编码颜色在 Dark mode 不会响应。

### 方法
```js
js({code: `
const root = await figma.getNodeByIdAsync('ROOT_ID');
const found = new Map();
function scan(node) {
  if ('fills' in node && Array.isArray(node.fills)) {
    const bounds = node.boundVariables?.fills || [];
    node.fills.forEach((p, i) => {
      if (p.type !== 'SOLID' || bounds[i]) return;
      const hex = '#' + [p.color.r, p.color.g, p.color.b]
        .map(c => Math.round(c*255).toString(16).padStart(2,'0').toUpperCase()).join('');
      found.set(hex, (found.get(hex) || 0) + 1);
    });
  }
  // 同理 strokes
  if ('children' in node) for (const c of node.children) scan(c);
}
scan(root);
return Object.fromEntries(found);
`})
```

### 判断标准
- 0 个未绑定颜色 = 通过
- 仅剩 iconic 颜色（macOS dots #EF4444/#F59E0B/#10B981、gold stars #FBBF24）= 可接受
- 其他硬编码 = 需要创建 variable 并绑定

### 常见陷阱
- Figma `strokeWeight > 0` 但 `strokes = []` 时**静默渲染 #000000**
- 全局 #FFFFFF 绑定会误伤 Icon frame（应该透明的容器）
- Instance override `strokes = []` 不继承 source 的 binding

## Audit 2: 默认 Stroke Bug

### 问题
Figma API quirk：设了 strokeWeight 但没显式设 strokes 时，渲染为 1px #000000。

### 方法
```js
js({code: `
const root = await figma.getNodeByIdAsync('ROOT_ID');
const bugs = root.findAll(n => {
  if (!('strokes' in n) || !('strokeWeight' in n)) return false;
  return n.strokeWeight > 0 && (!n.strokes || n.strokes.length === 0);
});
return bugs.map(n => ({id: n.id, name: n.name, weight: n.strokeWeight}));
`})
```

### 修复方式
两选一：
- 清除 strokeWeight：`edit({node: id, props: {strokeWeight: 0}})`
- 设置正确 stroke：`set_stroke({node: id, stroke: "$LP-Theme/border"})`

## Audit 3: 布局对齐一致性

### 问题
`primaryAxisAlignItems` 可能被 Figma 静默重置为 MIN（设置 layoutMode 时），或被操作副作用覆盖。

### 方法
```js
js({code: `
const root = await figma.getNodeByIdAsync('ROOT_ID');
const issues = [];
function scan(node) {
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const isFixed = node.primaryAxisSizingMode === 'FIXED' ||
                    node.layoutSizingHorizontal === 'FILL' ||
                    node.layoutSizingHorizontal === 'FIXED';
    if (isFixed && node.primaryAxisAlignItems === 'MIN' && node.children.length >= 2) {
      const isH = node.layoutMode === 'HORIZONTAL';
      const contentSize = node.children.reduce((s, c) => s + (isH ? c.width : c.height), 0);
      const totalGap = (node.itemSpacing || 0) * (node.children.length - 1);
      const padding = isH
        ? (node.paddingLeft || 0) + (node.paddingRight || 0)
        : (node.paddingTop || 0) + (node.paddingBottom || 0);
      const available = (isH ? node.width : node.height) - padding;
      const wasted = available - contentSize - totalGap;
      if (wasted > 50) {
        issues.push({
          id: node.id, name: node.name,
          align: 'MIN', wasted: Math.round(wasted),
          hint: 'Consider SPACE_BETWEEN or CENTER'
        });
      }
    }
  }
  if ('children' in node) for (const c of node.children) scan(c);
}
scan(root);
return issues;
`})
```

### 判断标准
- wasted > 50px 且 align=MIN = 可能错误（应该是 SPACE_BETWEEN 或 CENTER）
- wasted < 50px = 正常间距
- align=SPACE_BETWEEN 或 CENTER = 合理

## Audit 4: Instance Override 漂移

### 问题
Instance 的 stroke/fill 被清空覆盖后不再继承 source。后续对 source 的修改不传播。

### 方法
```js
js({code: `
const root = await figma.getNodeByIdAsync('ROOT_ID');
const drifts = [];
const instances = root.findAllWithCriteria({types: ['INSTANCE']});
for (const inst of instances) {
  // Check if strokes are overridden to empty
  if (inst.strokes.length === 0 && inst.strokeWeight > 0) {
    drifts.push({id: inst.id, name: inst.name, issue: 'empty stroke override'});
  }
  // Check if fills differ from main component when no variable binding
  const boundFills = inst.boundVariables?.fills || [];
  if (inst.fills.length > 0 && boundFills.length === 0) {
    const main = await inst.getMainComponentAsync();
    if (main && main.fills.length > 0) {
      const mainBound = main.boundVariables?.fills || [];
      if (mainBound.length > 0) {
        drifts.push({id: inst.id, name: inst.name, issue: 'fill not bound but source is'});
      }
    }
  }
}
return drifts;
`})
```

## 执行顺序

```
jsx() 创建
  ↓
describe() — 现有 layout lint
  ↓
Audit 2 — 默认 stroke bug（最快，最常见）
  ↓
Audit 1 — 颜色变量覆盖率（创建后、theme 切换前）
  ↓
mode 切换 + inspect/screenshot 验证
  ↓
Audit 3 — 布局对齐一致性（visual 验证后）
  ↓
批量修改后
  ↓
Audit 4 — instance override 漂移（修改影响了 instances 时）
  ↓
Audit 1 再跑一遍（确认修改没引入新的未绑定颜色）
```

## Audit 5: Instance 命名

### 问题
`<instance ref="X"/>` 创建的实例默认名 "instance"。30+ 个 "instance" 在层面板里无法分辨。

### 方法
```js
js({code: `
const root = await figma.getNodeByIdAsync('ROOT_ID');
const unnamed = [];
function scan(node) {
  if (node.type === 'INSTANCE' && node.name === 'instance') {
    // 推导建议名: component名 + 区分内容
    const main = node.mainComponent;
    const label = main ? main.name.split('/').pop() : 'Unknown';
    // 尝试从 TEXT 子节点取内容做区分
    const textChild = node.findOne(n => n.type === 'TEXT');
    const content = textChild ? textChild.characters.slice(0, 20) : '';
    unnamed.push({
      id: node.id,
      component: label,
      suggestedName: content ? label + ': ' + content : label
    });
  }
  if ('children' in node) for (const c of node.children) scan(c);
}
scan(root);
return unnamed;
`})
```

### 修复
```
edit({nodes: [
  {node: "id1", props: {name: "Nav: Product"}},
  {node: "id2", props: {name: "Nav: Pricing"}},
  {node: "id3", props: {name: "CTA: Start Free"}},
  ...
]})
```

### 命名规则
- `{Section}: {Content}`
- NavItem: "Nav: Product", "Nav: Pricing", "Nav: Docs"
- Button: "CTA: Start Free", "CTA: Watch Demo"
- FeatureCard: "Feature: Lightning Fast", "Feature: Enterprise Ready"
- PricingCard: "Pricing: Starter", "Pricing: Pro", "Pricing: Enterprise"
- TestimonialCard: "Testimonial: Sarah Chen", "Testimonial: Marcus Kim"
- FooterCol: "Footer: Product", "Footer: Company"

## 与 describe 的关系

describe 覆盖:
- layout 结构（gap、padding、wrap）
- text 对比度（WCAG）
- overflow 检测
- button padding
- SPACE_BETWEEN + children < 2

describe 不覆盖（本文档补充）:
- 颜色变量覆盖率
- 默认 stroke #000000 bug
- 空间浪费 / 对齐偏移
- instance override 漂移
