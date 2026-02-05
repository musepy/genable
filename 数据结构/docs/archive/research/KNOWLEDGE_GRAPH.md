# 知识图谱 (Knowledge Graph)

> 本文档连接所有研究成果，构建知识脉络。

---

## 🗺️ 知识地图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Figma AI Generator 研究全景                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ LLM 职责边界 │───►│ 知识检索效能 │───►│ 架构演进    │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│        │                  │                  │                  │
│        ▼                  ▼                  ▼                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ UI Pro Max  │───►│ 知识双轨制  │───►│ 后处理层    │         │
│  │ 复用研究    │    │ 诊断 + 治理 │    │ 技术债务    │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📚 主题聚类

### 主题 1: LLM 职责边界与架构

| 文档 | 核心结论 |
|:---|:---|
| [llm_driver_factors_analysis.md](./llm_driver_factors_analysis.md) | Prompt 19 分段 + Schema 约束 + Tool Calling 全景分析 |
| [llm_responsibility_architecture.md](./llm_responsibility_architecture.md) | LLM 擅长语义，工具擅长计算；避免过度工程化 |
| [llm_role_boundary_research_layout.md](./llm_role_boundary_research_layout.md) | 布局属性（HUG/FILL）应由后处理推导，非 LLM 决定 |

### 主题 2: UI Pro Max 知识复用

| 文档 | 核心结论 |
|:---|:---|
| [ui_pro_max_research_notes.md](./ui_pro_max_research_notes.md) | 双层架构（推理策略层 + 资产数据层）+ BM25 确定性检索 |
| [reuse_feasibility_analysis.md](./reuse_feasibility_analysis.md) | MiniSearch 替代 Python BM25；构建时转译优于运行时适配 |
| [uipromax_integration_analysis.md](./uipromax_integration_analysis.md) | 知识流：CSV → JSON → MiniSearch 索引 → Prompt 注入 |
| [hypothesis_log.md](./hypothesis_log.md) | H1-H6 假设验证记录；H6 (MiniSearch) 已确认采用 |

### 主题 3: 知识检索与双轨制

| 文档 | 核心结论 |
|:---|:---|
| [knowledge_hub_evaluation_summary.md](./knowledge_hub_evaluation_summary.md) | SHADCN_PRESET 与 ANATOMY_REGISTRY 冲突导致 Prompt 冗余 |
| [structure_research_notes.md](./structure_research_notes.md) | 结构蓝图注入策略；建议统一到 KnowledgeHub |

### 主题 4: 后处理与一致性

| 文档 | 核心结论 |
|:---|:---|
| [post_processor_tech_debt.md](./post_processor_tech_debt.md) | sanitizeLayer vs postProcessor 双系统冲突；方案 A 已统一 |
| [overcorrection_risk_audit.md](./overcorrection_risk_audit.md) | 当前修正是"翻译"非"篡改"；数值保留、回退安全 |
| [architecture_analysis.md](./architecture_analysis.md) | 生成偏差分析；Schema 限制 vs Prompt 引导 |

---

## 🔑 核心假设状态

| ID | 假设 | 置信度 | 状态 |
|:---|:---|:---:|:---:|
| H-DS | Schema 过度约束 | 95% | ✅ 已禁用 |
| H-100px | 100px 魔法数字 | 99% | ✅ 源头治理 |
| H-Dual-Track | 知识双轨制 | 98% | 🔄 P1 待解 |
| H6-MiniSearch | MiniSearch 替代 BM25 | 95% | ✅ 已采用 |

---

## 📈 演进路线

1. **已完成**: Schema 降级、100px 治理、方言映射
2. **进行中**: 知识合一（SHADCN → Anatomy）
3. **下一步**: 启用 PostProcessor、分层召回
