---
description: 代码质量检查 - 静态分析与禁止模式搜索
---

# Code Quality Skill

> **核心原则**: 搜索禁止模式，不搜索允许模式

---

## 1️⃣ 静态分析原则

### 两种检查思路

| 方法 | 搜索什么 | 效果 |
|------|----------|------|
| ❌ 允许模式 | 找正确写法 | 遗漏问题 |
| ✅ 禁止模式 | 找错误写法 | 发现问题 |

**类比**：
- 医生问"哪里不舒服"而非"哪里健康"
- 安检找"违禁品"而非"允许品"

---

## 2️⃣ 禁止模式清单

### Typography 违规 (P1)

```bash
# 硬编码 fontSize (禁止直接数字，应为 tokens.fontSize[N] 或 var(--font-size-N))
// turbo
grep -rn "fontSize: [0-9]" src/ui --include="*.tsx" --include="*.ts" | grep -v "tokens\." | grep -v "var(--" | grep -v design-system

# 遗留别名 (禁止 xs/sm/lg/base，应为 fontSize[1]/[2]/[3])
// turbo
grep -rn "fontSize\.\(xs\|sm\|lg\|base\|xl\)" src/ui --include="*.tsx" --include="*.ts" | grep -v design-system

# 硬编码 lineHeight 比例值 (禁止 1.x，应为 tokens.lineHeight[N]px)
// turbo
grep -rn "lineHeight: [0-9]\." src/ui --include="*.tsx" --include="*.ts" | grep -v "tokens\."

# 硬编码 fontWeight (禁止直接数字，应为 tokens.fontWeight.*)
// turbo
grep -rn "fontWeight: [0-9]" src/ui --include="*.tsx" --include="*.ts" | grep -v "tokens\."
```

### 样式违规 (P2)

```bash
# 硬编码 borderRadius (禁止数字，应为 var(--radius-*))
grep -rn "borderRadius: [0-9]+" src --include="*.tsx"

# 硬编码颜色 (禁止 #xxx, 应为 CSS 变量)
grep -rn "#[0-9a-fA-F]\{6\}" src --include="*.tsx" | grep -v tokens

# 硬编码 rgba (禁止 rgba(, 应为 var(--gray-a*))
grep -rn "rgba(" src --include="*.tsx"

# 硬编码 opacity (禁止 0.x, 应为 var(--gray-a*) 或语义 token)
grep -rn "opacity: 0\." src --include="*.tsx" --include="*.ts"

# 空间稳定性违规 (禁止 hover 使用 scale)
grep -rn "scale(1\.[0-9]" src --include="*.ts" --include="*.tsx"
```

### 废弃 Token 别名 (P2)

```bash
# 废弃 Color Token (应迁移到新命名)
# foreground → textPrimary, mutedForeground → textSecondary
# muted → surface, cardForeground → textPrimary
// turbo
grep -rn "\.colors\.\(foreground\|mutedForeground\|muted\|cardForeground\|cardShadow\|borderSubtle\|borderStrong\)" src/ui --include="*.tsx" --include="*.ts" | grep -v design-system

# 映射表:
# foreground      → textPrimary
# mutedForeground → textSecondary
# muted           → surface
# cardForeground  → textPrimary
# cardShadow      → shadow
# borderSubtle    → borderLight
# borderStrong    → borderHover
```

### 安全违规

```bash
# 硬编码密钥 (禁止 API_KEY= 字面量)
grep -rn "API_KEY\s*=" src --include="*.ts"

# console.log 泄露 (禁止生产代码)
grep -rn "console.log" src --include="*.ts" --include="*.tsx"
```

---

## 3️⃣ 检查范围

**必须覆盖**:
- `src/ui/` - UI 组件
- `src/features/` - 功能模块
- `src/services/` - 服务层
- `src/hooks/` - Hooks

**排除**:
- `node_modules/`
- `build/`
- `*.test.*`

---

## 4️⃣ 执行流程

```
┌─────────────────────────────────────────┐
│ 1. 定义禁止模式                          │
│    ↓                                    │
│ 2. grep 搜索全部源码                     │
│    ↓                                    │
│ 3. 按文件分组违规                        │
│    ↓                                    │
│ 4. 生成审计报告                          │
│    ↓                                    │
│ 5. 批量修复 / 逐个修复                   │
└─────────────────────────────────────────┘
```

---

## 5️⃣ 审计报告模板

```markdown
# [项目名] Token Compliance Audit

## 违规汇总

| 类型 | 数量 | 严重性 |
|------|------|--------|
| fontSize 硬编码 | X | P1 |
| borderRadius 硬编码 | X | P2 |
| rgba 硬编码 | X | P3 |
| opacity 硬编码 | X | P3 |
| scale transform | X | P1 |

## 详细列表

### P1: fontSize
| 文件 | 行号 | 违规值 | 修复 |
|------|------|--------|------|
| xxx.tsx | 123 | `fontSize: 10` | `var(--font-size-1)` |

## 修复进度
- [ ] 文件1
- [ ] 文件2
```

---

## 6️⃣ 自动化选项

### ESLint 规则 (可选)

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    // 自定义规则禁止硬编码样式
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Property[key.name="fontSize"][value.type="Literal"]',
        message: '禁止硬编码 fontSize，请使用 CSS 变量'
      }
    ]
  }
};
```

### Pre-commit Hook (可选)

```bash
# .husky/pre-commit
npm run lint
npm run type-check
```

---

## 7️⃣ 检查清单

- [ ] 运行禁止模式搜索
- [ ] 生成审计报告
- [ ] 按 P1/P2/P3 优先级修复
- [ ] 验证修复效果
- [ ] 更新 workflow 添加新发现的禁止模式
