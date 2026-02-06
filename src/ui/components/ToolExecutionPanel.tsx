import { h } from 'preact';
import { useState } from 'preact/hooks';
import { ChevronDown, Terminal } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { ToolCallRecord } from '../../types/chat';

interface ToolExecutionPanelProps {
  toolCalls?: ToolCallRecord[];
  thinkingStatus?: string;  // "Thinking..." / "Loading..."
  thinkingDetail?: string;  // 长文本
  onSelectNode?: (nodeId: string) => void;
}

/** Minimal tool icon matching Figma ToolGroup design */
function ToolIcon() {
  return (
    <div style={{
      width: 20,
      height: 20,
      background: tokens.colors.surface,
      border: `1px solid ${tokens.colors.alpha[3]}`,
      borderRadius: 'var(--radius-4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Terminal size={12} color={tokens.colors.textSecondary} strokeWidth={2.5} />
    </div>
  );
}

function extractResultNodes(toolCalls: ToolCallRecord[] = []) {
  const map = new Map<string, { nodeId: string; label: string }>();

  for (const tc of toolCalls) {
    const data = (tc.result as any)?.data || {};
    const nodeId =
      data.nodeId ||
      (tc.result as any)?.nodeId ||
      tc.parameters?.nodeId;

    if (!nodeId || map.has(nodeId)) continue;

    const label =
      data.name ||
      tc.parameters?.name ||
      nodeId;

    map.set(nodeId, { nodeId, label });
  }

  return Array.from(map.values());
}

export function ToolExecutionPanel({ 
  toolCalls = [], 
  thinkingStatus, 
  thinkingDetail, 
  onSelectNode 
}: ToolExecutionPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const completedCount = toolCalls.filter(tc => tc.status === 'success').length;
  const headerText = completedCount > 0 ? String(completedCount) : '';

  const resultNodes = extractResultNodes(toolCalls);
  const canExpand = !!thinkingDetail || resultNodes.length > 0;

  if (!headerText && !canExpand) return null;

  return (
    <div style={{ width: '100%' }}>
      {/* ToolGroup header row */}
      <div
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[3],
          padding: `${tokens.space[1]}px 0`,
          borderBottom: `0.5px solid ${tokens.colors.alpha[3]}`,
          cursor: canExpand ? 'pointer' : 'default',
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
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {headerText}
          </span>
          {canExpand && (
            <ChevronDown
              size={14}
              style={{
                color: tokens.colors.textSecondary,
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 150ms ease',
              }}
            />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && canExpand && (
        <div style={{ padding: `${tokens.space[2]}px 0` }}>
          {/* Result nodes - displayed by default */}
          {resultNodes.length > 0 && (
            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: tokens.space[1],
            }}>
              {resultNodes.map(node => (
                <button
                  key={node.nodeId}
                  className="chip"
                  style={{ 
                    padding: `2px ${tokens.space[2]}px`, 
                    color: tokens.colors.accent, 
                    background: tokens.colors.accentAlpha[2], 
                    border: 'none',
                    borderRadius: 'var(--radius-full)',
                    fontSize: tokens.fontSize[1],
                    cursor: 'pointer',
                    transition: 'var(--transition-crisp)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = tokens.colors.accentAlpha[3];
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = tokens.colors.accentAlpha[2];
                  }}
                  onClick={() => onSelectNode?.(node.nodeId)}
                >
                  {node.label}
                </button>
              ))}
            </div>
          )}

          {/* Thinking detail - collapsible, no hardcoded text */}
          {thinkingDetail && (
            <details style={{ marginTop: resultNodes.length > 0 ? tokens.space[2] : 0 }}>
              <summary style={{ 
                fontSize: tokens.fontSize[1], 
                color: tokens.colors.textSecondary,
                cursor: 'pointer',
                listStyle: 'none',
              }}>
                <span style={{ opacity: 0.5 }}>···</span>
              </summary>
              <div style={{ 
                marginTop: tokens.space[1], 
                fontSize: tokens.fontSize[1], 
                color: tokens.colors.textPrimary,
                whiteSpace: 'pre-wrap',
                padding: tokens.space[1],
              }}>
                {thinkingDetail}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
