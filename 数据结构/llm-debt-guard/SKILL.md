---
name: llm-debt-guard
description: LLM technical debt prevention - quality constraints before code generation. Use when writing async/state code, creating data fetching logic, or implementing conditional rendering. Keywords: loading state, error handling, TODO, async, useState, useEffect.
---

# LLM 技术债防御 Workflow

> **核心原则**: 阻止 LLM 生成"能跑但脆弱"的代码

---

## 1️⃣ 生成前检查清单

在写任何异步/状态相关代码前，必须确认：

| 检查项 | 问题 | 正确做法 |
|--------|------|----------|
| **Loading 状态** | 异步操作期间 UI 显示什么？ | 添加 `isLoading` 状态 |
| **初始化状态** | 数据加载前是否有默认值闪烁？ | 添加 `isInitialized` 状态 |
| **错误边界** | 异步失败时显示什么？ | 添加 `error` 状态和 UI |
| **TODO 清理** | 是否写了 TODO 未解决？ | 禁止提交含 TODO 的"完成"代码 |

---

## 2️⃣ 代码生成模板

### 异步状态管理模板

```tsx
// ✅ 正确模式：三态管理
function useAsyncData() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);  // 关键：初始为 true
  const [error, setError] = useState(null);
  
  useEffect(() => {
    fetchData()
      .then(setData)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);
  
  return { data, isLoading, error };
}

// ❌ 错误模式：无 Loading 状态
function useBadAsyncData() {
  const [data, setData] = useState(null); // 初始 null 导致闪烁
  useEffect(() => { fetchData().then(setData); }, []);
  return data;
}
```

### 条件渲染模板

```tsx
// ✅ 正确：先判断初始化，再判断配置
function App() {
  const { isInitialized, hasConfig, data } = useAppState();
  
  if (!isInitialized) return <LoadingSpinner />;
  if (!hasConfig) return <Onboarding />;
  return <MainContent data={data} />;
}

// ❌ 错误：无初始化检查
function BadApp() {
  const { hasConfig, data } = useAppState(); // hasConfig 默认 false
  if (!hasConfig) return <Onboarding />;     // 短暂闪烁
  return <MainContent data={data} />;
}
```

---

## 3️⃣ 禁止模式

| 模式 | 示例 | 为什么禁止 |
|------|------|------------|
| **Brutal Reset** | `window.location.reload()` | 丢失状态，导致闪烁 |
| **无 Loading** | `useState(false)` + 异步判断 | 初始值导致错误 UI |
| **TODO 残留** | `// TODO: handle error` | 被遗忘的技术债 |
| **魔法数字** | `setTimeout(() => {}, 300)` | 隐藏问题而非解决 |

---

## 4️⃣ 代码审查检查点

在 PR/代码完成前运行检查脚本：

```bash
# Run the pre-commit checks script
.agent/skills/llm-debt-guard/scripts/pre-commit-checks.sh src
```

或手动运行单个检查：

```bash
# 检查 TODO 残留
grep -rn "TODO\|FIXME\|HACK" src --include="*.ts" --include="*.tsx" | head -20

# 检查 window.location 滥用
grep -rn "window.location" src --include="*.ts" --include="*.tsx"
```

---

## 5️⃣ 何时应用此 Workflow

- 写任何 `useEffect` + `useState` 组合时
- 创建数据获取逻辑时
- 实现条件渲染时
- 处理用户触发的重置/刷新时
