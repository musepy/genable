# Component Set Recreation: Lessons Learned

## Context
Replicate a Figma design system section (Button, Icon Button, Button Danger, Button Group) using the plugin MCP's `design` tool. Two iterations — first attempt failed on structure/properties/layout, second attempt succeeded with the new `setProperty` feature.

## Final Results (Second Attempt)

| ComponentSet | Variants | Dimensions | Properties | Match Quality |
|---|---|---|---|---|
| Button | 18 (3×3×2) | 345×456 (exact) | Label, Has Icon Start, Has Icon End + 3 variant | Grid, colors, hidden icon frames all correct |
| Icon Button | 18 (3×3×2) | 290×480 (vs 456) | 3 variant | Grid correct, height +24px (gap diff) |
| Button Danger | 12 (2×3×2) | 291×174 (vs 182) | Label + 2 variant | Grid correct, height -8px (lineHeight diff) |
| Button Group | 5 | 280×552 (exact) | 1 variant | Alignment behaviors all correct |

## Difficulties Encountered & Solutions

### 1. `setProperty` 目标节点类型：必须指向 ComponentSet

**问题**: 用个体 ComponentNode ID 调 `setProperty` 始终失败（"3 failed"），无详细错误信息。

**排查过程**: 检查了 flatOpsParser 解析 → compileLine 编译 → executor 执行全链路，逐一排除。最终发现换成 ComponentSetNode ID 立刻成功。

**结论**: `addComponentProperty()` 应该在 ComponentSet 上调用，不是单个 Component 变体。虽然 Figma API 文档说两者都支持，但实际行为可能因上下文不同。

**改进方向**: executor 的 `componentProperty` case 可以自动检测——如果 target 是 ComponentSet 内的 Component，自动上溯到 ComponentSet。

### 2. Subtle 变体的"无填充"：`fill:'none'` 是正确方式

**问题**: clone 从 Primary（有 fill）创建 Subtle（无 fill）变体时，需要清除继承的 fills。`fills:[]` 无法在 flat ops 格式中表达（`findKeySep` 不识别 `[` 开头的值）。

**排查**: 追踪 `parsePropsBlock` → `findKeySep` → `paintSpec.parseXml`，发现 `parseXml('none')` 和 `parseXml('transparent')` 返回 `[]`。

**解决**: `fill:'none'` → `paintSpec.parseXml('none')` → `[]` → `node.fills = []` ✓

### 3. `layoutWrap: 'WRAP'` 不随 variantSet 生效

**问题**: `variantSet(root, {..., wrap:true})` 创建后，变体仍然排成一行不换行。

**原因**: variantSet 命令的 `wrap:true` 可能没有正确传递到 `combineAsVariants()` 后的 ComponentSet 节点。需要额外 `update()` 手动设置。

**临时方案**: 每次 variantSet 后追加：
```
update(setId, {layoutWrap:'WRAP', counterAxisSpacing:N, p:20, sizingV:'hug'})
```

**改进方向**: 修改 executor 的 `createComponentSet` case，在 `combineAsVariants()` 后自动应用 wrap/gap/padding props。

### 4. 无符号 text 节点创建失败

**问题**: `text(parent, {...}, 'Button')` 不带符号赋值时，4 个 text 节点全部失败。

**原因**: `parseLine` 的 bare function call 分支对 `text(...)` 的处理不完整。只有 `delete()` 和 `update()` 支持无符号调用。

**解决**: 所有 create 操作必须用 `sym = type(parent, ...)` 格式。

**改进方向**: 在 `parseLine` 中增加 bare `text()`/`frame()`/`icon()` 的处理，自动生成匿名符号。

### 5. CSS 枚举值 vs Figma 枚举值

**问题**: `alignMain:'flex-end'` 被验证器拒绝。

**原因**: Figma 用 `MIN`/`CENTER`/`MAX`/`SPACE_BETWEEN`，不用 CSS 的 `flex-start`/`flex-end`。

**解决**: 改用 `primaryAxisAlignItems:'MAX'`。

**改进方向**: 在 `normalizeProps` 或 `coerceValue` 中增加 CSS→Figma 枚举映射（`flex-end`→`MAX`, `flex-start`→`MIN`, `space-between`→`SPACE_BETWEEN`）。

### 6. 跨批次符号解析不稳定

**问题**: `variantSet(root, {from:'bgJ,bgS,...'})` 用符号引用之前批次创建的组件时失败。

**背景**: `componentRegistry` 是模块级 Map，跨批次持久化。`createComponent` 和 clone 都会注册符号。executor 的 `createComponentSet` 有 `componentRegistry.get(compId)` 回退。

**但实际失败了**: 用真实 Figma ID 替换符号后成功。

**排查假说**: 可能是 variantSet 在编译阶段（`compileLine`）就把符号当作原始字符串传递，executor 的 resolveId chain 没有命中 componentRegistry。需要进一步 debug。

**改进方向**: 在 `compileLine` 的 `variantSet` case 中，对 componentIds 做预解析（先查 componentRegistry），或在 executor 中增加 fallback 日志。

## 正确工作流（已验证）

