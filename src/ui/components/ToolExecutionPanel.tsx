import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Wrench, ChevronUp, ChevronDown } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { ToolCallRecord } from '../../types/chat';
import { ToolCallItem } from './ToolCallItem';
import { t } from '../i18n';

interface ToolExecutionPanelProps {
  toolCalls: ToolCallRecord[];
  isGlobal?: boolean; // If true, shows fixed at bottom
}

export function ToolExecutionPanel({ toolCalls, isGlobal = false }: ToolExecutionPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (toolCalls.length === 0) return null;

  const runningCount = toolCalls.filter(t => t.status === 'running').length;
  const successCount = toolCalls.filter(t => t.status === 'success').length;

  const summary = runningCount > 0 
    ? `Executing ${runningCount} tools...` 
    : `Completed ${successCount} tasks`;

  const containerStyle = isGlobal 
    ? {
        position: 'absolute' as const,
        bottom: 80, // Above input
        left: tokens.space[4],
        right: tokens.space[4],
        zIndex: 100,
      }
    : {
        marginTop: tokens.space[2],
        marginBottom: tokens.space[4],
      };

  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
    background: tokens.colors.grayMuted,
    cursor: 'pointer',
  };

  return (
    <div style={{
      ...containerStyle,
      background: tokens.colors.surface,
      border: `1px solid ${tokens.colors.grayBorder}`,
      borderRadius: 'var(--radius-4)',
      boxShadow: tokens.colors.shadow,
      overflow: 'hidden',
    }}>
      <div onClick={() => setIsExpanded(!isExpanded)} style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
          <Wrench size={14} style={{ color: tokens.colors.textSecondary }} />
          <span style={{ fontSize: tokens.fontSize[1], fontWeight: 600 }}>
            {summary}
          </span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </div>

      {isExpanded && (
        <div style={{
          maxHeight: 200,
          overflowY: 'auto' as const,
        }}>
          {toolCalls.map(record => (
            <ToolCallItem key={record.id} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}
