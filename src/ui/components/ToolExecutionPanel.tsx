import { h } from 'preact';
import { useState } from 'preact/hooks';
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Terminal } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { ToolCallRecord } from '../../types/chat';

interface ToolExecutionPanelProps {
  toolCalls?: ToolCallRecord[];
  thinkingStatus?: string;
  thinkingDetail?: string;
  currentTaskTitle?: string;
  onSelectNode?: (nodeId: string) => void;
}

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

const PLAN_TOOLS = new Set([
  'planDesign',
  'new_task',
  'update_todo_list',
  'summarize_progress'
]);

const EXECUTION_TOOLS = new Set([
  'generateDesign',
  'batchOperations',
  'createNode',
  'setNodeLayout',
  'setNodeStyles',
  'updateNodeProperties',
  'createIcon',
  'applyDesignPatch',
  'deleteNode'
]);

const VERIFICATION_TOOLS = new Set([
  'inspectDesign',
  'validateLayout'
]);

const SEARCH_TOOLS = new Set([
  'searchDesignKnowledge',
  'getComponentAnatomy',
  'getFigmaLayoutRules'
]);

const EXPLORE_TOOLS = new Set([
  'inspectDesign',
  'getDeepHierarchy',
  'getProjectUIContext',
  'getDesignSystemTokens',
  'listProjectComponents'
]);

const TOOL_LABELS: Record<string, string> = {
  planDesign: 'Plan design',
  new_task: 'Create task',
  update_todo_list: 'Update checklist',
  summarize_progress: 'Summarize progress',
  generateDesign: 'Generate design',
  batchOperations: 'Batch operations',
  createNode: 'Create node',
  setNodeLayout: 'Set layout',
  setNodeStyles: 'Set styles',
  updateNodeProperties: 'Update properties',
  createIcon: 'Create icon',
  applyDesignPatch: 'Apply patch',
  deleteNode: 'Delete node',
  inspectDesign: 'Inspect design',
  validateLayout: 'Validate layout',
  complete_task: 'Complete task'
};

interface ActivityCounts {
  explored: number;
  searched: number;
  ran: number;
  edited: number;
}

type StageKind = 'idle' | 'planning' | 'executing' | 'verifying' | 'complete' | 'failed';

interface PanelSummary {
  stage: StageKind;
  title: string;
  subtitle: string;
  totalTools: number;
  completedTools: number;
  runningTools: number;
  failedTools: number;
  createdNodes: number;
}

function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || name;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function countActivities(toolCalls: ToolCallRecord[] = []): ActivityCounts {
  const counts: ActivityCounts = {
    explored: 0,
    searched: 0,
    ran: 0,
    edited: 0,
  };

  for (const tc of toolCalls) {
    if (SEARCH_TOOLS.has(tc.name)) {
      counts.searched++;
      continue;
    }
    if (EXPLORE_TOOLS.has(tc.name)) {
      counts.explored++;
      continue;
    }
    if (EXECUTION_TOOLS.has(tc.name)) {
      counts.edited++;
      continue;
    }
    counts.ran++;
  }

  return counts;
}

function buildActivityHeadline(toolCalls: ToolCallRecord[] = [], createdNodes = 0): string {
  const counts = countActivities(toolCalls);
  const parts: string[] = [];

  if (counts.explored > 0) {
    parts.push(`Explored ${counts.explored} ${pluralize('source', counts.explored)}`);
  }
  if (counts.searched > 0) {
    parts.push(`${counts.searched} ${pluralize('search', counts.searched)}`);
  }
  if (counts.ran > 0) {
    parts.push(`Ran ${counts.ran} ${pluralize('tool', counts.ran)}`);
  }
  if (createdNodes > 0) {
    parts.push(`Edited ${createdNodes} ${pluralize('layer', createdNodes)}`);
  } else if (counts.edited > 0) {
    parts.push(`Edited ${counts.edited} ${pluralize('action', counts.edited)}`);
  }

  return parts.join(', ');
}

function collectCreatedNodeIds(toolCalls: ToolCallRecord[] = []) {
  const nodeIds = new Set<string>();

  for (const tc of toolCalls) {
    const data = (tc.result as any)?.data;
    if (!data || typeof data !== 'object') continue;

    if (typeof data.rootNodeId === 'string') {
      nodeIds.add(data.rootNodeId);
    }

    if (typeof data.nodeId === 'string') {
      nodeIds.add(data.nodeId);
    }

    if (data.idMap && typeof data.idMap === 'object') {
      for (const nodeId of Object.values(data.idMap)) {
        if (typeof nodeId === 'string') nodeIds.add(nodeId);
      }
    }

    if (Array.isArray(data.results)) {
      for (const result of data.results) {
        if (result?.success !== false && typeof result?.nodeId === 'string') {
          nodeIds.add(result.nodeId);
        }

        if (Array.isArray(result?.children)) {
          for (const child of result.children) {
            if (child?.success !== false && typeof child?.nodeId === 'string') {
              nodeIds.add(child.nodeId);
            }
          }
        }
      }
    }
  }

  return nodeIds;
}

