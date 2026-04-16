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
        className="text-action danger"
        onClick={() => {
          if (confirm(t.clearKeysConfirm)) {
            onLogout?.();
          }
        }}
      >
        {t.logoutClearKeys}
      </button>

      <button
        className="text-action"
        onClick={() => onRestoreSession?.()}
      >
        {t.restoreSession}
      </button>
    </div>
  );
}
