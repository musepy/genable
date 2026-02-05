---
name: figma-plugin-eng
description: Enforces Figma plugin engineering constraints for Sandbox + Iframe environments, including gesture persistence and layout patterns. Use when developing Figma plugin features, handling Figma API, or solving Iframe issues. Keywords: Figma, plugin, iframe, sandbox, gesture, clipboard.
---

# Figma Plugin Engineering Standards

> **触发时机**: 开发 Figma 插件功能、处理 Figma API、解决 Iframe 环境问题时自动应用

---

## 1. 环境双层约束 (Dual-Layer Constraints)

### 1.1 手势权限持久性 (User Gesture Persistence)
**限制**: 浏览器敏感 API（如剪贴板、文件系统、窗口聚焦）在 Iframe 沙盒中极度依赖"用户手势激活"。
*   **铁律**: 禁止在涉及长时间异步操作（如 `await fetch` 或大型数据处理）后直接发起敏感 API 调用。
*   **最佳实践**: 如果必须在异步后调用，需采用"交互预启动"模式或使用同步 Fallback 方案。

### 1.2 资源预取协议 (Resource Prefetching)
**限制**: UI 层无法实时高效访问 Sandbox 层数据。
*   **铁律**: 在发送数据给 UI 渲染前，必须预解析所有依赖资源（如将图标名转换为 SVG 字符串，将 Variable ID 转换为 Name）。

---

## 2. 交互反馈标准 (Interaction Feedback Standards)

### 2.1 状态机驱动 (State-Machine Driven)
**限制**: 静默执行会导致用户在插件窗口失去焦点或操作失败时产生困惑。
*   **铁律**: 任何产生外部副作用（Side-effects）的组件必须具备声明式的状态管理。
*   **状态模型**: 
    ```typescript
    type InteractionStatus = 'idle' | 'executing' | 'success' | 'error';
    ```
*   **按钮规范**: 按钮严禁只有 `onClick` 逻辑，必须通过 `status` 响应 UI 变化（如 `successLabel`）。

### 2.2 鲁棒性回退方案 (Robust Fallback Pattern)
**限制**: 现代异步 API 在 Iframe/Electron 环境下可能因焦点丢失而失效。
*   **双轨执行**: 针对剪贴板等关键操作，必须提供同步回退方案。
    *   **Level 1 (现代)**: `navigator.clipboard.writeText` (异步，体验好，但易因焦点失效)。
    *   **Level 2 (回退)**: `document.execCommand('copy')` (同步，手势权限持有力强，稳定性极高)。

---

## 3. 代码契约与验证 (Code Contract)

*   **声明式命名**: 描述"当前状态是什么"，而非指令。
*   **解耦逻辑**: 复杂的底层平台 API 封装为 Hooks (如 `useClipboard`, `useFigmaSelection`)。
*   **验证标准**: 任何新功能必须在 Figma Desktop 和 Browser 两个环境验证手势兼容性。

---

## 4. UI/Layout 防坑指南 (UI & Layout Pitfalls)

### 4.1 布局溢出陷阱 (Layout Overflow)
**限制**: Figma 插件运行在 Iframe 中，高度计算易受父容器影响。
*   **反模式**: **禁止使用 `height: 100vh`**。
    *   *后果*: 一旦父容器有 padding/margin，或者 Iframe 自身有微小偏移，Bottom Sheet 或 Footer 会被溢出截断（Button 消失）。
*   **最佳实践**: 使用 `height: 100%` 配合绝对定位 `inset: 0` 锁定视口。
    ```css
    /* Recommended Layout Pattern */
    { position: 'absolute', inset: 0, height: '100%', overflow: 'hidden' }
    ```

### 4.2 样式冲突隔离 (Style Isolation)
**限制**: 第三方 UI 库组件（如 `@create-figma-plugin/ui`）通常自带高优先级内部样式。
*   **反模式**: 仅仅依赖 `style` 属性覆盖第三方组件（如 `<Text>`）的 Token 颜色。
    *   *后果*: 暗色模式下，库组件可能强行应用其默认的 Dark Theme（如纯黑/纯白），通过 Specificity 压倒自定义 Token，导致文字不可见。
*   **最佳实践**: 核心 Token **必须**应用在原生 HTML 元素（`div`/`span`）上，或使用 Wrapper 隔离，完全杜绝第三方样式污染。

---

## 📚 相关参考
*   [Figma Plugin API Documentation](https://www.figma.com/plugin-docs/)
