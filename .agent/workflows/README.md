# Workflows 使用指南

> AI 助手工作流索引 - 步骤式操作指南

---

## 📁 目录结构

```
.agent/
├── workflows/     ← 步骤式流程 (How-to)
│   ├── core/          核心开发流程
│   ├── collab/        协作规范
│   ├── quality/       质量审计
│   └── debug/         调试流程
│
└── skills/        ← 知识规范 (自动匹配)
    ├── radix-tokens/
    ├── engineering-principles/
    └── ...
```

---

## 🚀 Workflows vs Skills

| 类型 | Workflows | Skills |
|------|-----------|--------|
| **用途** | 步骤式操作指南 | 知识规范 + 能力扩展 |
| **触发** | `/slash-command` | 任务相关时自动匹配 |
| **结构** | 单个 `.md` 文件 | 目录 + `SKILL.md` |

---

## 📚 Workflow 索引

### 📁 core/ — 核心开发

| Workflow | 何时使用 | 命令 |
|----------|----------|------|
| codebase-navigation | 首次接触项目 | `/codebase-navigation` |
| ui-development | 开发 UI 前 | `/ui-development` |

### 📁 collab/ — 协作规范

| Workflow | 何时使用 | 命令 |
|----------|----------|------|
| git-workflow | 提交代码 | `/git-workflow` |
| pr-protocol | 创建 PR | `/pr-protocol` |
| shell-safety | 运行命令 | `/shell-safety` |

### 📁 quality/ — 质量审计

| Workflow | 何时使用 | 命令 |
|----------|----------|------|
| ux-designer | 完善后审计 UX | `/ux-designer` |
| migration-strategy | 引入新规范后清理 | `/migration-strategy` |

### 📁 debug/ — 调试

| Workflow | 何时使用 | 命令 |
|----------|----------|------|
| figma-debug | Figma 插件调试 | `/figma-debug` |

### 📁 根目录

| Workflow | 何时使用 | 命令 |
|----------|----------|------|
| code-quality | 审计代码质量 | `/code-quality` |
| e2e-ux-testing | 端到端 UX 测试 | `/e2e-ux-testing` |

---

## 🔧 Skills 索引 (自动匹配)

以下规范在相关任务时**自动应用**：

| Skill | 触发场景 |
|-------|----------|
| radix-tokens | 开发 UI、审计样式 |
| engineering-principles | 代码审查、架构决策 |
| figma-plugin-eng | Figma 插件开发 |
| design-anti-patterns | UI 代码审查 |
| motion-system | 添加动效 |
| interaction-matrix | 设计交互状态 |
| radix-floating-layer | Popover/Tooltip 问题 |
| refactoring-culture | 讨论重构策略 |
| user-preferences | 语言/交互风格 |
| llm-debt-guard | 异步/状态代码生成 |

---

## 📖 如何使用

### 方式 1: Slash 命令 (Workflows)
```
用户: 帮我开发一个新按钮 /ui-development
```

### 方式 2: 自动匹配 (Skills)
```
用户: 检查这个组件的 Token 使用是否正确
→ AI 自动加载 radix-tokens skill
```
