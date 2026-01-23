# P0: ResponseSchema 实施计划

> **版本**: 1.1 | **日期**: 2026-01-15 | **状态**: ✅ 已实施
> **遵循**: KERNEL 原则 + Engineering Principles + LLM Debt Guard

> [!NOTE]
> **实施完成**: 递归 Schema 已在 `schema.ts` 中通过 Builder Function 模式实现，替代了原提案中的 `$ref` 方案。详见 `buildNodeSchema()` 函数。

---

## 1. 问题定义 (KERNEL: Know Your Problem)

### 1.1 当前痛点

| 症状 | 根因 | 影响 |
| :-- | :-- | :-- |
| Black Card (颜色渲染失败) | LLM 输出 `$surface-card`，Registry 键为 `surface.card` | UI 渲染为黑色 |
| Token 格式不一致 | LLM 自由生成，无约束 | ACL 层膨胀 |
| PostProcessor 复杂度 | 需要修复 LLM 错误输出 | 维护成本高 |

### 1.2 目标态

```
当前: LLM → 自由文本 → [ACL 翻译] → [PostProcessor 修复] → Render
目标: LLM + Schema → 合法 Token → Render (无需 ACL)
```

---

## 2. 工程原则分析

### 2.1 SOLID 对齐

| 原则 | 当前状态 | responseSchema 后 |
| :-- | :-- | :-- |
| **D (Dependency Inversion)** | ❌ ACL 硬编码翻译规则 | ✅ 依赖 Schema 抽象 |
| **S (Single Responsibility)** | ❌ PostProcessor 同时验证+修复 | ✅ Schema 验证，PostProcessor 仅增强 |
| **O (Open/Closed)** | ❌ 新 Token 需改 ACL 代码 | ✅ 只需改 Schema JSON |

### 2.2 KERNEL 原则检查

| 原则 | 问题 | 解决方案 |
| :-- | :-- | :-- |
| **K (Keep simple)** | ACL 增加复杂度 | responseSchema 移除 ACL |
| **E (Explicit)** | Token 格式隐式约定 | Schema 显式定义 |
| **R (Reduce coupling)** | LLM 输出格式与解析器耦合 | Schema 解耦 |
| **N (No side effects)** | getSemanticFallback 依赖全局状态 | Schema 静态定义 |
| **E (Encapsulate)** | Token 规则分散 | 集中在 Schema |
| **L (Lean on standards)** | 自定义 DSL 格式 | JSON Schema 标准 |

### 2.3 LLM Debt Guard 检查

| 检查项 | 当前状态 | 风险 |
| :-- | :-- | :-- |
| **Schema 缺失字段** | 无 Schema | 400 错误 (新增) |
| **递归结构** | DSL 支持嵌套 children | 需要 `$ref` |
| **Enum 同步** | Registry 手动维护 | 需自动生成 |

---

## 3. 架构设计

### 3.1 Schema 生成器 (`schemaGenerator.ts`)

```typescript
// src/services/schemaGenerator.ts
// 从 Token Registry 自动生成 responseSchema

export function generateDSLSchema(registryId: DesignSystemKey): JSONSchema {
  const registry = TOKEN_REGISTRIES[registryId];
  
  // 提取合法 Token 名称作为 enum
  const colorTokens = Object.keys(registry.semanticFallbacks || {})
    .map(key => `$${key}`);  // ['$background', '$foreground', ...]
  
  const spacingTokens = Object.keys(registry.spacing || {})
    .map(key => `$space-${key}`);  // ['$space-xs', '$space-md', ...]
  
  return {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['FRAME', 'TEXT', 'VECTOR', 'ICON'] },
      props: {
        type: 'object',
        properties: {
          fills: { 
            type: 'array', 
            items: { type: 'string', enum: colorTokens }
          },
          strokes: {
            type: 'array',
            items: { type: 'string', enum: colorTokens }
          },
          gap: { 
            oneOf: [
              { type: 'number' },
              { type: 'string', enum: spacingTokens }
            ]
          },
          padding: {
            oneOf: [
              { type: 'number' },
              { type: 'string', enum: spacingTokens },
              { type: 'object' }  // { top, right, bottom, left }
            ]
          }
          // ... 其他属性
        }
      },
      children: { 
        type: 'array', 
        items: { '$ref': '#' }  // 递归引用
      }
    },
    required: ['type']
  };
}
```

