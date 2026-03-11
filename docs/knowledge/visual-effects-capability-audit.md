# Visual Effects Capability Audit

Figma Plugin API 视觉效果能力 vs 我们工具的支持情况。

## Paint 类型（fills/strokes）

| Figma API | 支持？ | LLM 语法 | 备注 |
|---|---|---|---|
| SOLID | ✅ | `fill:'#FF0000'` | — |
| GRADIENT_LINEAR | ⚠️ 部分 | `fill:'GRADIENT_LINEAR(#F00@0,#00F@1)'` | 不支持旋转角度（Transform 固定 identity） |
| GRADIENT_RADIAL | ⚠️ 部分 | `fill:'GRADIENT_RADIAL(...)'` | 同上 |
| GRADIENT_ANGULAR | ⚠️ 部分 | `fill:'GRADIENT_ANGULAR(...)'` | 同上 |
| GRADIENT_DIAMOND | ⚠️ 部分 | `fill:'GRADIENT_DIAMOND(...)'` | 同上 |
| IMAGE | ⚠️ 部分 | `fill:'IMAGE(hash)'` | 有解析，scaleMode 不可控 |

## Effect 类型

| Figma API | 支持？ | LLM 语法 | 备注 |
|---|---|---|---|
| DROP_SHADOW | ✅ | `shadow:'0,4,16,0,#0000001A'` | ox,oy,blur,spread,color |
| INNER_SHADOW | ✅ | `shadow:'inset,0,4,16,0,#000'` | — |
| LAYER_BLUR | ✅ | `shadow:'blur(8)'` | — |
| BACKGROUND_BLUR | ✅ | `shadow:'bgblur(12)'` | — |
| 多重效果 | ✅ | `;` 分隔 | `shadow:'0,4,16,0,#000;blur(4)'` |

## Blend Mode

| Figma API | 支持？ | 备注 |
|---|---|---|
| ~25 种 blend mode | ❌ | 硬编码 NORMAL，LLM 无感知 |

## Stroke 属性

| 属性 | 支持？ | 备注 |
|---|---|---|
| stroke paint | ✅ | `stroke:'#D1D5DB'` |
| strokeWeight | ✅ | `strokeW:1` |
| strokeAlign | ✅ | `strokeA:'INSIDE'` |
| strokeDashPattern | ❌ | 虚线 |
| strokeLineCap/Join | ❌ | 端点/接合 |

## 其他视觉属性

| 属性 | 支持？ | 备注 |
|---|---|---|
| opacity | ✅ | defaultHandler 直接赋值 |
| cornerRadius（统一） | ✅ | `corner:12` |
| cornerRadius（独立） | ✅ 底层 | LLM 不知道 `corner:'16 16 0 0'` 语法 |
| visible | ❌ | 不暴露给 LLM |
| blendMode | ❌ | 不暴露给 LLM |

## 已发现的 Bug / 路径问题

### 1. `bg` 路径跳过 paintSpec 解析

```
bg:'linear-gradient(...)'
  → ABBREV: background:'linear-gradient(...)'
  → normalizeProps: fills = ['linear-gradient(...)']   ← raw string, 未经 paintSpec.parseXml()
  → paintHandler → lowerPaints → parseSinglePaintXml → 不匹配任何格式 → 静默失败
```

**对比**：`fill`/`fills` key 在 flatOpsParser/xml-interpreter 中会显式调 `paintSpec.parseXml()`，`bg` 走 normalizeProps 时直接赋值为 string array。

### 2. CSS gradient 语法不支持

LLM 天然写 `linear-gradient(135deg, #7C3AED, #4F46E5)`，但 paintSpec 只认 `GRADIENT_LINEAR(#color@pos,...)`。需要在 `paintSpec.parseXml` 增加 CSS gradient 语法识别。

### 3. Gradient transform 缺失

`gradientTransform` 固定为 identity `[[1,0,0],[0,1,0]]`。角度信息（如 135deg）即使解析了也无法应用。需要角度→2x3 仿射矩阵转换。

## 修复优先级建议

1. **P0**: 修复 `bg` 路径 — normalizeProps 中 `background → fills` 时应调 `paintSpec.parseXml()`
2. **P1**: 增加 CSS gradient 语法支持 — `paintSpec.parseXml` 识别 `linear-gradient()` 等
3. **P1**: Gradient transform — 角度→矩阵转换，让渐变方向可控
4. **P2**: 暴露更多能力 — blend mode、individual corner radius、visible
5. **P3**: Stroke 扩展 — dash pattern、line cap/join

## 关键文件

- Paint/Effect Specs: `src/domain/property-specs.ts`
- Design IR: `src/domain/design-ir.ts`
- Node Normalizers: `src/domain/node-normalizers.ts` (background→fills 转换)
- Figma Lowering: `src/engine/figma/figma-lowering.ts`
- Flat Ops Parser: `src/engine/flat/flatOpsParser.ts` (buildProps)
- XML Interpreter: `src/engine/xml/xml-interpreter.ts` (buildProps)
- Handler Registry: `src/engine/actions/handlers/`
- Tool Definition: `src/engine/agent/tools/unified/design.ts`
