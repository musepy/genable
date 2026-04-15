# Figma 官方节点体系 — 基于 @figma/plugin-typings@1.109.0

> 源码：`node_modules/@figma/plugin-typings/plugin-api.d.ts`

---

## 1. 节点层级

```
BaseNode
├── DocumentNode                     文档根，唯一
├── PageNode                         页面，一级容器
└── SceneNode                        画布上的一切（24 种类型的联合）
```

---

## 2. SceneNode 完整类型表

### 2.1 容器类（有 ChildrenMixin）

| 节点类型 | Figma TYPE | fills/strokes | AutoLayout | Corner | 特有能力 |
|----------|-----------|---------------|------------|--------|---------|
| FrameNode | `FRAME` | ✅ | ✅ | ✅ | clipsContent, layoutGrids, guides |
| GroupNode | `GROUP` | ✗ | ✗ | ✗ | 纯包裹，无自身视觉属性 |
| SectionNode | `SECTION` | ✅ | ✗ | ✗ | 画布分区，无 AutoLayout |
| ComponentNode | `COMPONENT` | ✅ | ✅ | ✅ | createInstance(), publishable |
| ComponentSetNode | `COMPONENT_SET` | ✅ | ✅ | ✅ | 变体容器, defaultVariant |
| InstanceNode | `INSTANCE` | ✅ | ✅ | ✅ | mainComponent, swapComponent(), overrides |
| BooleanOperationNode | `BOOLEAN_OPERATION` | ✅ | ✗ | ✗ | 布尔运算 (UNION/SUBTRACT/INTERSECT/EXCLUDE) |
| TableNode | `TABLE` | ✗ | ✗ | ✗ | 表格，子节点为 TableCellNode |

### 2.2 形状类（叶子节点，无 children）

| 节点类型 | Figma TYPE | fills/strokes | Corner | 特有属性 |
|----------|-----------|---------------|--------|---------|
| RectangleNode | `RECTANGLE` | ✅ | ✅ (含独立四角) | 无 |
| EllipseNode | `ELLIPSE` | ✅ | ✅ | arcData (扇形) |
| PolygonNode | `POLYGON` | ✅ | ✅ | pointCount |
| StarNode | `STAR` | ✅ | ✅ | pointCount, innerRadius |
| LineNode | `LINE` | ✅ | ✗ | 无 |
| VectorNode | `VECTOR` | ✅ | ✅ | vectorNetwork, vectorPaths |

### 2.3 文本类

| 节点类型 | Figma TYPE | fills/strokes | 文本能力 |
|----------|-----------|---------------|---------|
| TextNode | `TEXT` | ✅ | characters, fontSize, fontName, lineHeight, range setters |

### 2.4 特殊类型（FigJam / Slides / 插件）

| 节点类型 | 场景 |
|----------|------|
| StickyNode | FigJam 便签 |
| ConnectorNode | FigJam 连接线 |
| ShapeWithTextNode | FigJam 带文字形状 |
| CodeBlockNode | FigJam 代码块 |
| StampNode | FigJam 印章 |
| WidgetNode | 插件 Widget |
| EmbedNode | 嵌入内容 |
| LinkUnfurlNode | 链接预览 |
| MediaNode | 媒体嵌入 |
| HighlightNode | FigJam 高亮 |
| WashiTapeNode | FigJam 胶带 |
| SliceNode | 导出切片 |
| SlideNode / SlideRowNode / SlideGridNode | Figma Slides |
| InteractiveSlideElementNode | Slides 交互元素 |

> **注意：没有 ImageNode。** 图片是 RectangleNode + `fills: [{ type: 'IMAGE', imageHash }]`。

---

## 3. Mixin 体系 — 属性的来源

Figma 的属性不是扁平挂在节点上的。它是 **Mixin 多重继承**——Mixin 是属性的载体，节点通过组合 Mixin 获得能力。

### 3.1 核心 Mixin 清单