### 3.2 API 调用修改 (`useChat.ts`)

```typescript
// 修改 generateLayoutWithValidation 调用
const generationConfig = {
  responseMimeType: 'application/json',
  responseSchema: generateDSLSchema(designSystemId)
};

const result = await generateLayoutWithValidation(
  systemPrompt,
  userPrompt,
  { 
    apiKey, 
    model: modelName,
    generationConfig  // 新增
  }
);
```

---

## 4. 实施计划

### Phase 1: Schema 生成器 (Day 1)

| 步骤 | 文件 | 改动 |
| :-- | :-- | :-- |
| 1.1 | `src/services/schemaGenerator.ts` | **[NEW]** 创建 Schema 生成器 |
| 1.2 | `src/config/tokens/shadcn.json` | 验证 `semanticFallbacks` 完整性 |
| 1.3 | `src/config/tokens/ios-hig.json` | 补充缺失 Token |
| 1.4 | `src/config/tokens/material3.json` | 添加 `semanticFallbacks` |

### Phase 2: API 集成 (Day 2)

| 步骤 | 文件 | 改动 |
| :-- | :-- | :-- |
| 2.1 | `src/services/gemini.ts` | 添加 `generationConfig` 参数 |
| 2.2 | `src/features/chat/useChat.ts` | 调用 `generateDSLSchema()` |
| 2.3 | 测试 | 验证 Schema 约束生效 |

### Phase 3: ACL 简化 (Day 3)

| 步骤 | 文件 | 改动 |
| :-- | :-- | :-- |
| 3.1 | `src/services/tokenSlot.ts` | 移除 `getSemanticFallback` 复杂逻辑 |
| 3.2 | `src/main.ts` | 简化 `createPaint` fallback |
| 3.3 | `src/services/postProcessor/` | 移除 Token 修复规则 |

---

## 5. 验证计划

### 5.1 自动化测试

```bash
# 验证 Schema 生成
npm run test -- src/services/schemaGenerator.test.ts

# 验证 API 调用
npm run test -- src/services/gemini.test.ts
```

### 5.2 手动验证

1. 生成 Login Card → 检查 `fills` 只包含 `$background` 等合法 Token
2. 故意输入错误 Token → 验证 API 返回 400 错误
3. 切换 Design System → 验证 Schema 动态更新

### 5.3 回归检查

```bash
# 禁止模式搜索 (来自 /code-quality)
grep -rn "SEMANTIC_FALLBACKS" src --include="*.ts"  # 应为 0
grep -rn "surface-card" src --include="*.ts"  # ACL 翻译应减少
```

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解策略 |
| :-- | :-- | :-- |
| Schema 过大超 Token 限制 | API 调用失败 | 动态裁剪低频 Token |
| 递归 `$ref` 不支持 | 嵌套 children 失败 | 降级为内联定义 |
| Enum 同步遗漏 | LLM 输出被拒绝 | 自动化 Registry → Schema 流程 |

---

## 7. 代码质量检查清单

来自 `/code-quality` 和 `/engineering-principles`:

- [ ] **YAGNI**: 只实现当前需要的 Schema 字段
- [ ] **Rule of Three**: Schema 生成器只做一件事
- [ ] **Minimal Diff**: 不重构无关代码
- [ ] **禁止模式**: 不引入新的硬编码 Token
- [ ] **TODO 清理**: 不留下未解决的 TODO

---

## 8. 参考

- [Gemini API Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- [JSON Schema $ref](https://json-schema.org/understanding-json-schema/structuring)
- 本项目: `docs/knowledge/gemini-api-strategy.md`
