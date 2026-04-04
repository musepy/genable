---
name: codebase-investigation
description: Systematic codebase investigation — read structure first, compare related systems, categorize exhaustively, question decisions against real-world usage, follow implications
trigger: (调查|审查|怎么回事|什么情况|investigate|audit|review|dig into|深入看|盘一下|梳理)
---

# Codebase Investigation

Systematic approach to understanding and discovering problems in a subsystem.

## Workflow

### Step 1: Read Structure, Not Details (骨架优先)
- Large file? Don't read line by line
- `grep` for exports, section headers, class/function names first
- Goal: understand the **shape** (how many parts, what each part is) before reading content
- 1000-line file might just be 3 simple things

### Step 2: Compare Related Systems (对比找重叠)
- Find files that touch the same domain (e.g., two config files for properties)
- Ask: what does each one own? where do they overlap? who imports whom?
- Overlap = potential inconsistency or unnecessary duplication

### Step 3: Categorize Exhaustively (穷举分类)
- List ALL items in the domain (e.g., all 153 properties)
- Categorize each one: handled / excluded / unhandled
- The "unhandled" list reveals gaps — often much smaller than assumed
- Use sub-agents for mechanical extraction work

### Step 4: Question Design Decisions (追问决策)
- For each categorization decision: who decided? based on what? when?
- "Human judgment" without verification criteria = potential blind spot
- Look for decisions made by convention/habit vs. principled reasoning

### Step 5: Find Real-World Reference (现实参照)
- Does the platform/framework already solve this? (e.g., Figma's own UI panel)
- Does a standard exist? (e.g., CSS spec for layout properties)
- If we're reinventing something that already exists → why?
- **对比竞品架构做法**，追问"我们为什么不这样做"
  - 例：OpenPencil 用代码模板+编译执行，我们用文本解析——追问差异的原因和代价
  - 差异往往揭示被忽视的设计约束或未评估的替代方案

### Step 6: Follow Implications (追踪影响链)
- For each gap/issue found, trace the consequence chain:
  - Property exists but not in prompt → LLM won't proactively use it → specific design defect
  - Property in whitelist but missing validation → LLM sends wrong value → silent failure
- Stop when you reach a **user-visible impact** — that's the real bug

## Key Behaviors
- **Don't assume the problem is big** — audit first, often coverage is better than expected
- **Screenshots and real UI are evidence** — don't just read code, look at actual behavior
- **Record findings immediately** — gotchas to `docs/knowledge/`, insights to learning docs
- **Distinguish "can't do" vs "doesn't know to do"** — capability gap vs knowledge gap
- **语言**: Follow user's language preference
