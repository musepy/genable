/**
 * @file DeveloperPanel.tsx
 * @description Developer-only panel for logout and session restore.
 */

import { h } from 'preact';
import { tokens } from '../design-system/tokens';
import { useTranslations } from '../i18n';

const panelStyle: h.JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space[3],
  padding: `${tokens.space[3]}px ${tokens.grid.blockPad}px`,
  background: tokens.colors.surface,
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--gray-6)',
  borderRadius: 'var(--radius-4)',
  marginTop: tokens.space[4],
};

const buttonStyle: h.JSX.CSSProperties = {
  padding: `${tokens.space[2]}px 0`,
  background: 'transparent',
  color: tokens.colors.textPrimary,
  border: 'none',
  borderBottom: '0.5px solid var(--border-default)',
  borderRadius: 'var(--radius-3)',
  cursor: 'pointer',
  fontSize: tokens.fontSize[1],
  fontWeight: tokens.fontWeight.medium,
  textAlign: 'center',
  transition: 'var(--transition-crisp)',
};

interface DeveloperPanelProps {
  onLogout?: () => void;
  onRestoreSession?: () => void;
}

export function DeveloperPanel({
  onLogout,
  onRestoreSession
}: DeveloperPanelProps) {
  const t = useTranslations();
  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: tokens.fontWeight.semibold, fontSize: tokens.fontSize[2], marginBottom: -tokens.space[2], color: tokens.colors.textPrimary }}>
        {t.developer}
      </div>

      <button
        style={{ ...buttonStyle, color: tokens.colors.accent }}
        onClick={() => {
          if (confirm(t.clearKeysConfirm)) {
            onLogout?.();
          }
        }}
      >
        {t.logoutClearKeys}
      </button>

      <button
        style={{ ...buttonStyle, borderBottom: 'none', color: tokens.colors.accent }}
        onClick={() => onRestoreSession?.()}
      >
        {t.restoreSession}
      </button>
    </div>
  );
}
