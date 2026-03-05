/**
 * @file DeveloperPanel.tsx
 * @description Developer-only panel for session simulation and factory reset.
 */

import { h } from 'preact';
import { emit } from '@create-figma-plugin/utilities';
import { tokens } from '../design-system/tokens';
import { ResetSettingsHandler } from '../../types';

const panelStyle: h.JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space[4],
  padding: tokens.space[4],
  background: tokens.colors.surface,
  border: 'var(--border-default)',
  borderRadius: 'var(--radius-4)',
  marginTop: tokens.space[4],
};

const buttonStyle: h.JSX.CSSProperties = {
  padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
  background: tokens.colors.surface,
  color: tokens.colors.textPrimary,
  border: 'var(--border-default)',
  borderRadius: 'var(--radius-3)',
  cursor: 'pointer',
  fontSize: tokens.fontSize[1],
  fontWeight: tokens.fontWeight.medium,
  textAlign: 'center',
  transition: 'var(--transition-crisp)',
};

const ghostButtonStyle: h.JSX.CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  border: 'var(--border-default)',
  color: tokens.colors.textSecondary,
};

interface DeveloperPanelProps {
  onSimulateLogout?: () => void;
  onSimulateEmptyState?: () => void;
  onRestoreSession?: () => void;
}

export function DeveloperPanel({
  onSimulateLogout,
  onSimulateEmptyState,
  onRestoreSession
}: DeveloperPanelProps) {

  const handleResetSettings = () => {
    if (confirm('【危险】确认彻底清除所有设置？这将从插件存储中永久删除 API Keys。')) {
      emit<ResetSettingsHandler>('RESET_SETTINGS');
    }
  };

  const handleSimulateLogout = () => {
    console.log('[Dev] Simulating logout...');
    if (onSimulateLogout) onSimulateLogout();
  };

  const handleSimulateEmptyState = () => {
    console.log('[Dev] Simulating fresh user empty state...');
    if (onSimulateEmptyState) onSimulateEmptyState();
  };

  const handleRestoreSession = () => {
    console.log('[Dev] Restoring saved session...');
    if (onRestoreSession) onRestoreSession();
  };

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: tokens.fontWeight.semibold, fontSize: tokens.fontSize[2], marginBottom: -tokens.space[2], color: tokens.colors.textPrimary }}>
        开发者工具
      </div>

      <button 
        style={{ ...buttonStyle, background: tokens.colors.accentAlpha[2], color: tokens.colors.accent, borderColor: tokens.colors.accentAlpha[4] }} 
        onClick={handleSimulateLogout}
      >
        模拟登出 (Simulate Sign Out)
      </button>

      <button
        style={{ ...buttonStyle, background: tokens.colors.grayMuted, color: tokens.colors.textPrimary }}
        onClick={handleSimulateEmptyState}
      >
        模拟新用户空态 (Keep Storage)
      </button>

      <button
        style={{ ...ghostButtonStyle, borderColor: tokens.colors.accentAlpha[5], color: tokens.colors.accent }}
        onClick={handleRestoreSession}
      >
        恢复已保存会话 (Reconnect Fast)
      </button>

      <button 
        style={{ ...buttonStyle, marginTop: tokens.space[2], opacity: 0.6, fontSize: tokens.fontSize[1], padding: '4px 8px', height: 'auto', background: 'transparent', color: tokens.colors.error, border: `1px solid ${tokens.colors.errorBorder}` }} 
        onClick={handleResetSettings}
      >
        彻底清空设置 (Factory Reset)
      </button>
    </div>
  );
}