```
Mixin 名                       提供的属性                                  哪些节点有
───────────────────────────────────────────────────────────────────────────────────────

身份与元数据
  BaseNodeMixin                id, name, parent, remove()                所有节点
  SceneNodeMixin               visible, locked, boundVariables          所有 SceneNode
  PluginDataMixin              getPluginData(), setPluginData()         所有节点

尺寸与定位
  DimensionAndPositionMixin    x, y, width, height,                    所有可见节点
                               minWidth/maxWidth, minHeight/maxHeight,
                               relativeTransform, absoluteTransform
  LayoutMixin                  extends DimensionAndPositionMixin        所有可见节点
                               + rotation, constrainProportions,
                               layoutSizingHorizontal/Vertical,
                               resize(), rescale()
  ConstraintMixin              constraints (定位约束)                   形状+文本+Frame

自动布局
  AutoLayoutMixin              layoutMode, layoutWrap,                  Frame, Component,
                               paddingLeft/Right/Top/Bottom,            ComponentSet, Instance
                               primaryAxisSizingMode,
                               counterAxisSizingMode,
                               primaryAxisAlignItems,
                               counterAxisAlignItems,
                               itemSpacing, counterAxisSpacing,
                               itemReverseZIndex,
                               strokesIncludedInLayout
  AutoLayoutChildrenMixin      layoutAlign, layoutGrow,                 所有在 AutoLayout
                               layoutPositioning                       容器中的子节点

填充与描边
  MinimalFillsMixin            fills, fillStyleId                       Frame, 形状, 文本
  MinimalStrokesMixin          strokes, strokeStyleId,                  Frame, 形状, 文本
                               strokeWeight, strokeJoin,
                               strokeAlign, dashPattern
  GeometryMixin                extends MinimalFillsMixin +              Frame, 形状, 文本
                               MinimalStrokesMixin
                               + strokeCap, strokeMiterLimit
  IndividualStrokesMixin       strokeTopWeight, strokeBottomWeight,     Frame, Rect
                               strokeLeftWeight, strokeRightWeight

圆角
  CornerMixin                  cornerRadius, cornerSmoothing            Frame, Rect, Ellipse,
                                                                       Polygon, Star, Vector
  RectangleCornerMixin         topLeftRadius, topRightRadius,           Frame, Rect
                               bottomLeftRadius, bottomRightRadius

混合与效果
  MinimalBlendMixin            opacity, blendMode                       所有可见节点
  BlendMixin                   extends MinimalBlendMixin                Frame, 形状, 文本
                               + isMask, maskType,
                               effects, effectStyleId

容器
  ChildrenMixin                children[], appendChild(),               Frame, Group, Section,
                               insertChild(), findAll(), findOne()     Component, ComponentSet,
                                                                       Instance, BooleanOp, Table
  ContainerMixin               expanded (面板展开状态)                   Frame, Group

文本
  NonResizableTextMixin        characters, fontSize, fontName,          TextNode 专属
                               fontWeight, textCase,
                               textDecoration, letterSpacing,
                               lineHeight, paragraphSpacing,
                               paragraphIndent,
                               + 所有 range setters
                               (setRangeFontSize, setRangeFills 等)

组件
  ComponentPropertiesMixin     componentPropertyDefinitions,            Component, ComponentSet
                               addComponentProperty(),
                               editComponentProperty()
  VariantMixin                 variantProperties                        Component, Instance
  PublishableMixin             description, remote, key,                Component, ComponentSet
                               getPublishStatusAsync()

原型交互
  ReactionMixin                reactions, setReactionsAsync()           Frame, 形状, 文本, Group
  FramePrototypingMixin        overflowDirection,                      Frame 专属
                               numberOfFixedChildren,
                               overlayPositionType

导出
  ExportMixin                  exportSettings, exportAsync()            所有可见节点

变量模式
  ExplicitVariableModesMixin   explicitVariableModes,                   所有 SceneNode + Page
                               setExplicitVariableModeForCollection()

其他
  AspectRatioLockMixin         lockAspectRatio()                        Frame, 形状, 文本
  AnnotationsMixin             annotations                              Frame, 形状, 文本
  DevStatusMixin               devStatus                                Frame
  VectorLikeMixin              vectorNetwork, vectorPaths               VectorNode
  StickableMixin               stuckTo                                  特殊节点
```

### 3.2 组合 Mixin（Figma 预定义的常用组合）

```
DefaultShapeMixin = BaseNode + SceneNode + Reaction + Blend + Geometry + Layout + Export
    → 被 Rect, Ellipse, Polygon, Star, Line, Vector, Text 使用

BaseFrameMixin = BaseNode + SceneNode + Children + Container + Geometry + Corner +
                 RectangleCorner + Blend + Constraint + Layout + Export +
                 IndividualStrokes + AutoLayout + AspectRatioLock + Annotations + DevStatus
    → Frame 的基础（不含原型交互）

DefaultFrameMixin = BaseFrameMixin + FramePrototyping + Reaction
    → 被 FrameNode, ComponentNode, InstanceNode 使用

OpaqueNodeMixin = BaseNode + SceneNode + Export + DimensionAndPosition
    → 被 Widget, Embed 等特殊节点使用
```

### 3.3 关键节点的完整继承链

**FrameNode** — 能力最完整的节点（~80+ 属性，18 个 Mixin）：

