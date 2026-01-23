---
description: 端到端用户体验测试 - 模拟真实用户交互验证 UX 设计
---

# E2E UX Testing Workflow

基于真实用户旅程的端到端体验测试方法论。

## 核心理念

> **测试用户感知的体验，而非组件的技术实现。**

| 维度 | 单元测试 | E2E UX 测试 |
|------|----------|-------------|
| 验证目标 | 函数逻辑正确性 | 用户感知的反馈 |
| 覆盖范围 | 孤立组件 | 完整交互链路 |
| 工具 | Jest / Vitest | Browser Subagent |
| 适用场景 | 算法、工具函数 | Onboarding、核心流程 |

---

## 测试设计原则

### 1. 识别交互设计决策

在测试前，先阅读代码识别关键的 UX 机制：

```typescript
// 示例：识别 debounce 机制
const debouncedValue = useDebounce(value, 800);

// 示例：识别自动触发条件
if (debouncedValue && debouncedValue.length >= 20) {
  onValidate();
}
```

**提取的测试点**：
- 防抖时间是否符合预期 (~800ms)
- 自动验证是否在正确时机触发
- 用户无需手动点击验证按钮

### 2. 基于 UX 原则设计验证点

| UX 原则 | 验证内容 |
|---------|----------|
| **状态可见性** | 加载动画是否出现？错误提示是否清晰？ |
| **渐进式反馈** | 输入 → 等待 → 加载 → 结果 的流程是否流畅？ |
| **错误预防** | 防抖是否避免了频繁请求？ |
| **完成确认** | 操作成功后是否有 Toast/反馈？ |
| **可逆性** | 用户能否撤销或修改操作？ |

### 3. 模拟真实用户物料

使用真实格式的测试数据，而非明显的占位符：

```
✅ 好：AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I
❌ 差：test-api-key-12345
```

---

## 执行步骤

### Step 1: 启动预览环境

```bash
# // turbo
npm run preview
```

确保 `http://localhost:5173/` 可访问。

### Step 2: 分析目标组件代码

阅读要测试的组件，识别：
- [ ] 状态管理逻辑 (useState, useEffect)
- [ ] 异步操作 (fetch, debounce)
- [ ] 用户反馈机制 (loading, error, success)
- [ ] 边界条件 (空值、长度限制、格式校验)

### Step 3: 设计用户旅程脚本

定义完整的用户故事：

```
用户故事：首次配置 API 密钥
1. 点击设置图标
2. 输入有效的 API 密钥
3. 等待系统自动验证
4. 选择模型
5. 保存设置
6. 返回主界面确认生效
```

### Step 4: 执行浏览器模拟

使用 `browser_subagent` 工具执行交互：

```
Task: Navigate to http://localhost:5173/

1. Find and click the Settings button
2. Locate the API Key input field
3. Enter: [真实格式的测试数据]
4. Wait for debounce (~1 second)
5. Observe loading indicators and model list
6. Select a model
7. Click Save button

Return report on:
- UI elements found
- Input experience and feedback
- Async operation results
- Error handling
- Overall UX observations
```

### Step 5: 记录与分析

测试完成后生成报告：

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 设置入口可发现 | ✅/❌ | |
| 输入反馈及时 | ✅/❌ | |
| 加载状态可见 | ✅/❌ | |
| 错误提示清晰 | ✅/❌ | |
| 成功确认明确 | ✅/❌ | |
| 状态持久化正确 | ✅/❌ | |

---

## 测试场景模板

### 场景 A: Onboarding 首次设置

```
前置条件：无已保存配置
用户目标：完成初始设置并开始使用
关键路径：设置 → 验证 → 保存 → 首次使用
验证重点：引导是否清晰、错误恢复是否容易
```

### 场景 B: 错误恢复

```
前置条件：输入无效数据
用户目标：理解问题并修正
关键路径：输入错误 → 看到提示 → 修正 → 成功
验证重点：错误信息是否可操作、状态是否正确重置
```

### 场景 C: 配置变更

```
前置条件：已有有效配置
用户目标：更换 API 密钥或模型
关键路径：打开设置 → 修改 → 保存 → 确认生效
验证重点：旧状态是否正确清除、新配置是否立即生效
```

---

## 录屏与文档

浏览器模拟会自动生成 WebP 录屏文件：

```
api_key_input_flow_1767693111946.webp
```

可嵌入 walkthrough 或 issue 报告中作为可视化证据。

---

## 参考资源

- [Nielsen's 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Material Design 3 - Interaction States](https://m3.material.io/)
