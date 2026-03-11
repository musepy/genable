# Text Node 能力审计 (2026-03-11)

## 背景

对 Figma TextNode API 的全部属性与我们 MCP design tool 的支持情况做了完整对比和实测验证。

## 测试方法

通过 figma-plugin MCP `design` 工具逐个创建带不同属性的 text 节点，用 `inspect` + `screenshot` 验证实际效果。

## Figma TextNode 属性支持情况

### 显式支持（有缩写或特殊处理路径）— 18 个

| 属性 | 缩写 | 处理方式 |
|------|------|---------|
| characters | 第三参数 / content | applyTextProps |
| fontSize | size | ABBREV → coerceValue |
| fontName (family+style) | font + weight | applyTextProps 字体加载 |
| textAlignHorizontal | textAlign | ABBREV |
| letterSpacing | tracking | lowerUnitValue |
| lineHeight | leading | lowerUnitValue |
| fills (text color) | fill (text 专用路径) | paintSpec.parseXml |
| strokes | stroke | paintSpec.parseXml |
| strokeWeight | strokeW | ABBREV |
| strokeAlign | strokeA | ABBREV |
| effects | shadow | effectSpec.parseXml |
| layoutSizingH/V | w:'fill'/h:'fill'/sizingH/sizingV | normalizeProps |
| textAutoResize | 自动推导 | normalizeProps (FILL→HEIGHT) |
| opacity | opacity | 数值直接赋值 |
| x, y | x, y | 直接赋值 |
| width, height | w, h | resize() |
| minW/maxW/minH/maxH | minW/maxW/minH/maxH | ABBREV |
| name | name | 直接赋值 |

### 通用赋值工作（实测验证）— 12 个

| 属性 | 验证结果 | 备注 |
|------|---------|------|
| textAlignVertical | ✅ | 需配合 textAutoResize:'NONE'，否则 hug 模式下无视觉效果 |
| textCase | ✅ | UPPER/LOWER/TITLE 全部视觉确认 |
| textDecoration | ✅ | UNDERLINE/STRIKETHROUGH 视觉确认 |
| textTruncation | ✅ | 需配合 textAutoResize:'TRUNCATE' |
| maxLines | ✅ | 需配合 textTruncation 或 textAutoResize:'TRUNCATE' |
| paragraphIndent | ✅ | 数值直接生效 |
| paragraphSpacing | ✅ | 数值直接生效，h=80 验证（3段×16+2×16spacing） |
| rotation | ✅ | 正负角度都正确 |
| blendMode | ✅ | 节点创建成功 |
| layoutGrow | ✅ | 等效于 sizingH:fill |
| visible | ✅ | 修复 boolean 后生效 |
| locked | ✅ | 修复 boolean 后生效 |
| autoRename | ✅ | true=name 跟随内容变，false=name 保持不变 |

### 不支持

| 属性 | 原因 |
|------|------|
| Range API (setRangeFontSize 等) | 架构缺口 — flat ops 无法表达单节点内混合样式 |
| hyperlink | 需要结构体 {type:'URL', value:'...'}, props 系统只处理 string/number/boolean |
| textDecorationStyle/Offset/Thickness/Color/SkipInk | 细粒度装饰控制，需要结构体参数 |
| listSpacing / listOptions | 列表功能，需要结构体参数 |

## 发现的 Bug 及修复

### Bug: coerceValue 无 boolean 处理

**症状**: `visible:false`, `autoRename:true`, `locked:true` 等 boolean 属性创建失败。

**根因**: `coerceValue()` 返回类型为 `string | number`，`"false"` 作为 truthy string 传给 Figma API 导致错误。

**修复**: 在 coerceValue 中加入 boolean 判断（`"true"` → `true`, `"false"` → `false`），放在 STRING_VALUE_PROPS 检查之后、NUMERIC_PROPS 检查之前。

### 隐坑: textAutoResize 自动推导覆盖固定尺寸

`normalizeProps` 在 create 时自动设 textAutoResize:
- 无 w:'fill' → WIDTH_AND_HEIGHT (忽略固定 w/h，文本 hug 到内容)
- 有 w:'fill' → HEIGHT

**影响**: 想要固定尺寸的 text box（截断/垂直对齐），必须显式传 `textAutoResize:'NONE'` 或 `'TRUNCATE'`。否则设了 w:120 h:60 也会被覆盖。

## 代码重构: prop-dsl 解耦

### 背景
xml-interpreter.ts 作为 XML 解析器已废弃（生产代码只用 flatOpsParser），但其导出的工具函数（coerceValue, ABBREV_EXPANSION 等）仍被 flatOpsParser 复用。

### 改动
1. **新建 `src/engine/utils/prop-dsl.ts`** — 提取共享 DSL 工具函数
2. **`src/engine/flat/flatOpsParser.ts`** — import 改为 `../utils/prop-dsl`
3. **`src/engine/xml/xml-interpreter.ts`** — 标记 LEGACY，从 prop-dsl re-export 保持测试兼容

### 文件依赖
```
prop-dsl.ts (source of truth)
  ├── flatOpsParser.ts (生产代码直接 import)
  └── xml-interpreter.ts (re-export for test compat)
        └── xml-interpreter.test.ts (legacy tests)
```

## 能力总结

- **单节点级 text 属性**: 30 个属性全部可用（18 显式 + 12 通用赋值）
- **混合样式 (Range API)**: 不支持 — 需要新的 DSL 语法设计
- **结构体属性** (hyperlink, textDecorationStyle 等): 不支持 — 需要 props 系统扩展
