# Figma 插件 Preview 环境工程规范

> **核心问题**：`position: fixed` 在 Chrome Preview 与真实 Figma 环境中行为不同。

---

## 问题根因

| 环境 | `position: fixed` 行为 | 原因 |
|:---|:---|:---|
| **真实 Figma 插件** | 相对于**插件窗口**定位 | 插件运行在独立 iframe 中，iframe 是 fixed 的 containing block |
| **Chrome Preview** | 相对于**浏览器视口**定位 | 插件 UI 嵌套在 `#app` 容器中，但 fixed 默认穿透到 viewport |

**典型错误表现**：Toast 通知跑到 Preview 容器外面，贴在浏览器窗口边缘。

---

## 解决方案：`transform: translateZ(0)`

在 `preview/index.html` 的 `#app` 容器上添加：

```css
#app {
  transform: translateZ(0); /* 创建新的堆叠上下文 */
}
```

**原理**：CSS 规范规定，当元素有 `transform` 属性时，它会成为 `position: fixed` 子元素的 containing block。这模拟了 Figma iframe 的隔离效果。

---

## 开发规范

### ✅ 正确做法

1. **Preview 环境已配置 `transform: translateZ(0)`**  
   无需修改组件代码，`position: fixed` 会自动相对于 `#app` 定位。

2. **组件尺寸使用 `100%` 而非 `100vh`**  
   `100vh` 指浏览器视口高度，在嵌套容器中会导致溢出。

3. **Toast/Modal 使用 `position: fixed`**  
   在正确配置的 Preview 中可以正常工作，无需改为 `absolute`。

### ❌ 错误做法

1. **在组件中写死 `100vh`** → 会溢出 Preview 容器
2. **为 Preview 兼容性改用 `position: absolute`** → 可能破坏 flex 布局
3. **在 ToastProvider 添加 `position: relative` wrapper** → 会破坏子组件的 flex 布局

---

## 测试能力边界

| 环境 | LLM 自动化能力 | 备注 |
|:---|:---|:---|
| Chrome Preview (`localhost:5173`) | ✅ 可通过 Browser Subagent 操作 | 自动化测试 |
| Figma Desktop 插件 | ❌ 无法控制原生应用 | 需用户手动验证 |

---

## Preview 配置参考

```html
<!-- preview/index.html -->
<style>
  #app {
    height: calc(100% - 33px);
    overflow: hidden;
    position: relative;
    transform: translateZ(0); /* CRITICAL: 模拟 Figma iframe 行为 */
  }
  
  /* 强制插件根容器适应父容器 */
  #app > div {
    height: 100% !important;
  }
</style>
```

---

## 相关文件

- `preview/index.html` - Preview 环境配置
- `src/ui/styles.ts` - 插件根容器样式 (`containerStyle`)
- `src/ui/components/ui/Toast.tsx` - Toast 使用 `position: fixed`
