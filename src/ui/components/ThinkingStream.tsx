/**
 * @file ThinkingStream.tsx
 * @description Minimal loading indicator during generation
 * 
 * [INPUT]:  isStreaming boolean + loadingStatus text
 * [OUTPUT]: Simple inline loading indicator
 * [POS]:    Part of message flow - shows generation status
 * 
 * Design: No fill, no border, full width, minimal
 */

import { h } from 'preact';
import { tokens } from '../design-system/tokens';

// ============================================
// Types
// ============================================

interface ThinkingStreamProps {
  /** Current status text */
  status?: string;
  /** Whether still streaming */
  isStreaming: boolean;
  /** Optional skip callback */
  onSkip?: () => void;
}

// ============================================
// Minimal Styles (no fill, no border)
// ============================================

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space[2],
  padding: `${tokens.space[2]}px 0`,
  width: '100%',
  animation: 'fadeIn 0.3s ease-out',
};

const statusStyle: React.CSSProperties = {
  fontSize: tokens.fontSize[1], // was 11
  color: tokens.colors.textSecondary,
  flex: 1,
};

const skipButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: tokens.colors.textSecondary,
  fontSize: tokens.fontSize[1], // was 10
  cursor: 'pointer',
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  transition: 'opacity 0.2s ease',
  opacity: 'var(--alpha-11)',
};

// ============================================
// Component
// ============================================

export function ThinkingStream({ 
  status,
  isStreaming, 
  onSkip 
}: ThinkingStreamProps) {
  
  // [UX Fix] Consistently show loading state regardless of streaming mode
  // This ensures users see "Generating..." message even when responseSchema (non-streaming) is active
  
  return (
    <div style={containerStyle}>
      <span style={statusStyle}>
        {status || 'Generating...'}
      </span>
      {onSkip && (
        <button 
          style={skipButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = 'var(--alpha-11)')}
          className="ghost-btn"
        >
          Skip
        </button>
      )}
    </div>
  );
}

// No extra CSS needed for minimal design
export const thinkingStreamCss = '';

export default ThinkingStream;