function buildPanelSummary(
  toolCalls: ToolCallRecord[],
  currentTaskTitle?: string,
  thinkingStatus?: string,
  createdNodeIds?: Set<string>
): PanelSummary {
  const totalTools = toolCalls.length;
  const completedTools = toolCalls.filter(tc => tc.status === 'success').length;
  const runningTools = toolCalls.filter(tc => tc.status === 'running' || tc.status === 'pending').length;
  const failedTools = toolCalls.filter(tc => tc.status === 'error').length;
  const createdNodes = createdNodeIds?.size || 0;

  const hasPlan = toolCalls.some(tc => PLAN_TOOLS.has(tc.name));
  const hasExecution = toolCalls.some(tc => EXECUTION_TOOLS.has(tc.name));
  const hasVerification = toolCalls.some(tc => VERIFICATION_TOOLS.has(tc.name));
  const completedTask = toolCalls.some(tc => tc.name === 'complete_task' && tc.status === 'success');

  let stage: StageKind = 'idle';
  let title = thinkingStatus || 'Preparing response';

  if (failedTools > 0) {
    stage = 'failed';
    title = 'Action required';
  } else if (runningTools > 0) {
    if (hasExecution) {
      stage = 'executing';
      title = 'Generating design';
    } else if (hasVerification) {
      stage = 'verifying';
      title = 'Verifying output';
    } else {
      stage = 'planning';
      title = 'Planning steps';
    }
  } else if (completedTask) {
    stage = 'complete';
    title = 'Completed';
  } else if (hasVerification) {
    stage = 'verifying';
    title = 'Verification finished';
  } else if (hasExecution) {
    stage = 'executing';
    title = 'Design generated';
  } else if (hasPlan) {
    stage = 'planning';
    title = 'Plan ready';
  }

  const summaryParts: string[] = [];
  if (totalTools > 0) summaryParts.push(`Tools ${completedTools}/${totalTools}`);
  if (createdNodes > 0) summaryParts.push(`Layers ${createdNodes}`);
  if (failedTools > 0) summaryParts.push(`Errors ${failedTools}`);
  if (currentTaskTitle) summaryParts.push(currentTaskTitle);

  return {
    stage,
    title,
    subtitle: summaryParts.join(' · '),
    totalTools,
    completedTools,
    runningTools,
    failedTools,
    createdNodes,
  };
}

