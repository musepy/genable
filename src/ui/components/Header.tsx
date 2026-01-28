/**
 * @file Header.tsx
 * @description 插件顶部栏组件 - New Chat + 主题切换
 * 
 * P4 布局重构：移除 Model 选择器（已移至 Input Area 左下角）
 * 语义化架构：状态通过 CSS 类控制 (.icon-btn.disabled/.hidden)
 */

import { h } from 'preact';
import { Plus, Settings, Sun, Moon, Braces } from 'lucide-preact';
import { emit } from '@create-figma-plugin/utilities';
import { ImportJsonHandler } from '../../types';
import { tokens, componentStyles } from '../design-system/tokens';
import { headerStyle } from '../styles';
import { t } from '../i18n';

export interface HeaderProps {
  // Theme
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: () => void;
  // New Chat
  onNewChat: () => void;
  newChatVisible: boolean;
  newChatEnabled: boolean;
  // Settings
  onSettingsClick: () => void;
}

export function Header({
  theme,
  onToggleTheme,
  onNewChat,
  newChatVisible,
  newChatEnabled,
  onSettingsClick,
}: HeaderProps) {
  
  // Derive CSS class for new chat button
  const getIconBtnClass = (visible: boolean, enabled: boolean): string => {
    if (!visible) return 'icon-btn hidden';
    if (!enabled) return 'icon-btn disabled';
    return 'icon-btn';
  };

  return (
    <div style={headerStyle}>
      {/* New Design button - chip 风格：边框 + hover fill */}
      <button 
        className={getIconBtnClass(newChatVisible, newChatEnabled)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: tokens.space[1],
          padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
          background: tokens.colors.surface, // Migrated from colors.card
          color: tokens.colors.textPrimary,
          border: `1px solid ${tokens.colors.grayBorder}`,
          borderRadius: 'var(--radius-full)',
          fontSize: tokens.fontSize[1],
          fontWeight: tokens.fontWeight.medium,
          cursor: newChatEnabled ? 'pointer' : 'default',
          transition: 'var(--transition-crisp)',
        }}
        onClick={onNewChat}
        onMouseEnter={(e) => {
          if (newChatEnabled) {
            e.currentTarget.style.background = tokens.colors.surface;
            e.currentTarget.style.borderColor = tokens.colors.grayBorderHover;
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = tokens.colors.surface;
          e.currentTarget.style.borderColor = tokens.colors.grayBorder;
        }}
        aria-label={t.newDesign}
        aria-disabled={!newChatEnabled}
      >
        <Plus size={12} strokeWidth={2.5} />
        <span>{t.newDesign}</span>
      </button>
      
      {/* Spacer */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: tokens.space[2] }}>
        <div style={{
          fontSize: '10px',
          fontWeight: 700,
          color: tokens.colors.accent,
          background: tokens.colors.surface,
          padding: '2px 6px',
          borderRadius: 'var(--radius-1)',
          border: `1px solid ${tokens.colors.grayBorder}`,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          opacity: 0.8
        }}>
          🧪 Dogfood
        </div>
      </div>

      {/* Dogfood Tools */}
      <div style={{ display: 'flex', gap: tokens.space[1], marginRight: tokens.space[1] }}>
        <button
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: tokens.colors.textSecondary,
            border: 'none',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            transition: 'var(--transition-crisp)',
          }}
          onClick={() => emit<import('../../types').SerializeSelectionHandler>('SERIALIZE_SELECTION')}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = tokens.colors.surface;
            e.currentTarget.style.color = tokens.colors.textPrimary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = tokens.colors.textSecondary;
          }}
          title="Export Selection to DSL"
        >
          <Braces size={16} strokeWidth={2} />
        </button>

        <button
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: tokens.colors.textSecondary,
            border: 'none',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            transition: 'var(--transition-crisp)',
          }}
          onClick={() => (window as any).toggleDeveloperPanel?.()}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = tokens.colors.surface;
            e.currentTarget.style.color = tokens.colors.textPrimary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = tokens.colors.textSecondary;
          }}
          title="Toggle Developer Sync Panel"
        >
          <Braces size={16} strokeWidth={2} />
        </button>
      </div>

      {/* Settings Button */}
      <button
        style={{
          width: 28, // Match height of tokens
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          color: tokens.colors.textSecondary,
          border: 'none',
          borderRadius: 'var(--radius-full)',
          cursor: 'pointer',
          transition: 'var(--transition-crisp)',
          marginRight: tokens.space[1],
        }}
        onClick={onSettingsClick}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = tokens.colors.surface;
          e.currentTarget.style.color = tokens.colors.textPrimary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = tokens.colors.textSecondary;
        }}
        title="Settings"
      >
        <Settings size={16} strokeWidth={2} />
      </button>

      
      {/* Theme Toggle */}
      <button 
        className="toggle-track"
        role="switch"
        aria-checked={theme === 'dark'}
        aria-label={t.themeLabel(theme)}
        style={{
          width: 44,
          height: 24,
          padding: '2px', // Optical adjustment: (24px - 20px) / 2 = 2px, not a spacing token
          borderRadius: 'var(--radius-full)',
          background: theme === 'dark' ? tokens.colors.grayBorderHover : tokens.colors.surface,
          border: `1px solid ${tokens.colors.grayBorder}`,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          position: 'relative' as const,
        }} 
        onClick={onToggleTheme}
        title={t.themeLabel(theme)}
      >
        <div 
          className="toggle-thumb"
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: tokens.colors.surface, // Migrated from colors.card
            boxShadow: tokens.colors.shadow, // Replaced rgba(0,0,0,0.15)
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translateX(${theme === 'dark' ? '20px' : '0'})`,
            transition: 'var(--transition-crisp)',
          }}
        >
          {theme === 'dark' ? (
            <Moon size={12} strokeWidth={2} color={tokens.colors.textPrimary} />
          ) : (
            <Sun size={12} strokeWidth={2} color={tokens.colors.textPrimary} />
          )}
        </div>
      </button>
    </div>
  );
}
