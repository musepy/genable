---
description: How to navigate and understand this codebase (Self-Referential Architecture)
---

# Codebase Navigation Guide

> **本项目采用分形自指架构 (Fractal Self-Reference Architecture)**
> 灵感来源：《哥德尔、埃舍尔、巴赫》中的复调与自指概念

---

## 🔄 Strange Loop Protocol (自指循环协议)

```
┌─────────────────────────────────────────────────────────────┐
│  README.md (根目录)                                          │
│  ├── 描述所有文件夹 (Quick Routes)                           │
│  └── 声明："更新任何代码后必须更新相关文档"                    │
│        ↑                                                     │
│        │ 指向                                                │
│        │                                                     │
│  .folder.md (每个文件夹)                                     │
│  ├── 列出所有文件                                            │
│  └── 声明："一旦本文件夹变化，请更新我"                       │
│        ↑                                                     │
│        │ 指向                                                │
│        │                                                     │
│  文件头部注释 (每个代码文件)                                  │
│  ├── I/O/POS 三行描述                                        │
│  └── 声明："一旦我被修改，更新我的注释和所属文件夹的md"       │
└─────────────────────────────────────────────────────────────┘
```

**这形成了一个 Strange Loop (怪圈)：**
- 文件 → 指向 → 文件夹文档
- 文件夹文档 → 指向 → 根目录
- 根目录 → 描述 → 所有文件

---

## Navigation Rules (导航规则)

1. **进入项目**: 先读 `README.md` 的 Mandatory 部分
2. **进入文件夹**: 先读该文件夹的 `.folder.md`
3. **阅读代码文件**: 先看头部的 I/O/POS 注释
4. **修改代码后**: 按 Strange Loop 顺序更新文档

---

## I/O/POS Protocol (文件头部格式)

每个代码文件开头必须有：

```typescript
/**
 * @file filename.ts
 * @description 简短描述
 * 
 * [INPUT]:  本文件依赖什么
 * [OUTPUT]: 本文件对外提供什么
 * [POS]:    本文件在系统架构中的位置
 * 
 * ⚠️ 自指更新规则：一旦我被修改，必须：
 *    1. 更新本注释的 I/O/POS
 *    2. 更新 所属文件夹的 .folder.md
 *    3. (如需) 同步相关联的文件
 */
```

---

## Quick Reference: Where to Make Changes

| Task | File(s) to Modify |
|------|-------------------|
| Add new DSL property | `schema.ts` → `main.ts` → `contextBuilder.ts` |
| Change LLM prompt | `contextBuilder.ts` |
| Add component knowledge | `/src/knowledge/componentKnowledge.ts` |
| Modify rendering | `main.ts` → `renderLayer()` |
| Change UI | `ui.tsx` |

---

## Why This Works for LLM Consistency

1. **冗余校验 (Redundancy)**: 同一信息在多层级重复，防止"中段遗忘"
2. **自愈机制 (Self-Healing)**: 如果某层信息被误读，其他层可以纠正
3. **硬性约束 (Hard Constraints)**: "必须更新 X" 创建不可违反的规则
4. **锚定效应 (Anchoring)**: I/O/POS 注释固定 AI 对文件角色的理解
