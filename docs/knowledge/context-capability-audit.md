# Context Capability Audit

## 当前 4 个读取工具

| 工具 | 返回内容 | token 成本 |
|---|---|---|
| context() | 页面顶层骨架 + 用户选区（ID/name/type） | ~200 |
| outline(nodeId) | 结构骨架（ID、name、尺寸、layout、position） | ~200 |
| inspect(nodeId) | 完整样式 + 可选截图（大树自动降级为结构） | ~800 |
| query(source) | 节点搜索 / 静态设计知识 / style guide | ~500-2000 |

## Figma API 已有但未暴露给 LLM 的上下文

### 高影响

1. **色彩系统** — `figma.getLocalPaintStylesAsync()` → 页面调色板
2. **字体系统** — `figma.getLocalTextStylesAsync()` → 排版层级（H1/H2/Body/Caption）
3. **间距系统** — 现有节点的 padding/gap 模式
4. **效果预设** — `figma.getLocalEffectStylesAsync()` → shadow/blur 预设
5. **设计变量/Token** — `figma.variables.getLocalVariablesAsync()` → DesignSystemManager 已用但不暴露给 LLM
6. **组件关系** — master/instance、ComponentSet 变体

### 中影响

7. **画板尺寸约束** — 375px mobile vs 1440px desktop
8. **选区编辑意图** — 缺少位置、尺寸、样式上下文
9. **Style 绑定** — inspect 不区分 local style 引用 vs 硬编码值

## 编排层对上下文的限制

### 插件 Agent vs MCP 的核心差异

| 维度 | 插件 Agent | MCP（如 Claude Code） |
|---|---|---|
| 上下文窗口 | ~12K tokens（人为压缩） | 100K+ tokens（模型原生） |
| 压缩策略 | 激进 — turnMessages 每轮清空，summary 滚动压缩 | 无压缩或温和压缩 |
| 工具结果上限 | 3000 chars（TOOL_RESULT_MAX_DATA_CHARS） | 无硬限制 |
| inspect 降级 | >2500 chars 自动降级为结构模式 | 不降级 |
| 截图 | 可选，但占大量 token（~1000+） | 可以多张 |
| 设计系统上下文 | 不注入 | 可通过 MCP resource 注入 |
| 历史上下文 | 仅 summary（损失细节） | 完整对话历史 |

### 关键瓶颈

1. **~12K token 总预算**：system prompt ~4K + summary ~2K + turnMessages ~6K → 留给工具结果的空间很小
2. **工具结果 3000 chars 硬上限**：inspect 一个中等复杂的组件就超了，被迫降级
3. **summary 有损压缩**：前几轮创建的节点细节（颜色、间距）在后续轮次中丢失
4. **每轮清空 turnMessages**：上一轮的 tool result 在下一轮不可见，只有 summary 摘要
5. **截图 token 成本高**：一张截图 ~1000+ token，在 12K 预算里占比过大

### 结论

Figma API 能提供丰富的设计系统上下文，但编排层的 token 预算和压缩策略是真正的瓶颈。即使实现了 design system 提取器，在 12K 预算下也很难同时容纳：
- 设计系统摘要（调色板+字体+间距）
- 当前节点 inspect 结果
- 截图
- 历史 summary

MCP 客户端没有这些限制，同样的工具在 MCP 下能发挥更大价值。

### 探索方向

1. **预算动态化** — 根据模型 contextWindow 调整，不硬编码 12K
2. **分级上下文注入** — 设计系统摘要放 system prompt（一次性成本），不占 turnMessages 预算
3. **Smart summary** — summary 保留设计系统关键信息（颜色值、间距值），不只保留操作摘要
4. **Tool result 智能裁剪** — 按相关性裁剪而非按长度截断
