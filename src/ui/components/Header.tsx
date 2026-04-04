/**
 * @file Header.tsx
 * @description 插件顶部栏组件 - New Chat + 主题切换
 * 
 * P4 布局重构：移除 Model 选择器（已移至 Input Area 左下角）
 * 语义化架构：状态通过 CSS 类控制 (.icon-btn.disabled/.hidden)
 */

import { h } from 'preact';
import { Plus, AlignJustify, Sun, Moon, X } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
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
  isSettingsOpen?: boolean;
}

export function Header({
  theme,
  onToggleTheme,
  onNewChat,
  newChatVisible,
  newChatEnabled,
  onSettingsClick,
  isSettingsOpen = false,
}: HeaderProps) {
  
  // Derive CSS class for new chat button
  const getIconBtnClass = (visible: boolean, enabled: boolean): string => {
    let base = 'header-icon-btn';
    if (!visible) return `${base} hidden`;
    if (!enabled) return `${base} disabled`;
    return base;
  };

  return (
    <div className="header-container">
      {/* Settings Title (Left Aligned) - Moved to start */}
      {isSettingsOpen && (
        <div style={{ 
          fontSize: tokens.fontSize[2],
          fontWeight: tokens.fontWeight.regular,
          color: 'var(--gray-11)',
          paddingLeft: tokens.grid.blockPad
        }}>
          Settings
        </div>
      )}

      {/* New Design button - Hidden in settings */}
      {!isSettingsOpen && (
        <button
          className={"header-chip " + (newChatEnabled ? "" : "disabled")}
          style={{ 
            display: newChatVisible ? 'inline-flex' : 'none'
          }}
          onClick={onNewChat}
          aria-label={t.newDesign}
          aria-disabled={!newChatEnabled}
        >
          <Plus size={14} strokeWidth={2.5} />
          <span>{t.newDesign}</span>
        </button>
      )}
      
      <div style={{ flex: 1 }} />

      {/* Theme Toggle - Hidden in settings */}
      {!isSettingsOpen && (
        <button 
          className="header-icon-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? t.light : t.dark}
          aria-label={theme === 'dark' ? t.light : t.dark}
        >
          {theme === 'dark' ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
        </button>
      )}

      <button
        className={`header-icon-btn ${isSettingsOpen ? 'is-active' : ''}`}
        onClick={onSettingsClick}
        title={isSettingsOpen ? "Close Settings" : "Settings"}
        aria-label={isSettingsOpen ? "Close Settings" : "Settings"}
        style={{ transition: 'transform 0.3s ease' }}
      >
        <div style={{ 
          display: 'flex', 
          transition: 'transform 0.3s ease',
          transform: isSettingsOpen ? 'rotate(90deg)' : 'rotate(0deg)' 
        }}>
          {isSettingsOpen ? (
            <X size={16} strokeWidth={2} />
          ) : (
            <AlignJustify size={16} strokeWidth={2} />
          )}
        </div>
      </button>
    </div>
  );
}
