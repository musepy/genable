/**
 * @file PromptChips.tsx
 * @description 提示词建议 chips - 横向滚动
 * 
 * 语义化架构：
 * - Props 定义建议数据 + 选择回调
 * - 状态控制可见性和可交互性
 * - 使用 card-interactive CSS 类
 */

import { h, ComponentType } from 'preact';
import { tokens } from '../design-system/tokens';
import {
  LayoutDashboard,
  LogIn,
  Settings,
  User,
  FileText,
  ShoppingCart,
  CheckSquare,
  Palette,
  Brain,
  LucideProps,
} from 'lucide-preact';

// Icon mapping from string name to component
const iconMap: Record<string, ComponentType<LucideProps>> = {
  LayoutDashboard,
  LogIn,
  Settings,
  User,
  FileText,
  ShoppingCart,
  CheckSquare,
  Palette,
  Brain,
};

export interface PromptSuggestion {
  icon: string;  // Lucide icon name
  title: string;
  description: string;
}

export interface PromptChipsProps {
  suggestions: readonly PromptSuggestion[];
  onSelect: (title: string) => void;
  visible?: boolean;
  enabled?: boolean;
}

export function PromptChips({
  suggestions,
  onSelect,
  visible = true,
  enabled = true,
}: PromptChipsProps) {
  if (!visible) return null;

  return (
    <div 
      role="listbox" 
      aria-label="Prompt suggestions"
      style={{
        display: 'flex',
        overflowX: 'auto',
        gap: tokens.space[2],
        paddingBottom: 0, // Removed vertical padding
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        marginTop: 0, // Removed top margin
        marginLeft: -tokens.space[3],  // Full-bleed trick (12px)
        marginRight: -tokens.space[3], // Full-bleed trick (12px)
        paddingLeft: tokens.space[3],  // Align back to content
        paddingRight: tokens.space[3], // Scroll targets the edge
        maxWidth: 'calc(100% + 24px)', // Match -12-12
        boxSizing: 'border-box',
      }}
    >
      {suggestions.map((s, i) => {
        const IconComponent = iconMap[s.icon];
        return (
          <button
            key={i}
            role="option"
            aria-selected="false"
            className="card-interactive chip"
            style={{
              flex: '0 0 auto',
              maxWidth: 120,
              background: 'transparent', // P0: De-noise - was tokens.colors.card
              border: 'var(--border-subtle)',
              boxShadow: tokens.colors.shadowSm,
              borderRadius: 'var(--radius-5)', // Unified to 12px
              padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
              cursor: enabled ? 'pointer' : 'default',
              color: enabled ? tokens.colors.textPrimary : tokens.colors.disabledText, // P3: Alpha token
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[1],
              transition: 'var(--transition-crisp)',
            }}
            onClick={() => enabled && onSelect(s.title)}
            aria-disabled={!enabled}
          >
            {IconComponent && <IconComponent size={12} strokeWidth={1.5} />}
            <span style={{ 
              fontSize: 'var(--font-size-1)', 
              fontWeight: tokens.fontWeight.regular, 
              lineHeight: 'var(--typography-line-height-1)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{s.title}</span>
          </button>
        );
      })}
    </div>
  );
}

