import { colors } from './colors';
import { space } from './spacing';
import { fontSize, fontWeight, lineHeight, font } from './typography';
import { radii, size } from './layout';

// Local tokens alias for easier migration
const tokens = { colors, space, fontSize, fontWeight, lineHeight, radii, font, size };

export const componentStyles = {
  // Chip base - used for prompt chips, model chip, tags
  chipBase: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: tokens.space[1],
    padding: `${tokens.space[1]}px ${tokens.space[4]}px`,
    borderRadius: tokens.radii.full,
    fontSize: tokens.fontSize[1],
    fontWeight: tokens.fontWeight.regular,  // Unified to Regular in Phase 3
    cursor: 'pointer',
    transition: 'var(--transition-crisp, all 150ms ease)',
    whiteSpace: 'nowrap' as const,
  },
  // Card base - used for message bubbles, prompt cards
  cardBase: {
    background: 'var(--color-surface)',
    borderRadius: tokens.radii.lg,
    padding: tokens.space[4],
    boxShadow: 'var(--color-shadow)',
  },
  // Bubble base - for chat messages
  bubbleBase: {
    borderRadius: tokens.radii.lg,
    padding: tokens.space[4],
    maxWidth: '85%',
    fontSize: tokens.fontSize[1],
    lineHeight: tokens.lineHeight[2],
  },
  // Icon button base - for action icons (legacy 32x32)
  iconButtonBase: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: tokens.size.button.md,
    height: tokens.size.button.md,
    borderRadius: tokens.radii.md,
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
      width: tokens.size.button.xs,
      height: tokens.size.button.xs,
      border: 'none',
      borderRadius: tokens.radii.md,
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
      right: tokens.space[1],
      bottom: tokens.space[1],
      width: tokens.size.button.md,
      height: tokens.size.button.md,
      borderRadius: '50%',
      display: 'flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      transition: 'var(--transition-crisp, all 150ms ease)',
    },
    active: {
      background: 'var(--accent-9)',
      border: '1.5px solid var(--accent-9)',
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
      background: tokens.colors.surface,
      border: `var(--border-subtle) solid ${tokens.colors.alpha[4]}`,
      borderRadius: 'var(--radius-5)',
      boxShadow: '0px 0px 0px 0px var(--color-shadow), 0px 8px 32px 0px var(--color-shadow)',
      // 注意：不设置 overflow:hidden，允许内部 Popover 溢出
    },
    textarea: {
      width: '100%',
      minHeight: tokens.space[6] + tokens.space[5], // 32 + 24 = 56
      maxHeight: tokens.space[9] + tokens.space[6] + tokens.space[5], // 64 + 32 + 24 = 120
      paddingTop: tokens.space[2],
      paddingBottom: tokens.space[2],
      paddingLeft: tokens.space[4],
      paddingRight: tokens.space[4],
      fontSize: tokens.fontSize[1],
      background: 'transparent',
      color: 'var(--gray-12)',
      border: 'none',
      outline: 'none',
      resize: 'none' as const,
      fontFamily: tokens.font.sans,
      lineHeight: tokens.lineHeight[2],
      boxSizing: 'border-box' as const,
      transition: 'height 200ms cubic-bezier(0, 0, 0.2, 1)', // Smooth expansion/contraction
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
      gap: tokens.space[1],
      padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
      background: 'transparent',
      border: 'none',
      color: 'var(--gray-11)',
      fontSize: fontSize[1],
      fontWeight: tokens.fontWeight.regular,
      cursor: 'pointer',
      transition: 'var(--transition-crisp)',
      whiteSpace: 'nowrap' as const,
      borderRadius: 'var(--radius-5)', // Standardized to 12px
    },
    chip: {
      display: 'inline-flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: tokens.space[1],
      padding: `0 ${tokens.space[2]}px`,
      height: tokens.size.button.md,
      background: 'transparent',
      color: tokens.colors.textPrimary,
      border: '1px solid transparent',
      borderRadius: 'var(--radius-5)', // Standardized to 12px
      fontSize: tokens.fontSize[1],
      fontWeight: tokens.fontWeight.regular,
      lineHeight: tokens.lineHeight[1],
      cursor: 'pointer',
      transition: 'var(--transition-crisp)',
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
      marginBottom: tokens.space[1],
    },
  },
} as const;
