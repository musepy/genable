import { h } from 'preact';
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { Terminal, ChevronRight, ChevronDown, Clock } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { IterationRecord } from '../../types/chat';
import { MessageRenderer } from './MessageRenderer';

interface IterationCardProps {
  iteration: IterationRecord;
  isStreaming?: boolean;
}

export const IterationCard = memo(({ iteration, isStreaming = false }: IterationCardProps) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming); // Default expanded if streaming

  const duration = iteration.endTime ? iteration.endTime - iteration.startTime : null;

  return (
    <div style={{
      marginBottom: tokens.space[1],
      padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
      borderRadius: 'var(--radius-3)',
      transition: 'var(--transition-normal)',
      // Subtle indentation instead of vertical border
      marginLeft: tokens.space[1],
    }}
    onMouseEnter={(e) => (e.currentTarget.style.background = tokens.colors.alpha[1])}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          cursor: 'pointer',
          padding: `${tokens.space[1]}px 0`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', color: tokens.colors.textSecondary, opacity: 0.5 }}>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
        
        {/* Terminal Icon matching ToolGroup */}
        <div style={{
          width: 18,
          height: 18,
          background: tokens.colors.surface,
          border: `1px solid ${tokens.colors.alpha[3]}`,
          borderRadius: 'var(--radius-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Terminal size={10} color={isStreaming ? tokens.colors.accent : tokens.colors.textSecondary} strokeWidth={2.5} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], flex: 1, overflow: 'hidden' }}>
          <span style={{ 
            fontSize: tokens.fontSize[1], 
            fontWeight: tokens.fontWeight.semibold,
            color: isStreaming ? tokens.colors.textPrimary : tokens.colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {iteration.taskTitle || `Step ${iteration.iteration}`}
          </span>
        </div>

        {/* Label cleanup: removed redundant (Iteration X) */}

        {duration !== null && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: tokens.space[1], 
            fontSize: tokens.fontSize[1], 
            color: tokens.colors.textSecondary 
          }}>
            <Clock size={10} />
            <span>{duration}ms</span>
          </div>
        )}
      </div>

      {isExpanded && iteration.thinking && (
        <div style={{
          marginTop: tokens.space[1],
          fontSize: tokens.fontSize[1],
          color: tokens.colors.textPrimary,
          lineHeight: '1.5',
          opacity: isStreaming ? 1 : 0.8,
        }}>
          <MessageRenderer content={iteration.thinking} level="L3" />
        </div>
      )}
    </div>
  );
});
