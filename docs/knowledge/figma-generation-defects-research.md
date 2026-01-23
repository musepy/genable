### 研究笔记：Figma 生成缺陷（描边、尺寸回退、Switch 结构）

本笔记聚焦于三类缺陷的可复现证据链，依据当前主流程渲染路径进行排查，主入口在 main.ts 中直接调用 sanitizeLayer 和 renderLayer。未发现主流程调用 postProcess 或新式 RendererFactory，因此判断缺陷主要由 layerRenderer.ts 与输入 DSL 的组合触发，且多数问题与 LLM 输出的属性缺失或误用有关。

针对描边滥用（Stroke Abuse）现象的排查显示，渲染引擎层面的逻辑表现为完全的“被动执行”。在 `layerRenderer.ts` 的核心渲染循环中，属性绑定代码严格遵循 DSL 输入，并没有任何预设的、针对通用容器的隐式描边注入逻辑。如下代码段所示，引擎仅在检测到 `PROPS.strokes` 存在且非空时，才会调用 `figma.create` 之后的属性赋值过程：

```typescript
// src/services/rendering/layerRenderer.ts:388
if ('strokes' in node) {
    if (data.props[PROPS.strokes] && data.props[PROPS.strokes].length > 0) {
        const paints: Paint[] = [];
        for (const strokeStr of data.props[PROPS.strokes]) {
            const paint = await createPaint(strokeStr);
            if (paint) paints.push(paint);
        }
        if (paints.length > 0) (node as any).strokes = paints;
    }
    if (data.props[PROPS.strokeWeight] !== undefined) (node as any).strokeWeight = data.props[PROPS.strokeWeight];
}
```

这意味着，如果一个 `DEFAULT` 语义的容器在 Figma 中出现了描边，其唯一的来源只能是 LLM 输出的原始 JSON 数据。目前 `sanitizeLayer` 的启发式修复引擎中，虽然针对组件语义进行了一些布局修正，但显著缺失了对非法视觉属性的“语义清洗”机制。通过审计 `sanitizeLayer` 的实现可以看到，它主要关注的是布局模式（layoutMode）和尺寸参数：

```typescript
// src/services/rendering/layerRenderer.ts:13
export function sanitizeLayer(layer: NodeLayer, isRoot: boolean = true, parentLayout?: string): NodeLayer {
  // ... (省略部分逻辑)
  if (layer.type === NODE_TYPES.FRAME) {
      if (semantic === 'DIVIDER' || name.includes('divider')) {
          layer.props[PROPS.layoutSizingHorizontal] = SIZING_MODES.FILL;
          // 此处仅确保了 Divider 有 fill，但未禁止其他组件有不合理的 strokes
      }
  }
}
```

综合目前的证据，描边滥用的根本原因应定义为“LLM 属性分布的过度拟合”或“视觉字段误用”。在交叉验证样本中，甚至出现了 TEXT 节点将字体颜色写在 `strokes` 属性中的情况，这直接证明了模型对 `fills` 与 `strokes` 语义边界的模糊。由于 `layerRenderer` 并不具备“语义白名单”能力，这些带有幻觉的属性被忠实地呈现到了 Figma 画布上。因此，最有效的防御策略应当是在 `sanitizeLayer` 中引入“视觉属性指纹”校验，对于非 `OUTLINE` 变体的组件，强制性地将 `strokes` 数组置空。

100x100 相关问题的最直接触发点在 renderLayer 中对 FRAME 的尺寸处理路径。若 layoutMode 存在，则进入 Auto Layout 分支，但此分支并不进行显式 resize；随后 applyAxisSizing 只有在显式尺寸存在时才会触发 resize。对于根节点，父级并非 Auto Layout，因此 sizingMode 不会获得 FILL 能力，缺少显式 width/height 时就会保留 Figma 默认尺寸。若 layoutMode 缺失，则 renderLayer 会使用 width 默认 100、height 默认 40 的回退值。由此可以解释“100x100 Frame”在缺失尺寸与布局语义时持续出现，表现为默认尺寸占位。

Switch 结构问题与知识图谱缺口高度一致。语义类型枚举中包含 SWITCH，同时 shadcn tokens.json 给出了 Switch 的宽高与圆角，但 semantic-constraints.json 与 shadcn 组件结构库均未定义 Switch 的结构或约束。当前 sanitizeLayer 也未为 SWITCH 提供结构性补全。结果是 LLM 输出的 DSL 只能被当作一个普通 Frame 渲染，缺失轨道与滑块的内部结构。

### 假设树（当前状态与信心）

