# 🎯 Figma AI Generator - 测试基础设施建设执行计划

> **目的**: 解决"头疼医头，脚痛医脚"的问题，建立系统性的测试和验证机制
> **创建时间**: 2025-12-24
> **状态**: ✅ 已完成

---

## 📊 当前状态总结

### 已完成的修复
- [x] `MagicNumberWidthCorrection` - 支持 HORIZONTAL + VERTICAL 父容器
- [x] `PrimaryActionInference` - 排除 stat/info/count 节点，使用精确匹配
- [x] `LineDividerCorrection` - 严格匹配，排除 headline/outline/timeline 等
- [x] `renderLayer` - 使用 `layoutAlign = 'STRETCH'` 而非 `layoutGrow = 1`

### 遗留问题
- [ ] 缺乏端到端测试验证
- [ ] 对 Figma API 行为理解不完整
- [ ] PostProcessor 规则的边界情况可能未覆盖

---

## 📋 执行计划

### 阶段 1: Figma API 行为备忘录 (30 min)

**文件**: `docs/figma-api-cheatsheet.md`

**内容**:
1. AutoLayout 属性详解
   - layoutMode (VERTICAL/HORIZONTAL/NONE)
   - layoutAlign (MIN/CENTER/MAX/STRETCH)
   - layoutGrow (0/1)
   - layoutSizingHorizontal (FIXED/HUG/FILL)
   - layoutSizingVertical (FIXED/HUG/FILL)
   - ⚠️ 注意：primaryAxisSizingMode 和 counterAxisSizingMode 已被移除，使用 layoutSizingHorizontal/Vertical 代替
   
2. 属性作用范围表

| 父容器方向 | layoutAlign 影响 | layoutGrow 影响 |
|-----------|-----------------|----------------|
| VERTICAL  | 宽度            | 高度           |
| HORIZONTAL| 高度            | 宽度           |

3. 常见错误及正解
   - 错误: 用 layoutGrow 控制 VERTICAL 父容器中的子元素宽度
   - 正解: 用 layoutAlign = 'STRETCH'

**验证**: 在 Figma 中手动创建测试 frame 验证每种组合

---

### 阶段 2: 隔离渲染测试框架 (1 hour)

**文件**: `scripts/testRenderLogic.ts`

**目标**: 不依赖 Figma 运行时，测试 `renderLayer` 的属性设置逻辑

**实现方案**:
1. 提取 renderLayer 中的属性计算逻辑到独立函数
2. 文件: `src/utils/layoutCalculator.ts`
3. 创建隔离测试脚本

**验证**: `npx tsx scripts/testRenderLogic.ts` 全部通过

---

### 阶段 3: 端到端测试钩子 (45 min)

**目标**: 在 Figma 中运行时验证最终渲染结果

**实现方案**:
1. 在 `main.ts` 添加 validateRenderResult 函数
2. 检查高度不应为 1px (除非是 divider)
3. 检查宽度不应是 magic number (320, 375, 390)
4. 在 UI 设置面板添加 Debug Mode 开关

**验证**: 
1. 开启 Debug Mode
2. 生成一个 Profile Card
3. 控制台应显示任何违规项

---

### 阶段 4: 工业级测试 Prompt 验证 (30 min)

**目标**: 验证 `testPrompts.ts` 中的 15 个 prompt 生成正确结果

**验证矩阵**:
| Prompt | 320px问题 | 1px高度 | Avatar圆角 | Shadow透明度 | 总评 |
|--------|----------|---------|-----------|-------------|------|
| D1: SaaS Dashboard | | | | | |
| D2: E-commerce | | | | | |
| M1: Profile Card | | | | | |

---

## 🔧 关键文件列表

| 文件 | 作用 | 优先级 |
|------|------|--------|
| `docs/figma-api-cheatsheet.md` | API 行为参考 | P0 |
| `src/utils/layoutCalculator.ts` | 提取渲染逻辑 | P1 |
| `scripts/testRenderLogic.ts` | 隔离渲染测试 | P1 |
| `scripts/testPostProcessor.ts` | PostProcessor 测试 (已有) | 维护 |
| `docs/test-results.md` | 测试结果记录 | P2 |

---

## ⚡ 快速恢复指南

**如果上下文丢失，新对话请这样开始**:

```
请阅读以下文件理解当前状态：
1. /Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/docs/execution-plan.md (本文件)
2. /Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/src/main.ts (渲染器)
3. /Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator/src/services/postProcessor.ts (后处理器)

当前任务：继续执行"测试基础设施建设"的阶段 X
```

---

## 📝 变更日志

| 日期 | 变更 | 状态 |
|------|------|------|
| 2025-12-24 | 创建执行计划 | ✅ |
| 2025-12-24 | 修复 layoutGrow → layoutAlign | ✅ |
| 2025-12-24 | 阶段 1: 更新 API 备忘录 (layoutAlign/layoutGrow 关键区分) | ✅ |
| 2025-12-24 | 阶段 2: 创建 `layoutCalculator.ts` + `testRenderLogic.ts` (22 tests passed) | ✅ |
| 2025-12-24 | 阶段 3: 添加 `validateRenderResult` 验证钩子到 `main.ts` | ✅ |
| 2025-12-24 | 阶段 4: 审查 testPrompts.ts (5 测试用例 + 15 工业级 prompt) | ✅ |
