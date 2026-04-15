# Figma Page Organization via CLI — Lessons Learned

## 任务背景
109 个 root-level 节点散落在 Figma page 上，需要整理成有条理的布局。

## 关键决策与踩坑

### 1. "整理" ≠ 删除
**踩坑**：第一反应是删除"测试残留"。用户纠正：整理是分类、排列、组织，不是删除。
**原则**：永远先分类移动，不主动删除。用户没说删就不删。

### 2. 分类策略
按用途分 4 类，用 frame（section 类型）作容器：
- **Designs** — 完整页面和屏幕设计
- **Components** — 可复用组件定义
- **Tests** — 测试和调试产物
- **Orphans** — 散落的孤儿节点

### 3. 布局模式：row + wrap + 固定宽度 + hug 高度
**踩坑**：column 布局 → 所有设计竖向堆叠，极高极窄。row 不加 wrap → 横向无限延伸。
**正解**：
```
layout:row, wrap:wrap, w:5000(固定), h:hug
```
子节点在 5000px 宽度内自动换行，高度自适应。这是 Figma 里"网格陈列"的最佳模式。

### 4. 标题不放容器内部
**踩坑**：把标题实例放进 section 内 → 它变成最后一个子节点（auto-layout 排到底部），无法重排序。
**正解**：标题放在 section **外部、上方**。用一个纵向父容器交替排列：
```
PageLayout (layout:column)
  ├── Title1 (SectionTitle instance)
  ├── Section1 (wrap layout, designs inside)
  ├── Spacer (h:80)
  ├── Title2
  ├── Section2
  └── ...
```
标题就像真正的标题——在内容上方，不在内容里面。

### 5. 组件定义 vs 实例使用
**踩坑**：把 SectionTitle 组件移入 _Components section（该 section 自己也用了 SectionTitle 实例）。
**原则**：组件定义（class）不应该放在使用实例的地方（main）。组件定义独立存放，实例在使用处。

### 6. CLI 工具限制
| 操作 | 支持 | 备注 |
|------|------|------|
| mv 跨父级移动 | ✅ | `mv /Node/ /NewParent/` |
| mv 同级重排序 | ❌ | 无法把子节点移到第一位 |
| undo | ❌ | 插件 API 无 undo，需用户手动 Cmd+Z |
| wrap 布局 | ✅ | `wrap:wrap` 属性 |
| section 类型 | ✅ | `mk /Name/ section` |
| 批量操作 | ✅ | 用 `;` 连接多个命令 |

### 7. 标题组件设计
```
SectionTitle component:
  w:5000 (与 section 同宽)
  h:72
  bg:#1A1A2E (深色背景，视觉锚点)
  layout:row, alignCross:center, p:12
  └── Label text: size:28, weight:Bold, fill:#FFF, w:fill
```
- 用实例的 `set:Label:'xxx'` 覆盖文字
- 统一宽度让所有标题左对齐
- 深色背景在缩放时仍可识别

## 整理流程模板

```
1. ls / — 审视全部节点
2. 分类（按用途，不按类型）
3. 创建 PageLayout (layout:column, w:N, h:hug)
4. 对每个分类：
   a. ln Title 实例 → PageLayout
   b. mk Section (layout:row, wrap:wrap, w:N, h:hug, gap:G, p:P)
   c. mv 节点 → Section
   d. mk Spacer (h:80) → PageLayout（分类间留白）
5. 组件定义放 page root，不放任何 section 内
```

## 适用场景
- Agent 生成了大量设计后的页面整理
- 项目交接时整理 Figma 文件
- 定期清理测试残留
