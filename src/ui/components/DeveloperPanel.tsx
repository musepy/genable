/**
 * @file DeveloperPanel.tsx
 * @description Developer-only panel for logout and session restore.
 */

import { h } from 'preact';
import { tokens } from '../design-system/tokens';

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

interface DeveloperPanelProps {
  onLogout?: () => void;
  onRestoreSession?: () => void;
}

export function DeveloperPanel({
  onLogout,
  onRestoreSession
}: DeveloperPanelProps) {
  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: tokens.fontWeight.semibold, fontSize: tokens.fontSize[2], marginBottom: -tokens.space[2], color: tokens.colors.textPrimary }}>
        Developer
      </div>

      <button
        style={{ ...buttonStyle, background: tokens.colors.accentAlpha[2], color: tokens.colors.accent, borderColor: tokens.colors.accentAlpha[4] }}
        onClick={() => {
          if (confirm('Clear all API keys and return to onboarding?')) {
            onLogout?.();
          }
        }}
      >
        Logout (Clear Keys)
      </button>

      <button
        style={{ ...buttonStyle, borderColor: tokens.colors.accentAlpha[5], color: tokens.colors.accent, background: 'transparent' }}
        onClick={() => onRestoreSession?.()}
      >
        Restore Saved Session
      </button>
    </div>
  );
}
