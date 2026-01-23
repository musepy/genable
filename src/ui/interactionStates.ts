/**
 * @file interactionStates.ts
 * @description Semantic state management for UI interactions
 * 
 * 核心理念：声明式 (Declarative) 而非命令式 (Imperative)
 * - 状态机定义所有可能的 UI 状态
 * - 元素行为表声明每个元素在每种状态下的表现
 * - 组件只需读取状态，不需要内联条件判断
 * 
 * 参考：
 * - Material Design 3: States (enabled, hovered, focused, pressed, disabled)
 * - Radix UI: WAI-ARIA accessibility patterns
 * - Apple HIG: State transitions and feedback
 */

// ============================================
// PLUGIN STATE MACHINE
// ============================================

/**
 * Plugin UI States
 * 
 * EMPTY:   初始状态，无历史记录，无输入
 * TYPING:  用户正在输入（有内容但未提交）
 * LOADING: 正在生成设计
 * RESULT:  有历史记录（已完成至少一次生成）
 */
export type PluginState = 'EMPTY' | 'TYPING' | 'LOADING' | 'RESULT';

/**
 * 派生当前 Plugin 状态
 * 
 * 状态转换图：
 * ```
 * EMPTY ──(输入文字)──▶ TYPING ──(提交)──▶ LOADING ──(完成)──▶ RESULT
 *   ▲                                                            │
 *   └─────────────────(新建对话)─────────────────────────────────┘
 * ```
 */
export function derivePluginState(ctx: {
  historyLength: number;
  loading: boolean;
  hasInput: boolean;
}): PluginState {
  if (ctx.loading) return 'LOADING';
  if (ctx.historyLength > 0) return 'RESULT';
  if (ctx.hasInput) return 'TYPING';
  return 'EMPTY';
}

// ============================================
// ELEMENT STATE DECLARATIONS
// ============================================

/**
 * 元素状态定义
 */
export interface ElementState {
  /** 是否可见 */
  visible: boolean;
  /** 是否可交互 */
  enabled: boolean;
}

/**
 * 元素状态声明表
 * 
 * 每个 UI 元素在每种 PluginState 下的行为
 * 遵循 Material Design 3 States 规范
 */
export const ELEMENT_STATES: Record<string, Record<PluginState, ElementState>> = {
  // New Chat 按钮 (右上角 +)
  newChatButton: {
    EMPTY:   { visible: false, enabled: false },
    TYPING:  { visible: false, enabled: false },
    LOADING: { visible: true,  enabled: false },  // 关键：Loading 时可见但禁用
    RESULT:  { visible: true,  enabled: true },
  },
  
  // Settings 芯片 (模型选择)
  settingsChip: {
    EMPTY:   { visible: true, enabled: true },
    TYPING:  { visible: true, enabled: true },
    LOADING: { visible: true, enabled: false },  // Loading 时禁用
    RESULT:  { visible: true, enabled: true },
  },
  
  // Prompt Chips (建议提示)
  promptChips: {
    EMPTY:   { visible: true, enabled: true },
    TYPING:  { visible: true, enabled: true },
    LOADING: { visible: false, enabled: false },  // Loading 时隐藏
    RESULT:  { visible: true, enabled: true },
  },
  
  // 提交按钮
  submitButton: {
    EMPTY:   { visible: true, enabled: false },  // 无输入时禁用
    TYPING:  { visible: true, enabled: true },
    LOADING: { visible: true, enabled: false },  // Loading 时禁用
    RESULT:  { visible: true, enabled: true },   // 取决于是否有新输入
  },
  
  // 文本输入框
  textarea: {
    EMPTY:   { visible: true, enabled: true },
    TYPING:  { visible: true, enabled: true },
    LOADING: { visible: true, enabled: false },  // Loading 时只读
    RESULT:  { visible: true, enabled: true },
  },
  
  // 主题切换
  themeToggle: {
    EMPTY:   { visible: true, enabled: true },
    TYPING:  { visible: true, enabled: true },
    LOADING: { visible: true, enabled: true },   // 始终可用
    RESULT:  { visible: true, enabled: true },
  },
} as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * 获取元素在当前状态下的行为
 */
export function getElementState(
  elementName: keyof typeof ELEMENT_STATES,
  pluginState: PluginState
): ElementState {
  return ELEMENT_STATES[elementName][pluginState];
}

/**
 * 检查元素是否可见
 */
export function isVisible(
  elementName: keyof typeof ELEMENT_STATES,
  pluginState: PluginState
): boolean {
  return ELEMENT_STATES[elementName][pluginState].visible;
}

/**
 * 检查元素是否可交互
 */
export function isEnabled(
  elementName: keyof typeof ELEMENT_STATES,
  pluginState: PluginState
): boolean {
  return ELEMENT_STATES[elementName][pluginState].enabled;
}

// ============================================
// BUTTON STATES (Material Design 3)
// ============================================

/**
 * 按钮状态 (遵循 Material Design 3)
 */
export type ButtonState = 'enabled' | 'hovered' | 'focused' | 'pressed' | 'disabled';

/**
 * 派生按钮状态
 */
export function deriveButtonState(props: {
  disabled?: boolean;
  hovered?: boolean;
  focused?: boolean;
  pressed?: boolean;
}): ButtonState {
  if (props.disabled) return 'disabled';
  if (props.pressed) return 'pressed';
  if (props.focused) return 'focused';
  if (props.hovered) return 'hovered';
  return 'enabled';
}

// ============================================
// ACCESSIBILITY (WAI-ARIA)
// ============================================

/**
 * 生成 WAI-ARIA 属性
 * 
 * 参考 Radix UI Accessibility:
 * - aria-disabled: 元素在语义上禁用但仍可获得焦点
 * - aria-busy: 元素正在更新
 * - aria-live: 动态内容区域
 */
export function getAriaProps(
  elementName: keyof typeof ELEMENT_STATES,
  pluginState: PluginState,
  loading?: boolean
): Record<string, string | boolean | undefined> {
  const state = getElementState(elementName, pluginState);
  
  return {
    'aria-disabled': !state.enabled ? true : undefined,
    'aria-busy': loading ? true : undefined,
  };
}

/**
 * 提交按钮的特殊 ARIA 属性
 */
export function getSubmitAriaProps(
  pluginState: PluginState,
  hasInput: boolean
): Record<string, string | boolean | undefined> {
  const canSubmit = pluginState !== 'LOADING' && hasInput;
  
  return {
    'aria-disabled': !canSubmit ? true : undefined,
    'aria-busy': pluginState === 'LOADING' ? true : undefined,
  };
}
