# 布局缺陷修复计划

## 问题摘要

| 缺陷 | 根因 | 优先级 |
|:---|:---|:---:|
| Padding 坍缩 | LLM 输出 `padding: {}`，渲染器未过滤空对象 | P0 |
| Switch 无 Thumb | 意图未触发 Anatomy，PostProcessor 禁用 | P1 |

---

## 变更范围

### P0: 修复 Padding 空对象

#### [MODIFY] [layerRenderer.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts)

**位置**: L124-138

```typescript
// 当前代码
let resolvedPadding = data.props[PROPS.padding];
if (resolvedPadding !== undefined && ...) {
    if (typeof resolvedPadding === 'object' && resolvedPadding !== null) {
        // 空对象 {} 会导致全部变 0
    }
}

// 修复后
const isEmptyObject = (obj: any) => 
    typeof obj === 'object' && obj !== null && Object.keys(obj).length === 0;

if (resolvedPadding !== undefined && !isEmptyObject(resolvedPadding) && ...) {
    // 空对象被跳过，保留默认值
}
```

### P1: 启用 PostProcessor 验证

暂不修改代码。用户确认后启用 `DISABLE_POST_PROCESSOR=false` 进行集成测试。

---

## 验证

1. 构建验证：`npm run build`
2. 功能验证：生成包含 padding 的 Card，确认间距正确
3. 回归测试：确保显式 `paddingTop/Right/...` 仍优先生效
