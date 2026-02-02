import { h } from 'preact';
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { Brain, ChevronRight, ChevronDown, Clock } from 'lucide-preact';
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
      borderLeft: `2px solid ${isStreaming ? tokens.colors.accent : tokens.colors.grayBorder}`,
      marginLeft: tokens.space[1],
      marginBottom: tokens.space[2],
      paddingLeft: tokens.space[3],
      transition: 'border-color 0.3s ease',
    }}>
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
        <div style={{ display: 'flex', alignItems: 'center', color: tokens.colors.textSecondary }}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], flex: 1 }}>
          <Brain size={14} style={{ color: isStreaming ? tokens.colors.accent : tokens.colors.textSecondary }} />
          <span style={{ 
            fontSize: tokens.fontSize.xs, 
            fontWeight: 600,
            color: isStreaming ? tokens.colors.textPrimary : tokens.colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            {iteration.taskTitle || `Step ${iteration.iteration}`}
          </span>
        </div>

        {!iteration.taskTitle && (
          <span style={{ fontSize: tokens.fontSize.xs, color: tokens.colors.textSecondary, opacity: 0.5 }}>
            (Iteration {iteration.iteration})
          </span>
        )}

        {duration !== null && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 4, 
            fontSize: tokens.fontSize.xs, 
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