描边滥用的主要驱动被归因于 LLM 幻觉或 prompt 语义诱导，系统层面的默认描边或 token 自动注入证据不足。此判断依赖于 layerRenderer 的“仅当 props.strokes 存在才写入”的实现，以及 sanitizeLayer 与 shadcn 预设中缺乏通用描边默认值的事实，当前信心约 0.90。

100x100 问题的主因被归纳为“布局语义缺失或 sizing 缺失时保留 Figma 默认尺寸”，其中默认尺寸来自 createFrame 的原始值，或 layoutMode 缺失时 renderLayer 的 100×40 回退值。该判断直接对应 renderLayer 与 applyAxisSizing 的具体路径，信心约 0.95。

Switch 识别错误被判断为“结构性知识缺失”，证据为 tokens 与 schema 有尺寸与语义，但约束库与组件结构库缺失 Switch。当前信心约 0.90。

### 方法自评与改进

本次排查完整覆盖了主流程渲染路径与语义约束来源，但未对生成提示词与 LLM 原始输出日志进行交叉验证，导致“幻觉”结论仍基于间接证据。下一步如果需要更高置信度，应补充来自 flowObserver 的 LLM_RESPONSE 或 POST_PROCESS 阶段日志样本，并对比生成前后的 DSL 属性变化以确认是否存在中间层注入。

### 交叉验证样本（Login Screen DSL）

针对提供的 Login Screen DSL，描边滥用的证据在样本中直接可见：根容器语义为 DEFAULT 却显式带有 `strokes: ["$border"]`，卡片容器也同样带有 strokes，而 sanitizeLayer 与 renderLayer 并不存在为 DEFAULT 容器注入描边的逻辑。更关键的是，多个 TEXT 节点将颜色写在 `strokes` 而不是 `fills` 上，renderLayer 对文本颜色只读取 fills，这会把文字变成描边文字或导致颜色缺失，从而是典型的 LLM 属性误用。该样本因此强化了“描边主要来自输入”的结论，信心上调至 0.93。

关于 100x100 回退，样本根节点显式声明了 `width: 1440` 与 `height: 900`，且多数内部容器都有 layoutMode，因此渲染路径不会触发无布局回退或默认尺寸保留。该样本反而说明 100x100 并非普遍错误，而是“缺失 layoutMode 与显式尺寸”时的条件性故障，信心维持 0.95。

关于 Switch 识别错误，样本未包含 SWITCH，因此不能作为直接证据；该结论仍依赖于 tokens 与 constraints 的结构缺口。此处保持原有信心 0.90，但记录为未被样本交叉验证。

### LLM 输出问题归因：输入与流程限制

当前主聊天路径并未使用 contextBuilder.ts 中的 generateOptimizedPrompt，而是通过 composeSystemPrompt 拼装系统提示词。该提示词明确要求输出“扁平邻接表 JSON 数组”，并禁止 children 嵌套。这意味着无论模型能力如何，输出形态已被严格限定为扁平 JSON 结构。结合 generateLayout 的 responseJsonSchema 约束与 TreeReconstructor 的“幽灵嵌套剥离”，流程对 LLM 输出结构有强约束，可能解释“结构异常/信息丢失”的一部分来源。

从输入内容看，useChat 仅传入变量名前 40 个、patternAnalysis 为空、tokenMapResult 为空、detectionResult 为空，且仅注入核心语义组件的 tokenSlotSnippet，这会显著降低 LLM 可用上下文的广度。RAG 搜索只保留 top-20 结果，goldenTemplates 仅取 3 个，属于强剪裁输入策略。若 LLM 在缺乏上下文时出现语义缺失或尺寸不稳，可解释为输入信息不足而非模型能力失败。

从流程限制看，输出会经历三层强约束：1）Gemini responseJsonSchema 强制枚举与 JSON 结构；2）TreeReconstructor 将扁平列表重建并剥离 children；3）postProcessor 会修改节点以符合规则并产生 lint 警告，且 validation loop 只允许最多 2 次重试。这些步骤会改变或覆盖 LLM 原始输出，因此“异常结果”可能来自流程矫正或信息丢失，而非模型纯能力。

### 假设树补充（能力 vs 输入/流程）

LLM 输出问题更可能由“输入上下文裁剪 + 输出结构强约束 + 后处理矫正链”共同导致，能力不足不是首要解释。当前证据来自 useChat 的输入剪裁、composeSystemPrompt 的 JSON 邻接表约束、responseJsonSchema 与后处理链路的强制结构。信心 0.78。

仍需以 flowObserver 的 PROMPT/LLM_RESPONSE/POST_PROCESS 记录对比，确认 LLM 原始输出与 postProcess 结果之间的差异幅度，从而量化流程限制对最终异常的贡献。该部分尚未直接取样验证，信心 0.60。

