import { colors } from './colors';
import { space } from './spacing';
import { fontSize, fontWeight, lineHeight, font } from './typography';
import { radii } from './layout';

// Local tokens alias for easier migration
const tokens = { colors, space, fontSize, fontWeight, lineHeight, radii, font };

export const componentStyles = {
  // Chip base - used for prompt chips, model chip, tags
  chipBase: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: 4,  // tokens.space.xs
    padding: '4px 16px',  // xs md
    borderRadius: '9999px',  // tokens.radii.full
    fontSize: 12,  // tokens.fontSize.sm
    fontWeight: tokens.fontWeight.medium,  // tokens.fontWeight.medium
    cursor: 'pointer',
    transition: 'var(--transition-crisp, all 150ms ease)',
    whiteSpace: 'nowrap' as const,
  },
  // Card base - used for message bubbles, prompt cards
  cardBase: {
    background: 'var(--color-surface)',
    borderRadius: '12px',  // tokens.radii.lg
    padding: 16,  // tokens.space.md
    boxShadow: 'var(--color-shadow)',
  },
  // Bubble base - for chat messages
  bubbleBase: {
    borderRadius: '12px',  // tokens.radii.lg
    padding: 16,  // tokens.space.md
    maxWidth: '85%',
    fontSize: 12,
    lineHeight: tokens.lineHeight[2],
  },
  // Icon button base - for action icons (legacy 32x32)
  iconButtonBase: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: 32,
    height: 32,
    borderRadius: '8px',  // tokens.radii.md
    border: 'none',
    cursor: 'pointer',
    transition: 'var(--transition-crisp, opacity 150ms ease)',
  },
  
  // ========================================
  // NEW: Semantic component styles (P1)
  // ========================================
  
  /**
   * Icon Button - 28x28 统一尺寸
   * 用于：New Chat、主题切换等图标按钮
   * 状态通过 CSS 类控制：.icon-btn, .icon-btn.disabled, .icon-btn.hidden
   */
  iconButton: {
    base: {
      display: 'inline-flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      width: 28,
      height: 28,
      border: 'none',
      borderRadius: 'var(--radius-md)',
      background: 'transparent',
      cursor: 'pointer',
      transition: 'var(--transition-crisp, opacity 150ms ease)',
    },
  },
  
  /**
   * Submit Button - 输入框内圆形提交按钮
   * 两种状态：active（可点击）、disabled（禁用）
   */
  submitButton: {
    base: {
      position: 'absolute' as const,
      right: 6,
      bottom: 6,
      width: 28,
      height: 28,
      borderRadius: '50%',
      display: 'flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      transition: 'var(--transition-crisp, all 150ms ease)',
    },
    active: {
      background: 'var(--gray-12)',
      border: '1.5px solid var(--gray-12)',
      cursor: 'pointer',
    },
    // 禁用态：容器用 border 色，图标用 card 色，形成“镂空”效果
    disabled: {
      background: 'var(--gray-a4)', // P3: Alpha token replaces solid color
      border: 'none',
      cursor: 'default',
      // opacity removed - using alpha background instead
    },
  },
  
  /**
   * Input Area - 输入区域容器 + 文本域
   * Claude 风格：圆角容器内嵌输入框
   */
  inputArea: {
    container: {
      position: 'relative' as const,
      background: 'var(--color-surface)',
      border: '1px solid var(--gray-6)',
      borderRadius: 'var(--radius-lg)',
      // 注意：不设置 overflow:hidden，允许内部 Popover 溢出
    },
    textarea: {
      width: '100%',
      minHeight: 56,
      maxHeight: 120,
      padding: '10px 12px',
      paddingRight: 40,  // 为提交按钮留空间
      paddingBottom: 36, // 确保滚动到底时内容不被按钮遮挡
      fontSize: 12,
      background: 'transparent',
      color: 'var(--gray-12)',
      border: 'none',
      outline: 'none',
      resize: 'none' as const,
      fontFamily: 'var(--font-sans, Inter, -apple-system, sans-serif)',
      lineHeight: tokens.lineHeight[2],
      boxSizing: 'border-box' as const,
    },
  },
  
  /**
   * Model Selector - 模型选择器样式变体
   * ghost: 极简无边框（Antigravity 风格，用于输入区域左下角）
   * chip: 标签样式（Header 用，保留兼容）
   */
  modelSelector: {
    ghost: {
      display: 'inline-flex' as const,
      alignItems: 'center' as const,
      gap: 4,
      padding: '4px 8px',
      background: 'transparent',
      border: 'none',
      color: 'var(--gray-11)',
      fontSize: 11,
      fontWeight: tokens.fontWeight.medium,
      cursor: 'pointer',
      transition: 'var(--transition-crisp)',
      whiteSpace: 'nowrap' as const,
      borderRadius: 'var(--radius-md)',
    },
    // Hover 状态：添加背景色
    ghostHover: {
      background: 'var(--gray-3)',
      color: 'var(--gray-12)',
    },
    // Popover 向上弹出的定位
    popoverTop: {
      bottom: '100%',
      top: 'auto',
      marginBottom: 4,
    },
  },
} as const;