```
FrameNode extends DefaultFrameMixin
  └─ BaseFrameMixin
      ├─ BaseNodeMixin           → id, name, parent, remove()
      ├─ SceneNodeMixin          → visible, locked, boundVariables
      ├─ ChildrenMixin           → children[], appendChild(), findAll()
      ├─ ContainerMixin          → expanded
      ├─ GeometryMixin
      │   ├─ MinimalFillsMixin   → fills, fillStyleId
      │   └─ MinimalStrokesMixin → strokes, strokeWeight, strokeAlign, dashPattern
      ├─ CornerMixin             → cornerRadius, cornerSmoothing
      ├─ RectangleCornerMixin    → topLeftRadius, topRightRadius, ...
      ├─ BlendMixin
      │   └─ MinimalBlendMixin   → opacity, blendMode
      │   → + isMask, effects, effectStyleId
      ├─ ConstraintMixin         → constraints
      ├─ LayoutMixin
      │   ├─ DimensionAndPositionMixin → x, y, width, height, min/max
      │   └─ AutoLayoutChildrenMixin   → layoutAlign, layoutGrow, layoutPositioning
      │   → + rotation, layoutSizingH/V, resize()
      ├─ ExportMixin             → exportAsync()
      ├─ IndividualStrokesMixin  → strokeTopWeight, strokeBottomWeight, ...
      ├─ AutoLayoutMixin         → layoutMode, padding*, itemSpacing, align*
      ├─ AspectRatioLockMixin    → lockAspectRatio()
      ├─ AnnotationsMixin        → annotations
      └─ DevStatusMixin          → devStatus
  └─ FramePrototypingMixin      → overflowDirection, numberOfFixedChildren
  └─ ReactionMixin              → reactions
```

**TextNode** — 形状能力 + 完整文本系统：

```
TextNode extends DefaultShapeMixin
  ├─ BaseNodeMixin               → id, name, parent
  ├─ SceneNodeMixin              → visible, locked
  ├─ ReactionMixin               → reactions
  ├─ BlendMixin                  → opacity, effects
  ├─ GeometryMixin               → fills, strokes
  ├─ LayoutMixin                 → x, y, width, height, sizing
  └─ ExportMixin                 → exportAsync()
  + ConstraintMixin              → constraints
  + NonResizableTextMixin        → characters, fontSize, fontName, fontWeight,
                                   textCase, textDecoration, letterSpacing,
                                   lineHeight, paragraphSpacing,
                                   + 所有 range setters
  + AnnotationsMixin
  + AspectRatioLockMixin
  + 自有属性:
      textAlignHorizontal        → 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
      textAlignVertical          → 'TOP' | 'CENTER' | 'BOTTOM'
      textAutoResize             → 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'
      textTruncation             → 'DISABLED' | 'ENDING'
      maxLines, autoRename, textStyleId
```

**GroupNode** — 比 Frame 少很多能力：

```
GroupNode
  ├─ BaseNodeMixin               → id, name
  ├─ SceneNodeMixin              → visible, locked
  ├─ ReactionMixin               → reactions
  ├─ ChildrenMixin               → children[]           ← 有子节点
  ├─ ContainerMixin              → expanded
  ├─ BlendMixin                  → opacity, effects
  ├─ LayoutMixin                 → x, y, width, height
  ├─ ExportMixin
  └─ AspectRatioLockMixin
  ✗ 没有 GeometryMixin           → 没有 fills, strokes
  ✗ 没有 AutoLayoutMixin         → 没有 layoutMode, padding, itemSpacing
  ✗ 没有 CornerMixin             → 没有 cornerRadius
```

**RectangleNode** — 形状 + 圆角 + 独立描边：

```
RectangleNode extends DefaultShapeMixin
  + ConstraintMixin
  + CornerMixin                  → cornerRadius
  + RectangleCornerMixin         → 四角独立圆角
  + IndividualStrokesMixin       → 四边独立描边
  + AnnotationsMixin
  + AspectRatioLockMixin
```

---

## 4. 变量绑定字段

哪些属性可以绑定 Figma Variable：

```
VariableBindableNodeField:         通用节点属性
  height, width, characters,
  itemSpacing, paddingLeft/Right/Top/Bottom,
  visible, topLeftRadius/topRightRadius/bottomLeftRadius/bottomRightRadius,
  minWidth, maxWidth, minHeight, maxHeight,
  counterAxisSpacing, strokeWeight, stroke*Weight (四边),
  opacity

VariableBindableTextField:         文本专属
  fontFamily, fontSize, fontStyle, fontWeight,
  letterSpacing, lineHeight, paragraphSpacing, paragraphIndent

VariableBindablePaintField:        填充/描边颜色
  color

VariableBindableEffectField:       效果
  color, radius, spread, offsetX, offsetY

VariableBindableLayoutGridField:   布局网格
  sectionSize, count, offset, gutterSize
```
