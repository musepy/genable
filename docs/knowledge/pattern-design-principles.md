# Pattern 设计原则 — 结构语义 vs 名词语义

## 核心结论

Pattern 系统只应覆盖**结构维度**，不应进入**视觉/语义维度**。

## 现有 layout patterns 为什么有效

```
pattern:'row'    → layout:row + w:hug + h:hug + transparent bg
pattern:'column' → layout:column + w:hug + h:hug + transparent bg
pattern:'row-fill' → layout:row + w:fill + h:hug + transparent bg
```

这些是**结构规则**，对所有该类容器普遍成立，没有例外。
"横排容器"永远需要 `layout:row`，不受设计风格影响。

## Noun patterns 的问题

曾考虑扩展：
```
pattern:'btn'     → p:'10 16' + corner:8
pattern:'heading' → size:24 + weight:Bold + fill:#111827
pattern:'divider' → w:fill + h:1 + fill:#E5E7EB
```

**这条路不应该走**，原因：

这些是**设计系统默认值**，不是结构规则：
- 大 CTA 按钮 `p:'16 32'`，compact 按钮 `p:'6 12'`，icon button `p:10`
- H1 可能 48px，H3 可能 18px，section title 可能 14px bold
- 一旦 LLM 看到"按钮"就套 `btn` pattern，设计变化空间塌缩

## 触发逻辑的本质差异

| | layout pattern | noun pattern |
|--|--|--|
| 触发逻辑 | "我要横排容器" → `row` | "这是按钮" → `btn` |
| 适用范围 | 结构上普遍成立 | 只适用于某个特定尺寸/风格 |
| 设计自由度 | 视觉维度完全自由 | 视觉维度被 pattern 预设 |
| LLM 行为 | 选结构意图 | 匹配名词 → 过度套用 |

## Pattern 扩展的正确判断标准

一个候选 pattern 值得加入，当且仅当：

1. **结构上普遍成立** — 对所有该意图的容器都是正确的
2. **不携带视觉意见** — 不预设颜色、字号、间距等设计决策
3. **消除隐式依赖** — 把"必须同时设置才正确"的属性打包

## Noun 类需求的正确替代方案

| 需求 | 不用 pattern，改用 |
|--|--|
| 标准按钮规格 | `EXAMPLES.md` 里的示范（展示常见写法，不强制） |
| 组件复用 | `ref()` 调用（引用 design system 里已有的 Button 组件） |
| 设计规范知识 | Skill 知识注入（"button 常见规格是..."，LLM 自己决定） |

## 总结

Pattern 保持纯结构语义 = 约束错误空间，不约束设计空间。
Pattern 进入视觉/名词语义 = 约束了设计空间，LLM 创作自由度下降。
