# 提案：语义布局引擎 (确定性) v4.1

## 核心设计变更

### 引用布局矩阵 (Layout Matrix Integration)
本方案已正式集成 `layout-matrix.md` 作为布局约束的单一事实来源。
**[查看完整矩阵](file:///Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/.agent/workflows/design/layout-matrix.md)**

该矩阵定义了：
1.  **Containment Constraints**: `Child Width <= Parent Width` 的严格规则。
2.  **Sizing Invariants**: 哪些组件必须 `HUG`，哪些必须 `FILL`。
3.  **Forbidden Combinations**: 显式禁止的布局嵌套逻辑（如 HUG Parent 内的 FILL Child）。

---

## 技术深度解析 (Technical Deep Dive)

### 1. 解决 Constraint Conflict (Logical Overflow)

**问题纠正**：
我们不仅要解决“阴影被切”的视觉问题，更要解决 **“逻辑溢出”**。
*   **场景**：LLM 输出 `Button { width: 50, layoutSizing: FIXED, text: "Submit Request" }`。
*   **冲突**：文字 "Submit Request" 物理宽度需要 100px+，但父容器被强制设为 50px。
*   **结果**：文字被裁剪 (Clip) 或溢出 (Overflow)，布局崩坏。
*   **GRIDS 约束**：Parent Width >= Child Width (Containment)。

**解决方案 - "Invariant Override Strategy"**：
我们既然不使用 Solver 去计算 `100px > 50px`，我们就必须从 **定义 (Definition)** 上消除产生冲突的可能性。

对于特定的语义类型（如 `BUTTON`, `TAG`, `BADGE`），其“容器必须包裹内容”是 **不可变 (Invariant)** 的物理特性。

*   **编译策略**：
    编译器将执行 **"Sanitization Pass" (消毒)**。对于 `Content-Dependent` 的语义类型，我们 **无视** LLM 提供的任何尺寸数值 (Width/Height) 和固有模式 (FIXED)。

```typescript
// 伪代码演示
function compileLayout(node, profile) {
    // 强制执行 Profile 定义的 Sizing
    // 即便 LLM 输出了 width: 50，只要 semantic 是 BUTTON，
    // 我们就强制覆盖为 HUG，物理上保证父容器 >= 子元素
    if (profile.sizing.horizontal === 'HUG') {
        node.layoutSizingHorizontal = 'HUG';
        delete node.width; // 彻底删除固定宽度，消除冲突根源
    }
}
```
**结论**：即使 LLM “错误地”指定了 `width: 50`，我们的引擎也会将其修正为 `HUG`，从而渲染出 `100px` 的正确宽度。

### 2. 彻底解决 Clip Content (Visual Overflow)

**核心矛盾**：
*   **Figma 行为**：当 Frame 尺寸固定 (FIXED) 且内容溢出时，若 `clipsContent: true`（默认），内容会被切断。
*   **设计需求**：按钮的阴影 (Drop Shadow) 或绝对定位的小红点 (Badge) 经常位于容器边界**之外**。

**解决方案 - "Semantic Overflow Strategy"**：
*   **编译逻辑**：
    编译器在处理节点时，读取 `layout-matrix.md` 中定义的 `Overflow` 策略。
    *   **Case A (Button/Icon)**: `clipsContent: false`。
    *   **Case B (Card/Page)**: `clipsContent: true`。

### 3. 文本布局策略 (Text Layout Strategy)

文本在 UI 中主要有两种行为模式，我们通过 `layout-matrix.md` 的 Typography Matrix 完全接管。

#### 模式 A: 标题与标签 (Heading / Label)
*   **特征**：单行，宽度随文字增长。
*   **编译**：强制 `textAutoResize: "WIDTH_AND_HEIGHT"` + `layoutSizing: "HUG"`.

#### 模式 B: 段落与描述 (Paragraph / Body)
*   **特征**：多行，宽度受容器限制，高度随内容增长。
*   **编译**：强制 `textAutoResize: "HEIGHT"` + `layoutSizing: "FILL"`.

#### 模式 C: 截断文本 (Truncated)
*   **特征**：单行，宽度受限，超出省略。
*   **编译**：强制 `textTruncate: "ENDING"` + `layoutSizing: "FILL"`.

### 4. 高级属性编译

#### A. Gap: "Auto" (双端对齐)
*   **Schema**: `gap: "AUTO"`
*   **编译**: `primaryAxisAlignItems = 'SPACE_BETWEEN'`, `itemSpacing = 0`.

#### B. Fill (填充容器)
*   **Schema**: `width: "100%"` 或 `layoutSizing: "FILL"`.
*   **编译**: `layoutSizingHorizontal = 'FILL'`, 删除 `width`.

#### C. Wrap (自动换行)
*   **Schema**: `wrap: true`.
*   **编译**: `layoutWrap = 'WRAP'`.

---

## 总结：编译器工作流 (Compiler Workflow)

```mermaid
graph TD
    A[LLM Output JSON] --> B(Validation & Coercion);
    B --> C{Has Semantic?};
    C -- Yes --> D[Load Profile from Layout Matrix];
    C -- No --> E[Use Raw Props (Fallback)];
    D --> F[Sanitize: FORCE Override Sizing (Invariant)];
    F --> G[Compile Layout/Gap/Wrap];
    G --> H[Apply Overflow Constraints (NoClip)];
    H --> I[Final Figma Node];
```
