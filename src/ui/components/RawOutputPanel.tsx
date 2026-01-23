/**
 * @file RawOutputPanel.tsx
 * @description Standard-compliant Raw Output display with declarative copy feedback.
 */

import { h } from 'preact';
import { tokens } from '../design-system/tokens';
import { useClipboard } from '../hooks/useClipboard';

interface RawOutputPanelProps {
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export function RawOutputPanel({ content, isExpanded, onToggle }: RawOutputPanelProps) {
  const { copy, status } = useClipboard();

  // Declarative label based on interaction status
  const copyLabel = status === 'success' ? 'Copied!' : 
                    status === 'error' ? 'Error' : 
                    status === 'executing' ? 'Copying...' : 'Copy';

  return (
    <div 
      className="raw-output-container"
      style={{ 
        marginTop: isExpanded ? tokens.space[1] : 0,
        background: 'transparent',
        border: isExpanded ? `1px solid ${tokens.colors.border}` : 'none',
        borderRadius: 'var(--radius-2)',
        overflow: 'hidden',
        // Motion System: Smooth Expansion
        maxHeight: isExpanded ? 500 : 0,
        opacity: isExpanded ? 1 : 0,
        transition: `
          max-height var(--duration-slow) var(--ease-spring),
          opacity var(--duration-normal) var(--ease-default),
          margin-top var(--duration-normal) var(--ease-default),
          border var(--duration-normal) var(--ease-default)
        `,
      }}
    >
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
        borderBottom: `1px solid ${tokens.colors.border}`,
      }}>
        <span style={{ fontSize: 'var(--font-size-1)', color: tokens.colors.textSecondary }}>
          Raw Output ({content.length} chars)
        </span>
        <div style={{ display: 'flex', gap: tokens.space[2] }}>
          <button 
            onClick={() => copy(content)}
            className="ghost-btn"
            style={{ 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: tokens.fontSize[1], // was 10
              color: status === 'success' ? tokens.colors.primary : tokens.colors.textSecondary,
              fontWeight: status === 'success' ? 600 : 400,
              transition: 'var(--transition-crisp)'
            }}
          >
            {copyLabel}
          </button>
          <button 
            onClick={onToggle}
            className="ghost-btn"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}
          >
            Close
          </button>
        </div>
      </div>
      {/* Content - scrollable */}
      <div style={{
        padding: tokens.space[2],
        maxHeight: 200,
        minHeight: 80,
        overflow: 'auto',
        fontSize: 'var(--font-size-1)',
        fontFamily: tokens.font.mono,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        lineHeight: tokens.lineHeight[2],
        color: tokens.colors.textPrimary,
      }}>
        {content}
      </div>
    </div>
  );
}
