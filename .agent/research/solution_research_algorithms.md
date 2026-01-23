# 解决方案研究：数据结构与算法

> **来源**: Exa + Context7 MCP 检索  
> **更新**: 2026-01-21 15:10

---

## 一、Effects Offset 格式问题

### 1.1 问题定位
LLM 输出:
```json
"offset": [0, 4]  // ❌ 数组格式
```

Figma API 期望 (Context7 确认):
```typescript
interface Vector {
  readonly x: number
  readonly y: number
}
// DropShadowEffect.offset: Vector
```

### 1.2 解决方案：格式转换器

```typescript
// 算法：数组→Vector 转换
function normalizeOffset(offset: unknown): Vector | undefined {
  if (Array.isArray(offset) && offset.length === 2) {
    return { x: offset[0], y: offset[1] };
  }
  if (typeof offset === 'object' && offset !== null && 'x' in offset) {
    return offset as Vector;
  }
  return undefined;
}
```

**时间复杂度**: O(1)  
**实施位置**: `sanitizeLayer()` 或 `layerRenderer.ts`

---

## 二、空对象/空数组处理

### 2.1 最佳实践 (Exa 检索)

```typescript
// ✅ 正确
{ "tags": [], "padding": 12 }

// ❌ 错误
{ "tags": null, "padding": {} }
```

### 2.2 已实施算法

```typescript
const isEmptyObject = (obj: any): boolean => 
  typeof obj === 'object' && 
  obj !== null && 
  !Array.isArray(obj) && 
  Object.keys(obj).length === 0;

// 跳过空对象
if (!isEmptyObject(resolvedPadding)) { ... }
```

---

## 三、LLM 结构化输出容错

### 3.1 Gemini 最佳实践 (Exa 检索)

```typescript
// ✅ 推荐：直接使用 structured output
const response = gemini_structured_json_response(prompt, schema);
if ("error" in response) {
  throw new Error(`Gemini error: ${response.error}`);
}

// ❌ 避免：fallback 到文本解析
```

### 3.2 Zod 转换模式

```typescript
import { z } from "zod";

const effectSchema = z.object({
  type: z.literal("DROP_SHADOW"),
  offset: z.union([
    z.tuple([z.number(), z.number()]).transform(([x, y]) => ({ x, y })),
    z.object({ x: z.number(), y: z.number() })
  ]),
  radius: z.number().min(0),
  color: z.string()
});
```

---

## 四、假设与置信度

| ID | 假设 | 置信度 | 来源 |
|:---|:---|:---:|:---|
| H-Effects-1 | offset 数组→对象转换可解决渲染错误 | 95% | Context7 API 文档 |
| H-Padding-1 | 空对象跳过策略已验证有效 | 90% | 构建 + 功能测试 |
| H-Zod | Zod 转换可统一处理多格式输入 | 80% | Exa 代码示例 |

---

## 五、实施优先级

| P | 任务 | 复杂度 | 文件 |
|:---:|:---|:---:|:---|
| P0 | Effects offset 转换 | 低 | `layerRenderer.ts` |
| P1 | 统一格式转换层 | 中 | 新建 `normalizeProps.ts` |
| P2 | Zod Schema 验证 | 中 | 可选，需评估 Bundle 影响 |
