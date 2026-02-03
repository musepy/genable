# 布局渲染缺陷研究笔记

## 1. 日志异常模式提取

### A. Padding 空对象异常
**来源**: Registration Form trace (HBIJZHQ)
```json
"props": {
  "name": "Text Input",
  "padding": {},  // ❌ 空对象！
  "height": 40,
  ...
}
```
**影响**: 空对象 `{}` 被传递给渲染器，导致 padding 信息丢失。

### B. Switch 结构缺失
**来源**: Settings Panel trace (LNIBG0N)
```json
{
  "name": "Switch",
  "width": 52,
  "height": 32,
  "fills": ["$primary"],
  "semantic": "BUTTON",   // ❌ 错误的 semantic！
  // ❌ 完全没有 children
}
```

---

## 2. 竞争性假设 (已验证)

| ID | 假设 | 置信度 | 状态 |
|:---|:---|:---:|:---:|
| **H-Padding** | 空对象 `{}` 未被正确处理 | 95% | ✅ 已确认 (L131-136) |
| **H-Switch-Query** | 意图检测未触发 'switch' Anatomy | 90% | ✅ 已确认 |
| **H-PostProcessor** | PostProcessor 禁用无法补全 | 95% | ✅ 日志确认 |

---

## 3. 根因定位

### 根因 1: Padding 空对象
**文件**: `layerRenderer.ts:131-136`
```typescript
} else if (typeof resolvedPadding === 'object' && resolvedPadding !== null) {
    const p = resolvedPadding as { top?, right?, bottom?, left? };
    frame.paddingTop = p.top ?? 0;  // 空对象导致全部为 0
}
```
**修复**: 检测空对象并跳过处理。

### 根因 2: Switch 语义检测失败
- `buildStructuralAnatomySection` 仅在 `intent.target` 包含 'switch' 时注入
- 用户 Prompt "Settings Panel with Toggle" 导致 `intent.target = 'Card'`
- Switch 蓝图从未被注入
**修复**: PostProcessor 应能根据 `name` 或其他信号补全 Switch 结构。

---

## 4. 推荐修复

| 优先级 | 修复 | 复杂度 |
|:---:|:---|:---:|
| P0 | 修复 padding 空对象检测 | 低 |
| P1 | 启用 PostProcessor 测试 | 中 |
| P2 | 增强 Switch 后处理规则 | 中 |

