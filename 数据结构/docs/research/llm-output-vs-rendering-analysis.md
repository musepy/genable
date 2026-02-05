# LLM 输出 vs 实际渲染差异分析

> **分析日期**: 2025-01-22  
> **Figma 文件**: [genable-test](https://www.figma.com/design/0w0tfKhvZ7witj6tduzSCq/genable-test?node-id=455-5698)  
> **节点 ID**: 455-5698

---

## 📋 概述

分析 LLM 输出的 JSON 数据结构与实际在 Figma 中渲染结果的差异，识别未处理的属性和渲染问题。

---

## 🔍 关键发现

### 1. 未处理的属性：`primaryAxisSizingMode` 和 `counterAxisSizingMode`

**LLM 输出**：
```json
{
  "type": "FRAME",
  "props": {
    "primaryAxisSizingMode": "FIXED",
    "counterAxisSizingMode": "FIXED",
    "layoutSizingHorizontal": "FIXED",
    "layoutSizingVertical": "FIXED"
  }
}
```

**原始设计意图**：

这些属性原本是为**分布式生成模型（Distributed Generator）**设计的：

1. **多阶段生成流程**：
   - `REQUIREMENT` → `STRUCTURE` → `LAYOUT` → `STYLE` → `GENERATE`
   - 在 `LAYOUT` 阶段，LLM 输出布局信息，包括这些属性
   - 定义在 `distributed/types.ts` 的 `LayoutData` 接口中

2. **语义化表示**：
   - `primaryAxisSizingMode`：主轴（primary axis）的尺寸模式
     - 如果 `layoutMode: "VERTICAL"`，主轴是垂直方向
     - 如果 `layoutMode: "HORIZONTAL"`，主轴是水平方向
   - `counterAxisSizingMode`：交叉轴（counter axis）的尺寸模式
     - 与主轴垂直的方向

3. **布局计算器的输出**：
   - 在 `layoutCalculator.ts` 中，当节点有子节点且高度为 null（HUG 模式）时：
     ```typescript
     if (h === null && hasChildren) {
       if (input.layout === 'VERTICAL') {
         result.primaryAxisSizingMode = 'AUTO';  // 垂直主轴 = AUTO
       } else if (input.layout === 'HORIZONTAL') {
         result.counterAxisSizingMode = 'AUTO';  // 水平主轴时，交叉轴 = AUTO
       }
     }
     ```

**问题分析**：
- ❌ **Figma API 不支持这些属性**
  - Figma 使用固定的 `layoutSizingHorizontal` 和 `layoutSizingVertical`
  - 不区分主轴/交叉轴，而是固定使用水平/垂直方向
- ❌ **渲染器未实现转换逻辑**
  - 需要根据 `layoutMode` 将 `primaryAxisSizingMode` 转换为 `layoutSizingHorizontal` 或 `layoutSizingVertical`
  - 但当前渲染器直接使用 `layoutSizingHorizontal/Vertical`
- ✅ `layoutSizingHorizontal` 和 `layoutSizingVertical` 被正确处理

**影响**：
- 这些属性被 LLM 输出但被忽略，不会影响渲染
- 可能造成 LLM 的困惑（输出了但没效果）
- 如果实现转换逻辑，可以支持更语义化的布局描述

**解决方案**：
1. **方案 A（推荐）**：在 prompt 中明确禁止 LLM 输出这些属性
2. **方案 B**：在 schema 中移除这些属性（如果它们不应该存在）
3. **方案 C**：如果这些属性有意义，实现处理逻辑

---

### 2. 颜色值处理 ✅

**LLM 输出**：
```json
{
  "fills": ["#FFFFFF"],
  "strokes": ["#E4E4E7"]
}
```

**实际渲染**：
- ✅ 颜色值被正确解析和应用
- ✅ 所有颜色都是具体值（不再是 token 引用）
- ✅ 符合研究结论：直接使用具体值

**状态**：**正常工作**

---

### 3. Switch 组件的布局问题

**LLM 输出**：
```json
{
  "type": "FRAME",
  "props": {
    "name": "Switch",
    "width": 44,
    "height": 24,
    "layoutMode": "HORIZONTAL",
    "paddingLeft": 24,  // 第一个 Switch（开启状态）
    "paddingRight": 4,
    "paddingLeft": 4,   // 第二个 Switch（关闭状态）
    "paddingRight": 4
  }
}
```

**实际渲染观察**：
- Switch 的 knob 位置通过 `paddingLeft` 控制
- 开启状态：`paddingLeft: 24`（knob 在右侧）
- 关闭状态：`paddingLeft: 4`（knob 在左侧）

**潜在问题**：
- Switch 的语义应该通过 `semantic: "SWITCH"` 和 `variant` 来表示状态
- 当前使用 padding 来控制位置是可行的，但不够语义化

**建议**：
- 考虑添加 `variant: "on" | "off"` 属性
- 或者通过 PostProcessor 自动处理 Switch 状态

---

### 4. Divider 的实现

**LLM 输出**：
```json
{
  "type": "FRAME",
  "props": {
    "name": "Divider",
    "height": 1,
    "fills": ["#E4E4E7"],
    "semantic": "DIVIDER"
  }
}
```

**实际渲染**：
- ✅ Divider 被正确渲染为 1px 高的 Frame
- ✅ 颜色正确应用

**状态**：**正常工作**

---

### 5. 按钮布局对齐

**LLM 输出**：
```json
{
  "type": "FRAME",
  "props": {
    "name": "Footer",
    "primaryAxisAlignItems": "MAX",  // 右对齐
    "layoutMode": "HORIZONTAL"
  }
}
```

**实际渲染**：
- ✅ 按钮正确右对齐
- ✅ `primaryAxisAlignItems: "MAX"` 被正确处理

**状态**：**正常工作**

---

## 📊 差异总结表

| 属性/功能 | LLM 输出 | 渲染器处理 | 状态 | 影响 |
|----------|---------|-----------|------|------|
| `primaryAxisSizingMode` | ✅ 有 | ❌ 无 | ⚠️ 忽略 | 无影响（冗余） |
| `counterAxisSizingMode` | ✅ 有 | ❌ 无 | ⚠️ 忽略 | 无影响（冗余） |
| `layoutSizingHorizontal` | ✅ 有 | ✅ 有 | ✅ 正常 | - |
| `layoutSizingVertical` | ✅ 有 | ✅ 有 | ✅ 正常 | - |
| 颜色值（hex） | ✅ 有 | ✅ 有 | ✅ 正常 | - |
| Switch padding 控制 | ✅ 有 | ✅ 有 | ⚠️ 可行但不语义 | 可改进 |
| Divider 实现 | ✅ 有 | ✅ 有 | ✅ 正常 | - |
| 按钮对齐 | ✅ 有 | ✅ 有 | ✅ 正常 | - |

---

## 🔧 建议修复

### 优先级 1：移除无效属性（已完成 ✅）

**问题**：`primaryAxisSizingMode` 和 `counterAxisSizingMode` 被输出但未处理

**修复方案（已完成）**：
1. ✅ 在 prompt 中明确说明不要使用这些属性
2. ✅ 在 `coerceNodeLayer` 中静默移除这些属性
3. ✅ **已移除接口定义**：
   - `src/utils/layoutCalculator.ts` - 从 `LayoutSizingOutput` 接口移除
   - `src/skills/llm-client/distributed/types.ts` - 从 `LayoutData` 接口移除
4. ✅ **已移除设置逻辑**：
   - `src/utils/layoutCalculator.ts` - 移除了设置这些属性的代码
5. ✅ **已修复测试**：
   - `scripts/testRenderLogic.ts` - 移除了对这些属性的测试断言

**代码位置**：
- ✅ `src/skills/llm-client/context/sectionRegistry.ts` - 已更新 CONSTRAINT_TEMPLATE
- ✅ `src/schema/layerSchema.ts` - 已在 coerceNodeLayer 中过滤
- ✅ `src/utils/layoutCalculator.ts` - 已移除接口定义和设置逻辑
- ✅ `src/skills/llm-client/distributed/types.ts` - 已更新接口定义
- ✅ `scripts/testRenderLogic.ts` - 已修复测试

**未来改进选项**（如果需要支持分布式生成）：
```typescript
// 在 coerceNodeLayer 中添加转换逻辑
if (props.primaryAxisSizingMode && props.layoutMode) {
  if (props.layoutMode === 'VERTICAL') {
    // 垂直布局：主轴是垂直方向
    props.layoutSizingVertical = props.primaryAxisSizingMode === 'AUTO' ? 'HUG' : 'FIXED';
  } else if (props.layoutMode === 'HORIZONTAL') {
    // 水平布局：主轴是水平方向
    props.layoutSizingHorizontal = props.primaryAxisSizingMode === 'AUTO' ? 'HUG' : 'FIXED';
  }
  delete props.primaryAxisSizingMode;
}

if (props.counterAxisSizingMode && props.layoutMode) {
  if (props.layoutMode === 'VERTICAL') {
    // 垂直布局：交叉轴是水平方向
    props.layoutSizingHorizontal = props.counterAxisSizingMode === 'AUTO' ? 'HUG' : 'FIXED';
  } else if (props.layoutMode === 'HORIZONTAL') {
    // 水平布局：交叉轴是垂直方向
    props.layoutSizingVertical = props.counterAxisSizingMode === 'AUTO' ? 'HUG' : 'FIXED';
  }
  delete props.counterAxisSizingMode;
}
```

### 优先级 2：改进 Switch 语义

**问题**：Switch 状态通过 padding 控制，不够语义化

**修复方案**：
1. 添加 `variant: "on" | "off"` 属性支持
2. 在 PostProcessor 中根据 variant 自动设置 padding
3. 或者在 prompt 中提供 Switch 的最佳实践示例

---

## 📝 代码检查清单

- [ ] 检查 `PROPS` 常量是否包含所有 LLM 可能输出的属性
- [ ] 检查 `layerRenderer.ts` 是否处理所有 `PROPS` 中定义的属性
- [ ] 检查 schema 验证是否拒绝无效属性
- [ ] 检查 prompt 是否明确说明哪些属性可用/不可用
- [ ] 检查 Switch 组件的语义化实现

---

## 🎯 结论

**主要问题**：
1. `primaryAxisSizingMode` 和 `counterAxisSizingMode` 被输出但未处理（低优先级，不影响功能）
2. Switch 状态控制不够语义化（中优先级，可改进）

**整体评估**：
- ✅ 颜色值处理正常（已从 token 改为具体值）
- ✅ 布局属性基本正常
- ✅ 渲染结果与 LLM 输出基本一致
- ⚠️ 存在一些冗余/无效属性被输出

**建议**：
优先修复无效属性的输出问题，避免 LLM 困惑。
