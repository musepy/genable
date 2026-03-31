# Schema 验证：SDK tool() 管线 vs Gemini Native

> Date: 2026-03-31
> Index: [Vercel AI SDK 评估](vercel-ai-sdk-evaluation-index.md)
> 聚焦问题：OpenPencil 把 5 种参数类型的校验都交给 SDK 了？如果我们用 SDK，能替代 Gemini native function calling 吗？

---

## 1. OpenPencil 的 Schema 验证管线

OpenPencil 的参数验证走的是这条路：

```
ParamDef（自定义）→ valibot schema → @ai-sdk/valibot → JSON Schema → LLM → SDK 自动验证 → execute
```

具体代码：

```typescript
// ai-adapter.ts — paramToValibot：5 种类型的完整映射
function paramToValibot(v: typeof valibot, param: ParamDef): unknown {
  const typeMap: Record<ParamType, () => unknown> = {
    string:    () => param.enum 
                     ? v.picklist(param.enum)     // 枚举约束
                     : v.string(),
    number:    () => {
      const pipes = [v.number()]
      if (param.min !== undefined) pipes.push(v.minValue(param.min))  // 范围下限
      if (param.max !== undefined) pipes.push(v.maxValue(param.max))  // 范围上限
      return pipes.length > 1 ? v.pipe(...pipes) : v.number()
    },
    boolean:   () => v.boolean(),
    color:     () => v.pipe(v.string(), v.description('Color value (hex like #ff0000)')),
    'string[]': () => v.pipe(v.array(v.string()), v.minLength(1)),  // 非空数组
  }
  
  // 可选参数 + 默认值
  if (!param.required) {
    schema = v.optional(schema, param.default)
  }
  return schema
}
```

然后通过 SDK 注册：

```typescript
// ai-adapter.ts — toolsToAI
const toolOpts = {
  description: def.description,
  inputSchema: valibotSchema(v.object(shape)),  // ← SDK 的 @ai-sdk/valibot 转换
  execute: async (args) => { ... }              // ← SDK 验证通过后才执行
}
result[def.name] = tool(toolOpts)  // ← SDK 的 tool() 注册
```

**关键点**：LLM 返回的参数，在到达 `execute` 之前，已经被 valibot **自动验证**过了。类型不对、范围越界、必填项缺失——都会被 SDK 拦截，LLM 会收到错误提示并重试。

## 2. 我们的方式：Gemini Native Function Calling

我们的工具参数直接以 JSON Schema 的形式传给 Gemini API：

```typescript
// 我们的 ToolDefinition（简化）
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}
```

Gemini 的 native function calling 会：
1. 根据 JSON Schema 格式化输出
2. 保证输出的 JSON 可解析
3. **但不做值域验证**（比如 min/max 范围）

到达我们的 `execute` 时，参数类型基本正确（Gemini 的 structured output 保证），但**值的合理性**没有额外保障。

## 3. 两种方式的真实差异

```
                    Gemini Native           SDK + valibot
                    ─────────────           ─────────────
类型保证              ✅ Gemini 保证          ✅ valibot 验证
必填项                ✅ required 数组        ✅ v.optional() 标记
枚举约束              ✅ enum 字段            ✅ v.picklist()
范围约束(min/max)     ❌ JSON Schema 不强制   ✅ v.minValue/maxValue
默认值                ❌ 需要手动处理          ✅ v.optional(schema, default)
验证失败重试           ❌ 需要自己处理          ✅ SDK 自动重试
description 传递      ✅ 原生支持              ✅ v.description()
多 Provider 兼容      ❌ 仅 Gemini            ✅ 任意 Provider
```

### 核心差异解读

**范围约束**是最有意义的差别。比如 `set_opacity` 工具：

```typescript
// OpenPencil 的定义
defineTool({
  name: 'set_opacity',
  params: {
    id: { type: 'string', required: true },
    value: { type: 'number', required: true, min: 0, max: 1 },  // ← SDK 保证 0-1
  }
})

// 我们的定义
{ name: 'set_opacity', parameters: {
  properties: {
    id: { type: 'string' },
    value: { type: 'number', description: 'Opacity value between 0 and 1' },
    // ← Gemini 只能靠 description 提示，不强制 0-1
  }
}}
```

Gemini 通常会遵守 description 中的范围提示，但**不保证**。SDK + valibot 方案在 execute 之前就会拦截 `value: 1.5` 这种无效输入。

## 4. 如果我们用 SDK，Gemini 的 native function calling 怎么办？

**答案：SDK 替代了 native 的 schema 传递方式，但底层仍然使用 Gemini 的 function calling 能力。**

```
不用 SDK:
  我们 → JSON Schema → Gemini API generateContent({ tools: [...] })
  
用 SDK:
  我们 → valibot/zod schema → SDK tool() → JSON Schema → @ai-sdk/google → Gemini API
```

最终到达 Gemini 的 JSON Schema 是相同的格式。SDK 额外做的是：
1. 在 schema 层面增加了验证逻辑（不只是格式化提示，还有运行时校验）
2. 验证失败时自动将错误信息作为 tool_result 返回给 LLM
3. 统一了不同 Provider 的 schema 格式差异

## 5. 决策影响

| 场景 | 建议 |
|------|------|
| 仅用 Gemini + 参数简单 | Gemini native 够用，不需要 SDK |
| 需要 min/max 范围约束 | SDK + valibot 更可靠 |
| 要支持多 Provider | 必须用 SDK（不同 Provider 的 schema 格式不同） |
| 需要验证失败自动重试 | SDK 内建，自建需要自己实现 retry 逻辑 |

**最务实的选择**：如果决定引入 SDK 的 `ToolLoopAgent`（见 Agent Loop 章节），Schema 验证会自然跟着来，不需要额外决策。它们是绑定的——`tool()` 函数本身就需要 schema。
