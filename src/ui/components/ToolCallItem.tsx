import { h } from 'preact';
import { useState } from 'preact/hooks';
import { ChevronRight, ChevronDown, CheckCircle2, Loader2, AlertCircle, Clock } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { ToolCallRecord } from '../../types/chat';

interface ToolCallItemProps {
  record: ToolCallRecord;
}

export function ToolCallItem({ record }: ToolCallItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const duration = record.endTime ? record.endTime - record.startTime : null;
  
  function getStatusIcon() {
    switch (record.status) {
      case 'success':
        return <CheckCircle2 size={14} style={{ color: tokens.colors.success }} />;
      case 'running':
        return <Loader2 size={14} style={{ color: tokens.colors.accent }} className="animate-spin" />;
      case 'error':
        return <AlertCircle size={14} style={{ color: tokens.colors.error }} />;
      default:
        return <Loader2 size={14} style={{ color: tokens.colors.textSecondary }} />;
    }
  }

  function JsonPreview({ label, data, color }: { label: string; data: any; color?: string }) {
    if (!data) return null;
    return (
      <div style={{ marginBottom: tokens.space[2] }}>
        <span style={{ color: color || tokens.colors.textSecondary, fontWeight: 600 }}>{label}:</span>
        <pre style={{ margin: 0, padding: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div style={{
      borderBottom: `1px solid ${tokens.colors.grayBorder}`,
      padding: `${tokens.space[2]}px 0`,
    }}>
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          cursor: 'pointer',
          padding: `0 ${tokens.space[2]}px`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', width: 20 }}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], flex: 1 }}>
          {getStatusIcon()}
          <span style={{ 
            fontSize: tokens.fontSize[1], 
            fontWeight: 500,
            color: tokens.colors.textPrimary 
          }}>
            {record.name}
          </span>
        </div>

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

      {isExpanded && (
        <div style={{
          marginTop: tokens.space[2],
          marginLeft: 44, // 20 (chevron) + 8 (gap) + 16 (icon/margin)
          padding: tokens.space[2],
          background: tokens.colors.grayMuted,
          borderRadius: 'var(--radius-2)',
          fontSize: tokens.fontSize.xs,
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden'
        }}>
          <JsonPreview label="Parameters" data={record.parameters} />
          <JsonPreview label="Result" data={record.result} />
          {record.error && (
            <div>
              <span style={{ color: tokens.colors.error, fontWeight: 600 }}>Error:</span>
              <pre style={{ margin: 0, padding: 4, color: tokens.colors.error, whiteSpace: 'pre-wrap' }}>
                {record.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