---

### 知识库架构深度研究：Genkit 与 动态检索模式

在对 Firebase Genkit 以及 Generative UI 领域的最佳实践进行深入排查后，我们发现当前系统的“硬编码预设”模式在处理复杂组件（如 Switch）时表现出了明显的局限性。Genkit 提倡的一种核心模式是“检索器（Retrievers）”与“点提示（Dotprompt）”的解耦，这为解决“知识图谱缺口”提供了更具扩展性的思路。

在 Genkit 架构中，知识不再是硬编码在逻辑代码中的 TypeScript 对象，而是被存储为结构化的文档。通过索引器（Indexers）将组件说明（如 Markdown 格式的结构描述、视觉参数、约束条件）向量化并存入向量数据库，系统可以在生成阶段根据用户输入的语义（例如“创建一个带开关的表单”）动态检索出 Switch 的结构说明并注入 Prompt。这种“文档即知识”的转变为维护人员降低了门槛，开发者只需修改 Markdown 文档，即可校正 LLM 对组件结构的认知，而无需重新编译插件或修改渲染核心。

与当前全量注入系统提示词的做法相比，Genkit 模式通过按需检索大幅降低了 Token 消耗，并减少了无关背景对 LLM 的干扰。目前的“静态注册表”虽然在小规模下是稳定的，但随着组件库的增长，必将导致上下文窗口溢出或注意力分散。因此，向“动态 RAG”模式演进不仅是解决 Switch 结构缺失的技术方案，更是提升系统工程化程度的关键。

### 知识库架构竞争假设 (KB Architecture Hypotheses)

依据前述研究，我们针对知识库的未来演进提出了三个相互竞争的假设，并依据现有证据进行了初步校准。

1. **假设 H_KB_A（静态代码注册表）**：这是当前正在使用的方案。优点是零网络开销、渲染一致性极高。缺点是维护极其困难，修改需要动用工程代码。在处理如 Switch 等复合组件时，若文档同步不及时，极易产生渲染断层。当前项目正处于该阶段，信心 0.90（作为现状）。

2. **假设 H_KB_B（文档化 RAG 模式）**：将组件定义迁移为独立的 Markdown/JSON 说明书，并引入检索层。该方案借鉴了 Genkit 模式，能实现知识的“热更新”。系统通过检测 LLM 可能使用的语义标签，动态读取对应说明书。这种模式最能平衡“知识广度”与“Token 成本”，但在本地存储环境下的索引效率与匹配精度仍需验证。信心 0.82。

3. **假设 H_KB_C（语义强推导模式）**：该假设认为 LLM 不应感知复杂的 Figma 内部结构（如 Track/Thumb 嵌套）。系统应只要求 LLM 输出语义 ID（如 `type: "SWITCH"`），而具体的“嵌套重建”应由 `postProcessor` 或渲染工厂根据固定的预设完全接管。这类似于组件库的“黑盒”使用。该方案能极大简化 LLM 负担，但会剥夺 LLM 对局部变体进行微调的能力。信心 0.70。

### 假设树更新与校准 (Updated Hypothesis Tree)

在引入流程限制与知识库架构研究后，我们对整体假设树进行了重新评估与信心标定。

1. **结构知识必要性 (Knowledge Dependency)**：Switch 渲染失败的核心原因是系统缺乏对其复合结构的定义，LLM 默认采取了原子化的 HTML 认知。证据：tokens.json 有定义而 semantic-constraints.json 缺失。信心 0.95。

2. **流程约束致畸 (Process Constraint Distraction)**：LLM 表现出的属性误用（如将 Fill 写成 Stroke）部分源于响应必须严格符合 Adjacency List 这一强结构约束，加上输入上下文（Golden Templates）的剧烈裁剪，导致模型在极端受限环境下产生了语义塌陷。信心 0.78。

3. **后处理矫正可行性 (Post-Fix Viability)**：通过在 `sanitizeLayer` 中注入布局默认值（解决 100x100）和剥离非法描边，可以在不大幅修改 LLM 生成逻辑的前提下解决 80% 的视觉缺陷。信心 0.88。

### 总结与透明度说明

研究表明，Figma 生成缺陷并非单一的模型能力问题，而是“知识库结构缺失”与“输入信息剪裁”共同作用的结果。我们建议在修复当前 Bug 后，立即着手将“硬编码知识”向“文档化知识”演进，参照 Genkit 模式建立一套基于 Markdown 的组件说明书系统。这不仅能修复当前的 Switch 结构问题，还能通过降低上下文噪声，从底层改善 LLM 的生成稳定性。
