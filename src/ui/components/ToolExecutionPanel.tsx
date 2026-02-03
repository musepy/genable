import { h } from 'preact';
import { useState } from 'preact/hooks';
import { ChevronDown } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { ToolCallRecord } from '../../types/chat';
import { ToolCallItem } from './ToolCallItem';

interface ToolExecutionPanelProps {
  toolCalls: ToolCallRecord[];
  isGlobal?: boolean;
}

/** Minimal tool icon matching Figma ToolGroup design */
function ToolIcon() {
  return (
    <div style={{
      width: 20,
      height: 20,
      background: tokens.colors.alpha[2],
      borderRadius: 'var(--radius-2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <rect x="8" y="8" width="8" height="8" rx="1" />
      </svg>
    </div>
  );
}

export function ToolExecutionPanel({ toolCalls, isGlobal = false }: ToolExecutionPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  const runningCount = toolCalls.filter(t => t.status === 'running').length;
  const totalCount = toolCalls.length;

  const summary = runningCount > 0
    ? `Executing ${runningCount} Actions...`
    : `Executed ${totalCount} Actions`;

  return (
    <div style={{ width: '100%' }}>
      {/* ToolGroup header row */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[3],
          padding: `${tokens.space[1]}px 0`,
          borderBottom: `0.5px solid ${tokens.colors.alpha[3]}`,
          cursor: 'pointer',
        }}
      >
        <ToolIcon />
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: tokens.fontSize[1],
            fontWeight: 500,
            color: tokens.colors.textPrimary,
          }}>
            {summary}
          </span>
          <ChevronDown
            size={14}
            style={{
              color: tokens.colors.textSecondary,
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
            }}
          />
        </div>
      </div>

      {/* Expanded tool call details */}
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
