# Plan: DSL Property Normalization Layer

## Problem
整条渲染管线是"被动管线"——LLM 生成的 DSL 属性直接透传到 Figma API，没有集中的校验/纠正层。
各渲染器零星做了一些防御（`Math.max(1, ...)`, enum alias mapping），但不统一、不完整，且 `flatProps` 可绕过上游安全映射。

## Strategy: 扩展 PROP_METADATA + PropertyTransformer

**不新建模块**，而是扩展现有 SSOT 架构：
1. 在 `PROP_METADATA` 中声明 `min`/`max`/`clamp` 规则（数据驱动）
2. 在 `PropertyTransformer.deserialize()` 中执行 clamp（单一咽喉点）
3. 在各渲染器中加入类型特定的 normalization（正方形图标、enum 白名单等）
4. 沙箱化 `flatProps`，防止覆盖安全关键属性

## Changes

### 1. `src/constants/figma-api.ts` — 扩展 PropDefinition + PROP_METADATA

```typescript
export interface PropDefinition {
  readonly figmaKey: string;
  readonly type: 'scalar' | 'color' | 'enum' | 'object' | 'virtual' | 'array' | 'string';
  readonly enumMap?: Record<string, string>;
  readonly defaultValue?: any;
  // NEW: Normalization rules
  readonly min?: number;        // scalar clamp lower bound
  readonly max?: number;        // scalar clamp upper bound
}
```

Add bounds to existing entries:
| Property | min | max | Rationale |
|----------|-----|-----|-----------|
| opacity | 0 | 1 | Figma API range |
| fontSize | 1 | 1000 | Prevent invisible/absurd text |
| strokeWeight | 0 | 100 | Practical max |
| cornerRadius | 0 | 1000 | Practical max |
| gap | 0 | 1000 | Prevent negative spacing |
| paddingTop/Right/Bottom/Left | 0 | 1000 | Prevent negative padding |
| width | 0.01 | 10000 | Figma practical limits |
| height | 0.01 | 10000 | Figma practical limits |
| rotation | -360 | 360 | Full rotation range |
| layoutGrow | 0 | 1 | Figma binary grow |
| letterSpacing | -100 | 1000 | Practical range |
| paragraphSpacing | 0 | 1000 | Non-negative |
| paragraphIndent | 0 | 1000 | Non-negative |
| lineHeight | 0 | 1000 | Non-negative |

### 2. `src/engine/figma-adapter/propertyTransformer.ts` — Clamp in deserialize()

In the `case 'scalar':` branch, after NaN handling, add:

```typescript
case 'scalar': {
  let num: number;
  if (dslValue === null || dslValue === undefined) {
    num = meta.defaultValue ?? 0;
  } else if (typeof dslValue === 'string' && !dslValue.startsWith('$')) {
    const parsed = parseFloat(dslValue);
    num = isNaN(parsed) ? 0 : parsed;
  } else if (typeof dslValue === 'number') {
    num = isNaN(dslValue) ? 0 : dslValue;
  } else {
    return dslValue; // Variable reference ($token)
  }
  // NEW: Bounds clamping from metadata
  if (meta.min !== undefined && num < meta.min) num = meta.min;
  if (meta.max !== undefined && num > meta.max) num = meta.max;
  return num;
}
```

In the `case 'enum':` branch, add whitelist validation:

```typescript
case 'enum': {
  if (meta.enumMap && typeof dslValue === 'string') {
    const mapped = meta.enumMap[dslValue.toUpperCase()];
    if (mapped) return mapped;
    // NEW: Invalid enum → return defaultValue instead of raw input
    console.warn(`[PropertyTransformer] Invalid enum "${dslValue}" for ${dslKey}, using default`);
    return meta.defaultValue ?? dslValue;
  }
  return dslValue;
}
```

### 3. `src/engine/figma-adapter/renderers/iconRenderer.ts` — 强制正方形

In `createNode()`, line 29-30, after destructuring width/height:

```typescript
const { iconName, width: rawW = 24, height: rawH = 24 } = props;
const size = Math.max(rawW, rawH); // Force square
const width = size;
const height = size;
```

### 4. `src/ipc/handlers/toolCallHandler.ts` — flatProps 沙箱化

Add a sanitizer function and apply it to all flatProps merge points:

```typescript
/** Properties that flatProps CANNOT override (safety-critical mappings) */
const PROTECTED_KEYS = new Set(['type']);

function sanitizeFlatProps(flatProps: Record<string, any> | undefined): Record<string, any> {
  if (!flatProps) return {};
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(flatProps)) {
    if (PROTECTED_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}
```

Apply at:
- `createNode` case (~line 130): `...(sanitizeFlatProps(flatProps))`
- `createIcon` case (~line 292): `...(sanitizeFlatProps(flatProps))`
- `batchOperations` nested createNode

For `createIcon` specifically, prevent `flatProps` from splitting width/height:
```typescript
case 'createIcon': {
  const { iconName, size, color, parentId, props: flatProps } = parameters;
  const sanitized = sanitizeFlatProps(flatProps);
  // Remove width/height from flatProps — icon size is controlled by 'size' param only
  delete sanitized.width;
  delete sanitized.height;
  // ...
  props: { iconName, width: size, height: size, fills: color ? [color] : undefined, ...sanitized }
}
```

### 5. Tool Schema 约束 — `src/engine/agent/tools/rendererTools.ts`

Add `minimum`/`maximum` to numeric fields in tool schemas that are missing them (the LLM sees these constraints):

- `createNode` props schema: add `opacity: { minimum: 0, maximum: 1 }`, `fontSize: { minimum: 1 }`, `cornerRadius: { minimum: 0 }`, `strokeWeight: { minimum: 0 }`
- `createIcon` schema: add `size: { minimum: 1, maximum: 1000 }`

These are a soft signal to the LLM; the hard enforcement is in PropertyTransformer.

## Files Modified

1. `src/constants/figma-api.ts` — PropDefinition interface + PROP_METADATA bounds
2. `src/engine/figma-adapter/propertyTransformer.ts` — clamp + enum whitelist in deserialize()
3. `src/engine/figma-adapter/renderers/iconRenderer.ts` — force square
4. `src/ipc/handlers/toolCallHandler.ts` — sanitizeFlatProps()
5. `src/engine/agent/tools/rendererTools.ts` — schema min/max constraints

## Verification

1. **Build**: `npm run build` — no type errors
2. **Existing tests**: `npx vitest run` — all pass
3. **Manual smoke test**:
   - Generate a login form → icons should be square
   - LLM passes `opacity: 5` → clamped to 1
   - LLM passes `fontSize: -10` → clamped to 1
   - flatProps with `width: 999` on icon → ignored, size param wins
4. **New test cases** (optional, not blocking):
   - PropertyTransformer.deserialize() clamp behavior
   - sanitizeFlatProps filtering