```
Step 1: 创建完整基础变体（含隐藏 icon frames）
  base = frame(root, {reusable:true, ...})
  iconStart = frame(base, {name:'IconStart', visible:false, ...})
  star = icon(iconStart, {icon:'lucide:star', ...})
  label = text(base, {name:'Label', ...}, 'Button')
  iconEnd = frame(base, {name:'IconEnd', visible:false, ...})
  x = icon(iconEnd, {icon:'lucide:x', ...})

Step 2: clone 所有变体（cascading overrides）
  phm = clone(base, root, {name:'Variant=Primary, State=Hover, Size=Medium', fill:'#1E1E1E'})
  sdm = clone(base, root, {name:'Variant=Subtle, State=Default, Size=Medium', fill:'none', stroke:'none', Label.fill:'#303030'})
  pds = clone(base, root, {name:'Variant=Primary, State=Default, Size=Small', p:8})

Step 3: variantSet + 手动修复布局
  btnSet = variantSet(root, {name:'Button', from:'base,phm,...', layout:'row', wrap:true, gap:40, w:345})
  update(btnSet, {layoutWrap:'WRAP', counterAxisSpacing:40, p:20, sizingV:'hug'})

Step 4: setProperty（必须用 ComponentSet 的真实 ID）
  setProperty('COMPONENT_SET_ID', {name:'Label', type:'text', target:'TEXT_NODE_ID', default:'Button'})
  setProperty('COMPONENT_SET_ID', {name:'Has Icon Start', type:'bool', target:'ICON_START_FRAME_ID', default:false})
```

## 待改进清单（下次迭代目标）

### P0 — 阻塞性问题
| # | 问题 | 影响 | 改进方案 |
|---|------|------|----------|
| 1 | variantSet 后 wrap/gap/padding 不生效 | 每次都需要额外 update 调用 | executor `createComponentSet` 自动应用 props |
| 2 | 无符号 create 操作静默失败 | 容易被忽略，排查困难 | parseLine 支持 bare `text()`/`frame()` 调用 |
| 3 | setProperty 错误信息缺失 | "3 failed" 无法定位原因 | receipt 中附带每个 op 的具体错误 |

### P1 — 易用性改进
| # | 问题 | 改进方案 |
|---|------|----------|
| 4 | CSS 枚举值被拒绝 | normalizeProps 增加 `flex-end`→`MAX` 等映射 |
| 5 | `fills:[]` 无法在 flat ops 中表达 | findKeySep 增加 `[` 识别，或 parsePropsBlock 支持数组值 |
| 6 | setProperty 必须手动传 ComponentSet ID | executor 自动上溯 Component → ComponentSet |
| 7 | 跨批次符号解析不稳定 | 增加 componentRegistry 查询日志，修复 variantSet 符号解析 |

### P2 — 功能缺失
| # | 功能 | 说明 |
|---|------|------|
| 8 | INSTANCE_SWAP 属性绑定 | 需要 icon 节点转为 InstanceNode，或支持从 ComponentKey 创建实例 |
| 9 | 跨 ComponentSet 实例引用 | Button Group 的子按钮应该是 Button 实例而非 styled frame |
| 10 | leading 默认值差异 | 显式 `leading:'100%'` 导致与 Figma 默认行高不一致（14px vs 17px for 14pt font） |

## Design Token Reference

### Button Colors
| Variant | State | Fill | Stroke | Text |
|---------|-------|------|--------|------|
| Primary | Default | #2C2C2C | #2C2C2C | #F5F5F5 |
| Primary | Hover | #1E1E1E | #2C2C2C | #F5F5F5 |
| Primary | Disabled | #D9D9D9 | #B3B3B3 | #B3B3B3 |
| Neutral | Default | #E3E3E3 | #767676 | #1E1E1E |
| Neutral | Hover | #CDCDCD | #767676 | #1E1E1E |
| Neutral | Disabled | #D9D9D9 | #B3B3B3 | #B3B3B3 |
| Subtle | Default | — (none) | — (none) | #303030 |
| Subtle | Hover | — (none) | #D9D9D9 | #1E1E1E |
| Subtle | Disabled | #D9D9D9 | #B3B3B3 | #B3B3B3 |

### Button Danger Colors
| Variant | State | Fill | Text |
|---------|-------|------|------|
| Primary | Default | #EF4444 | #FFFFFF |
| Primary | Hover | #DC2626 | #FFFFFF |
| Primary | Disabled | #FCA5A5 | #9CA3AF |
| Subtle | Default | #FEE2E2 | #EF4444 |
| Subtle | Hover | #FECACA | #EF4444 |
| Subtle | Disabled | #FEE2E2 | #D1D5DB |

### Common Specs
| Property | Button | Icon Button | Button Danger |
|----------|--------|-------------|---------------|
| Font | Inter Regular 16px | — | Inter Medium 14px |
| Corner | 8px | 32px | 6px |
| Medium padding | 12px | 12px | 8px vert, 16px horiz |
| Small padding | 8px | 8px | 4px vert, 12px horiz |
| Gap (internal) | 8px | — | — |
| Stroke | 1px | 1px | none |

### Button Group Specs
- Container: w:240, gap:16
- Justify: layout:row, children sizingH:fill
- Start: layout:row, children sizingH:hug
- End: layout:row, primaryAxisAlignItems:MAX, children sizingH:hug
- Center: layout:row, primaryAxisAlignItems:CENTER, children sizingH:hug
- Stack: layout:column, children sizingH:fill
- ComponentSet: w:280, gap:64, p:20, sizingV:hug
