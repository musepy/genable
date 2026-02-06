/**
 * @file ContextTag.tsx
 * @description Context tag pill for showing file/table context in the input area
 *
 * Figma: ContextTag component (node 160:999)
 * Variants: Default, Hover
 */

import { h, ComponentChildren } from 'preact';
import { tokens } from '../design-system/tokens';

export interface ContextTagProps {
  /** Small icon (12px) for file type, table, etc. */
  icon?: ComponentChildren;
  /** Label text, e.g. "AnalyticsService.ts" */
  label: string;
  /** Optional remove handler — shows close button */
  onRemove?: () => void;
}

export function ContextTag({ icon, label, onRemove }: ContextTagProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.space[1],
        padding: '4.5px 8.5px',
        background: 'var(--panel-translucent)',
        border: '0.5px solid var(--gray-a4)',
        borderRadius: 'var(--radius-3)',
        cursor: 'default',
        transition: 'var(--transition-crisp)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--gray-a7)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--gray-a4)';
      }}
    >
      {icon && (
        <span style={{ display: 'flex', flexShrink: 0, width: 12, height: 12 }}>
          {icon}
        </span>
      )}
      <span style={{
        fontSize: tokens.fontSize[1],
        fontWeight: 500,
        lineHeight: '16px',
        color: 'var(--gray-a11)',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 12,
            height: 12,
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--gray-a8)',
            flexShrink: 0,
          }}
          aria-label={`Remove ${label}`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
