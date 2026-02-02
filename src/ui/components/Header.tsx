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
    let base = 'header-icon-btn';
    if (!visible) return `${base} hidden`;
    if (!enabled) return `${base} disabled`;
    return base;
  };

  return (
    <div className="header-container">
      {/* New Design button - 进化为 Ghost/Subtle 风格 */}
      <button 
        className={"header-chip " + (newChatEnabled ? "" : "disabled")}
        style={{ display: newChatVisible ? 'inline-flex' : 'none' }}
        onClick={onNewChat}
        aria-label={t.newDesign}
        aria-disabled={!newChatEnabled}
      >
        <Plus size={14} strokeWidth={2.5} />
        <span>{t.newDesign}</span>
      </button>
      
      {/* Spacer */}
      <div className="header-spacer" />

      {/* Theme Toggle - 恢复为设计稿的单图标按钮 */}
      <button 
        className="header-icon-btn"
        onClick={onToggleTheme}
        title={t.themeLabel(theme)}
        aria-label={t.themeLabel(theme)}
      >
        {theme === 'dark' ? (
          <Moon size={16} strokeWidth={2} />
        ) : (
          <Sun size={16} strokeWidth={2} />
        )}
      </button>

      {/* Settings Button */}
      <button
        className="header-icon-btn"
        onClick={onSettingsClick}
        title="Settings"
        aria-label="Settings"
      >
        <Settings size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
