/**
 * @file SelectionTags.tsx
 * @description Displays selected Figma layers as removable tags above the input
 * 
 * [INPUT]:  selectionNodes from SelectionStyles
 * [OUTPUT]: Compact tags showing selected elements with close buttons
 * [POS]:    UI component - renders above PromptInput when user selects Figma layers
 */

import { h } from 'preact';
import { tokens } from '../design-system/tokens';
import type { NodeLayer } from '../../schema/layerSchema';

// ============================================
// Types
// ============================================

interface SelectionTagsProps {
  /** Array of selected nodes */
  nodes: NodeLayer[];
  /** Callback when user removes a single node */
  onRemove?: (nodeIndex: number) => void;
  /** Callback when user clears all selections */
  onClear?: () => void;
  /** Maximum visible tags before showing "+N more" */
  maxVisible?: number;
}

// ============================================
// Styles (using tokens)
// ============================================

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space[1],
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  flexWrap: 'wrap',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: tokens.space[1],
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  background: tokens.colors.accentMuted,
  color: tokens.colors.accent,
  border: `1px solid ${tokens.colors.accentBorder}`,
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--font-size-1)',
  fontWeight: tokens.fontWeight.medium,
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'default',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: tokens.colors.textSecondary, // P3: Replaces opacity 0.7
  cursor: 'pointer',
  padding: 0,
  marginLeft: tokens.space[1],
  fontSize: 'var(--font-size-1)',
  lineHeight: 1,
  transition: 'var(--transition-crisp)',
};

const moreTagStyle: React.CSSProperties = {
  ...tagStyle,
  background: tokens.colors.surface,
  color: tokens.colors.textSecondary,
  border: `1px solid ${tokens.colors.grayBorder}`,
  cursor: 'default',
};

const clearButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: tokens.colors.textSecondary,
  cursor: 'pointer',
  padding: `${tokens.space[1]}px`,
  fontSize: 'var(--font-size-1)',
  marginLeft: 'auto',
  transition: 'var(--transition-crisp)',
};

// ============================================
// Icons (Minimalistic SVGs)
// ============================================

const PinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: tokens.colors.textSecondary }}>
    <path d="m9 11 3 3L22 4"/><path d="M22 4v5"/><path d="M22 4h-5"/><path d="M20.9 11c.1.7.1 1.4.1 2.1 0 5-4 9-9 9s-9-4-9-9 4-9 9-9c.7 0 1.4.1 2.1.1"/>
  </svg>
);

const NodeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2"/>
  </svg>
);

// ============================================
// Helper: Get display name for a node
// ============================================

function getNodeDisplayName(node: NodeLayer): string {
  // Priority: name > type
  const name = node.props?.name;
  if (name && typeof name === 'string') {
    // Truncate long names
    return name.length > 15 ? name.slice(0, 12) + '...' : name;
  }
  return node.type || 'Element';
}

// ============================================
// Component
// ============================================

export function SelectionTags({
  nodes,
  onRemove,
  onClear,
  maxVisible = 3,
}: SelectionTagsProps) {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  const visibleNodes = nodes.slice(0, maxVisible);
  const hiddenCount = nodes.length - maxVisible;

  return (
    <div style={containerStyle}>
      <PinIcon />
      
      {visibleNodes.map((node, index) => (
        <span key={index} style={tagStyle} className="selection-tag">
          <NodeIcon />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {getNodeDisplayName(node)}
          </span>
          {onRemove && (
            <button
              style={closeButtonStyle}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(index);
              }}
              aria-label={`Remove ${getNodeDisplayName(node)}`}
              className="ghost-btn"
            >
              ×
            </button>
          )}
        </span>
      ))}
      
      {hiddenCount > 0 && (
        <span style={moreTagStyle}>
          +{hiddenCount} more
        </span>
      )}
      
      {onClear && nodes.length > 0 && (
        <button
          style={clearButtonStyle}
          onClick={onClear}
          aria-label="Clear all selections"
          className="ghost-btn"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export default SelectionTags;