function extractResultNodes(toolCalls: ToolCallRecord[] = []) {
  const map = new Map<string, { nodeId: string; label: string }>();

  for (const tc of toolCalls) {
    const data = (tc.result as any)?.data || {};
    const results = Array.isArray(data.results) ? data.results : [];
    const nameByOpId = new Map<string, string>();

    for (const result of results) {
      if (result?.opId && result?.name) {
        nameByOpId.set(result.opId, result.name);
      }
    }

    for (const result of results) {
      const nodeId = result?.nodeId;
      if (!nodeId || map.has(nodeId)) continue;

      const label =
        result?.name ||
        result?.opId ||
        nodeId;

      map.set(nodeId, { nodeId, label });
    }

    if (data.idMap && typeof data.idMap === 'object') {
      for (const [opId, nodeId] of Object.entries(data.idMap)) {
        if (typeof nodeId !== 'string' || map.has(nodeId)) continue;
        const label = nameByOpId.get(opId) || opId || nodeId;
        map.set(nodeId, { nodeId, label });
      }
    }

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

function getStageColor(stage: StageKind): string {
  switch (stage) {
    case 'failed':
      return tokens.colors.error;
    case 'complete':
      return tokens.colors.success;
    case 'executing':
      return tokens.colors.accent;
    case 'planning':
    case 'verifying':
    case 'idle':
    default:
      return tokens.colors.textPrimary;
  }
}

function ToolStatusIcon({ record }: { record: ToolCallRecord }) {
  if (record.status === 'error') {
    return <AlertCircle size={13} color={tokens.colors.error} />;
  }
  if (record.status === 'running' || record.status === 'pending') {
    return <Loader2 size={13} color={tokens.colors.accent} className="animate-spin" />;
  }
  if (record.status === 'success') {
    return <CheckCircle2 size={13} color={tokens.colors.success} />;
  }
  return <Terminal size={13} color={tokens.colors.textSecondary} />;
}

export function ToolExecutionPanel({
  toolCalls = [],
  thinkingStatus,
  thinkingDetail,
  currentTaskTitle,
  onSelectNode
}: ToolExecutionPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllNodes, setShowAllNodes] = useState(false);

  const createdNodeIds = collectCreatedNodeIds(toolCalls);
  const summary = buildPanelSummary(toolCalls, currentTaskTitle, thinkingStatus, createdNodeIds);
  const resultNodes = extractResultNodes(toolCalls);
  const activityHeadline = buildActivityHeadline(toolCalls, summary.createdNodes);
  const visibleNodes = showAllNodes ? resultNodes : resultNodes.slice(0, 10);
  const hiddenNodeCount = Math.max(0, resultNodes.length - visibleNodes.length);
  const recentCalls = toolCalls.slice(-6).reverse();
  const canExpand = !!thinkingDetail || resultNodes.length > 0 || recentCalls.length > 0;

  if (summary.totalTools === 0 && !thinkingStatus && !canExpand) return null;

  return (
    <div style={{ width: '100%' }}>
      {activityHeadline && (
        <div style={{
          fontSize: tokens.fontSize[1],
          color: tokens.colors.textSecondary,
          marginBottom: tokens.space[1],
        }}>
          {activityHeadline}
        </div>
      )}

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block',
            fontSize: tokens.fontSize[1],
            fontWeight: 600,
            color: getStageColor(summary.stage),
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {summary.title}
          </span>
          <span style={{
            display: 'block',
            marginTop: 1,
            fontSize: tokens.fontSize[1],
            color: tokens.colors.textSecondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: 0.9,
          }}>
            {summary.subtitle || 'Waiting for next action'}
          </span>
        </div>

        {canExpand && (
          <ChevronDown
            size={14}
            style={{
              color: tokens.colors.textSecondary,
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {isExpanded && canExpand && (
        <div style={{ padding: `${tokens.space[2]}px 0` }}>
          {recentCalls.length > 0 && (
            <div style={{ marginBottom: tokens.space[2] }}>
              <div style={{
                fontSize: tokens.fontSize[1],
                color: tokens.colors.textSecondary,
                marginBottom: tokens.space[1],
              }}>
                Recent actions
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentCalls.map(record => {
                  const durationMs = record.endTime ? Math.max(0, record.endTime - record.startTime) : null;
                  return (
                    <div
                      key={record.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: tokens.space[1],
                        fontSize: tokens.fontSize[1],
                        color: tokens.colors.textPrimary,
                      }}
                    >
                      <ToolStatusIcon record={record} />
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {getToolLabel(record.name)}
                      </span>
                      {durationMs !== null && (
                        <span style={{ color: tokens.colors.textSecondary }}>
                          {durationMs}ms
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {resultNodes.length > 0 && (
            <div>
              <div style={{
                fontSize: tokens.fontSize[1],
                color: tokens.colors.textSecondary,
                marginBottom: tokens.space[1],
              }}>
                Created layers ({resultNodes.length})
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: tokens.space[1],
              }}>
                {visibleNodes.map(node => (
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

                {hiddenNodeCount > 0 && (
                  <button
                    className="chip"
                    style={{
                      padding: `2px ${tokens.space[2]}px`,
                      color: tokens.colors.textSecondary,
                      background: tokens.colors.alpha[2],
                      border: 'none',
                      borderRadius: 'var(--radius-full)',
                      fontSize: tokens.fontSize[1],
                      cursor: 'pointer',
                    }}
                    onClick={() => setShowAllNodes(true)}
                  >
                    +{hiddenNodeCount} more
                  </button>
                )}

                {showAllNodes && resultNodes.length > 10 && (
                  <button
                    className="chip"
                    style={{
                      padding: `2px ${tokens.space[2]}px`,
                      color: tokens.colors.textSecondary,
                      background: tokens.colors.alpha[2],
                      border: 'none',
                      borderRadius: 'var(--radius-full)',
                      fontSize: tokens.fontSize[1],
                      cursor: 'pointer',
                    }}
                    onClick={() => setShowAllNodes(false)}
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          )}

          {thinkingDetail && (
            <details style={{ marginTop: tokens.space[2] }}>
              <summary style={{
                fontSize: tokens.fontSize[1],
                color: tokens.colors.textSecondary,
                cursor: 'pointer',
                listStyle: 'none',
              }}>
                Reasoning detail
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
