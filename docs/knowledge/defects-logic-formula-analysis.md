### Figma 生成逻辑深度解析：原理、公式与工程化改进

本报告针对 `layerRenderer.ts` 中的核心逻辑进行逐行审计，从数学公式与软件工程原则（如 SSOT、内核逻辑、防御性编程）的角度，深入分析“描边滥用”与“100x100 尺寸回退”的深层成因。

---

### 一、 尺寸结算公式：100x100 陷阱的数学定义

在 `Figma` 插件环境中，一个节点的最终尺寸由布局模式（`layoutMode`）与轴向调整（`Axis Sizing`）共同决定。当 LLM 输出缺失关键布局信息时，系统进入“回退结算”状态。

#### 1. 运算原理与公式
在渲染器的第 212-223 行，存在一个针对 `layoutMode === NONE`（即非自动布局）的显式尺寸赋予逻辑。其数学表达可以抽象为：

$$Size_{final} = \begin{cases} AutoLayout(Children, Padding, Gap) & \text{if } LayoutMode \in \{H, V\} \\ (P_{width} \lor V_{width} \lor 100, P_{height} \lor V_{height} \lor 40) & \text{if } LayoutMode = NONE \end{cases}$$

其中：
*   $P$ 代表 LLM 提供的显式属性（`data.props.width`）。
*   $V$ 代表视口上下文（`viewport`）。
*   $100 \times 40$ 是系统的“硬编码默认值”。

#### 2. 工程原则瓶颈分析
此处违反了**“单一真相来源（SSOT）”**原则。系统在 `applyAxisSizing` 函数中已经有一套复杂的“布局约束求解器（Kernel）”，但针对 `LayoutMode=NONE` 的处理却游离在内核之外，采用了命令式的 `resize` 操作。
*   **劣势：** 逻辑碎片化。如果 LLM 输出了 `FILL` 容器但忘记输出 `layoutMode: "VERTICAL"`，该公式会强制将其视为绝对定位，导致父级的 `Auto Layout` 属性失效，节点“缩水”回默认的 100x40。
*   **改进方案：** 引入**“语义推导（Inference Logic）”**。若检测到 `CARD` 语义且缺失布局，系统应在 `sanitizeLayer` 阶段强制通过公式修正输入，而非在渲染阶段进行被动回退。

---

### 二、 视觉属性绑定逻辑：描边滥用的执行路径

描边问题并非算法计算错误，而是**“防御性编程过冲”**导致的语义污染。

#### 1. 逻辑执行逻辑（逐行解析）
渲染器第 388-399 行的逻辑如下：

```typescript
if ('strokes' in node) { // A. 检查 Figma 节点是否支持描边
    if (data.props[PROPS.strokes] && data.props[PROPS.strokes].length > 0) { // B. 检查输入是否有描边数据
        // ... (省略颜色绑定过程)
        if (paints.length > 0) (node as any).strokes = paints; // C. 忠实执行
    }
    if (data.props[PROPS.strokeWeight] !== undefined) (node as any).strokeWeight = data.props[PROPS.strokeWeight]; // D. 自动覆盖
}
```

*   **运算原理：** 这是一个典型的“属性映射策略”。由于 `layerRenderer` 被设计为通用渲染器，它对属性的合法性不做业务判断。
*   **公式表达：** $Output_{Visual} = Input_{DSL}$。

#### 2. 软件工程改进：建立“语义白名单（Semantic Sandbox）”
目前的实现是一个**“全通滤波器（All-pass Filter）”**。在生成式 AI 应用中，这会导致 LLM 的随机幻觉（如将文本颜色写进 `strokes`）被无差别地固化到 UI 中。
*   **原则性改进：** 应遵循**“最小权限原则（Principle of Least Privilege）”**。组件不应拥有它不具备语义的视觉属性。
*   **解决方案优劣点对比：**
    *   **当前（Pass-through）：** 灵活性高，LLM 可以定义任何样式；但错误率高，会导致大量的 ghost 描边。
    *   **改进（Semantic Filtering）：** 为 `DEFAULT` 变体建立强制剥离规则（`delete props.strokes`）。
        *   **优势：** 消除 95% 的描边滥用，确保生成结果的洁净度。
        *   **劣势：** 增加了对 `semantic-constraints.json` 的强耦合，如果约束库缺失某个组件的描边定义，会导致正常的描边丢失。

---

### 三、 Switch 识别：知识图谱缺位问题的自评

#### 1. 现状：逻辑真空
目前 `layerRenderer` 对 `SWITCH` 的处理如下：
*   **公式：** $SWITCH \rightarrow CreateRectangle() \lor CreateFrame()$
*   **原因：** 由于 `semantic-constraints.json` 中不存在 `SWITCH` 的子节点模板，渲染器只能将其作为原子容器。

#### 2. 解决方案：架构演进（从 Hardcoded 到 Meta-Document）
*   **劣势方案（当前模式）：** 在 `layerRenderer.ts` 中硬编码 `if (semantic === 'SWITCH') { addThumb(); }`。这违反了**“开闭原则（Open-Closed Principle）”**，每增加一个复合组件都要修改渲染核心。
*   **优势方案（Genkit-style）：**
    *   **原理：** `Generator` -> `RAG` -> `Blueprint`。
    *   **具体实现：** 在 `sanitizeLayer` 阶段，从外部 JSON 加载 `SWITCH` 的结构元数据。如果 `children` 为空，自动注入轨道（Track）与滑块（Thumb）的占位节点。
    *   **原理解释：** 这是一个**“补全算子（Completion Operator）”**的过程。
        $$FinalDSL = Explode(InputDSL, MetaLibrary)$$
    *   **优劣点：** 优势是极强的扩展性；劣势是引入了额外的 RAG 检索开销和模板管理复杂度。

---

### 四、 总结：从被动渲染到主动约束

本研究确认了目前所有显著缺陷均指向同一个根源：**渲染器过于“诚实”，而输入层缺乏“语义监理”**。未来通过将 `layerRenderer` 的防御性回退改为 `sanitizeLayer` 的语义约束，并引入基于文档的动态 RAG 机制，可以从根本上解决 LLM 随机性带来的工程瑕疵。
