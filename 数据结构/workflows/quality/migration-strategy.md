# 迁移策略 (Migration Strategy)

> **核心理念**: 引入新规范时，同时定义如何处理旧代码的计划

---

## 1. 迁移四阶段模型

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  标记    │ →  │  隔离    │ →  │  转换    │ →  │  删除    │
│  Mark    │    │ Isolate  │    │ Convert  │    │  Delete  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
   编辑器         清晰边界         新规范代码        清洁代码库
   警告
```

| 阶段 | 行动 | 产出 | 工具 |
|------|------|------|------|
| **标记** | `@deprecated` 注释 | IDE 警告 | TypeScript, JSDoc |
| **隔离** | 移至 `legacy/` 目录 | 边界清晰 | 文件系统 |
| **转换** | 批量替换或重写 | 符合新规范 | sed, grep, IDE |
| **删除** | 确认无引用后删除 | 代码瘦身 | 引用计数脚本 |

---

## 2. 标记阶段 (Mark)

### TypeScript `@deprecated` 标记

```typescript
/** @deprecated 使用 tokens.fontSize[1] 代替 */
export const fontSize = {
  xs: 10,  // ❌ 已废弃
};
```

### 效果
- VSCode 显示删除线
- 鼠标悬停显示替代方案
- TypeScript 不报错，但有视觉提示

---

## 3. 隔离阶段 (Isolate)

### 目录结构

```
src/
├── ui/
│   ├── design-system/     ← 新规范
│   │   └── tokens/
│   ├── legacy/            ← 遗留代码隔离区
│   │   └── styles.ts      ← 待迁移
│   └── components/
```

### 隔离判断标准

| 条件 | 处理 |
|------|------|
| 违规 ≥10 处 | 整文件移至 `legacy/` |
| 违规 < 10 处 | 原地标记，逐步修复 |
| 无引用 | 直接删除 |

---

## 4. 转换阶段 (Convert)

### 批量替换 (sed)

```bash
# fontSize 硬编码 → Token
sed -i '' 's/fontSize: 12/fontSize: tokens.fontSize[1]/g' src/ui/**/*.ts

# lineHeight 比例 → 像素
sed -i '' 's/lineHeight: 1.4/lineHeight: `${tokens.lineHeight[2]}px`/g' src/ui/**/*.ts
```

### 手动转换检查清单

```markdown
## 转换前
- [ ] 理解当前值的语义 (12px 是 Caption 还是 Body?)
- [ ] 确认对应 Token

## 转换中
- [ ] 替换值
- [ ] 保留功能注释

## 转换后
- [ ] 浏览器验证无回归
- [ ] 运行禁止模式搜索确认清零
```

---

## 5. 删除阶段 (Delete)

### 引用计数脚本

```bash
#!/bin/bash
# dead-code-detector.sh

for export in $(grep "export const" "$1" | awk '{print $3}'); do
  count=$(grep -rn "$export" src/ui --include="*.tsx" | wc -l)
  if [ "$count" -eq 1 ]; then
    echo "🗑️  $export: 仅定义，可删除"
  elif [ "$count" -eq 0 ]; then
    echo "💀 $export: 死代码"
  else
    echo "✅ $export: $count 处引用"
  fi
done
```

### 删除决策

| 引用次数 | 决策 |
|----------|------|
| 0 | 立即删除 |
| 1 (仅定义) | 确认无用后删除 |
| ≥2 | 保留，评估迁移 |

---

## 6. 持续守护机制

### 机制 1: ESLint 规则

```javascript
// .eslintrc.js
'no-restricted-syntax': [
  'error',
  {
    selector: 'Property[key.name="fontSize"][value.type="Literal"]',
    message: '禁止硬编码 fontSize'
  }
]
```

### 机制 2: Pre-commit Hook

```bash
# .husky/pre-commit
npm run lint
grep -rn "fontSize: [0-9]" src/ui --include="*.tsx" && exit 1
```

### 机制 3: CI 检查

```yaml
# .github/workflows/lint.yml
- name: Check style violations
  run: |
    count=$(grep -rn "fontSize: [0-9]" src/ui | wc -l)
    if [ "$count" -gt 0 ]; then exit 1; fi
```

---

## 7. 迁移模板

### 新规范引入时使用

```markdown
## [规范名称] 迁移计划

### 新规范
- 描述新写法

### 旧写法
- 描述禁止的写法

### 迁移步骤
1. [ ] 标记旧代码 `@deprecated`
2. [ ] 运行禁止模式搜索，统计违规数量
3. [ ] 批量转换或手动修复
4. [ ] 验证无回归
5. [ ] 删除废弃代码
6. [ ] 添加 ESLint 规则阻止新违规

### 时间线
- Phase 1: 标记 (今天)
- Phase 2: 转换 (本周)
- Phase 3: 删除 (确认稳定后)
```

---

## 8. 快速命令

```bash
# 统计违规
// turbo
grep -rn "fontSize: [0-9]" src/ui --include="*.tsx" | wc -l

# 按文件分组违规
// turbo
grep -c "fontSize: [0-9]" src/ui/**/*.tsx 2>/dev/null | grep -v ":0$" | sort -t: -k2 -rn

# 运行死代码检测
// turbo
bash .agent/scripts/dead-code-detector.sh src/ui/styles.ts
```
