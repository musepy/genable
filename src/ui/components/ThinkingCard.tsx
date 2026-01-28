/**
 * @file ThinkingCard.tsx
 * @description P2: Refactored to ThoughtsAccordion - lightweight collapsible using CSS Grid
 * 
 * Design:
 * - No background/border when collapsed (lighter)
 * - CSS Grid animation for smooth height transitions
 * - Renamed "Thinking" → "Thoughts"
 */

import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { tokens } from '../design-system/tokens';
import { Flex } from './layout';

// ============================================
// Types
// ============================================

export interface ThinkingData {
  designSystem: string;
  style: string;
  iconSource: string;
  constraints: string[];
  rationale?: string;
}

interface ThinkingCardProps {
  summary: string;
  thinking: ThinkingData;
}

// ============================================
// Chevron Icons
// ============================================

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ChevronUp = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ============================================
// Styles
// ============================================

const cardStyle: React.CSSProperties = {
  background: 'transparent',
  zIndex: 1,
  borderRadius: 'var(--radius-3)',
  padding: '0 var(--space-4)',
  contain: 'layout style',
};

const headerStyle: React.CSSProperties = {
  cursor: 'pointer',
  color: tokens.colors.textSecondary, // Already reduced via gray-11
  fontSize: 'var(--font-size-1)',
  transition: 'color 0.2s ease',
  // P3: Removed opacity - textSecondary provides sufficient contrast reduction
};

const summaryStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-1)',
  color: tokens.colors.textPrimary,
  lineHeight: tokens.lineHeight[3],
};

// P2: CSS Grid based animation - smoother than max-height
const gridContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: '0fr',
  transition: 'grid-template-rows 250ms var(--ease-spring)',
};

const gridContainerExpandedStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: '1fr',
  transition: 'grid-template-rows 250ms var(--ease-spring)',
};

const gridContentStyle: React.CSSProperties = {
  overflow: 'hidden',
  minHeight: 0, // Critical for 0fr to work
};

const innerContentStyle: React.CSSProperties = {
  padding: `${tokens.space[2]}px ${tokens.space[1]}px`,
  borderTop: `1px solid ${tokens.colors.grayBorder}`,
  fontSize: 'var(--font-size-1)',
  color: tokens.colors.textSecondary,
  lineHeight: tokens.lineHeight[3],
};

const tagRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: tokens.space[1],
};

const tagStyle: React.CSSProperties = {
  padding: `2px ${tokens.space[2]}px`,
  background: tokens.colors.surface, // Migrated from colors.card
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--font-size-1)',
  color: tokens.colors.textSecondary,
};

// ============================================
// Component
// ============================================

export function ThinkingCard({ summary, thinking }: ThinkingCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter high-value tags
  const tags = [
    thinking.designSystem !== 'Auto-detected' ? thinking.designSystem : null,
    thinking.style !== 'Default' ? thinking.style : null,
    thinking.iconSource && thinking.iconSource !== 'None' ? thinking.iconSource : null,
  ].filter(Boolean);

  return (
    <div style={cardStyle}>
      {/* Toggle header - using Flex for horizontal layout */}
      <Flex 
        gap="xs" 
        align="center"
        style={headerStyle} 
        onClick={() => setIsExpanded(!isExpanded)} 
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onMouseEnter={(e: MouseEvent) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={(e: MouseEvent) => ((e.currentTarget as HTMLElement).style.opacity = '0.8')}
      >
        <span style={{ display: 'flex', color: tokens.colors.textSecondary }}>
          {isExpanded ? <ChevronUp /> : <ChevronDown />}
        </span>
        <span>Thoughts</span> {/* P2: Renamed from "Thinking" */}
      </Flex>

      {/* Summary (always visible) */}
      <div style={summaryStyle}>{summary}</div>

      {/* P2: CSS Grid animated expanded content */}
      <div style={isExpanded ? gridContainerExpandedStyle : gridContainerStyle}>
        <div style={gridContentStyle}>
          <div style={{
            ...innerContentStyle,
            marginTop: isExpanded ? tokens.space[2] : 0,
          }}>
            {tags.length > 0 && (
              <div style={tagRowStyle}>
                {tags.map((tag, i) => <span key={i} style={tagStyle}>{tag}</span>)}
              </div>
            )}
            {thinking.constraints.length > 0 && (
              <div style={{ marginBottom: tokens.space[1] }}>
                Constraints: {thinking.constraints.join(', ')}
              </div>
            )}
            {thinking.rationale && (
              <div style={{ color: tokens.colors.accent }}>{thinking.rationale}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThinkingCard;
