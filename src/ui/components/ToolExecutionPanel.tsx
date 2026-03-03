import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useElapsedTime } from '../hooks/useElapsedTime'
import { tokens } from '../design-system/tokens'
import { ToolCallRecord, LLMCallRecord } from '../../types/chat'
import { AgentRuntimeContextUsage, AgentRuntimePhase } from '../../shared/protocol/agentRuntimeEvents'

interface ToolExecutionPanelProps {
  toolCalls?: ToolCallRecord[]
  llmCalls?: LLMCallRecord[]
  thinkingStatus?: string
  reasoningPreview?: string
  currentTaskTitle?: string
  phase?: AgentRuntimePhase
  progress?: { iteration: number; maxIterations: number } | null
  contextUsage?: AgentRuntimeContextUsage | null
  runState?: 'idle' | 'running' | 'completed' | 'canceled' | 'error' | 'reconnecting'
  reconnectCount?: number
  maxReconnects?: number
  taskStartTime?: number
  taskEndTime?: number
  runError?: string
  onStop?: () => void
  onContinue?: () => void
  queuedCount?: number
}

/** Fallback formatter when displayName is not available */
function formatToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDisplayName(c: ToolCallRecord): string {
  return c.displayName || formatToolName(c.name)
}

/** Collapse tool calls into unique display names with counts */
function collapseCalls(calls: ToolCallRecord[]): { name: string; count: number; errorCount: number }[] {
  const map = new Map<string, { count: number; errorCount: number }>()
  for (const c of calls) {
    const key = getDisplayName(c)
    const entry = map.get(key)
    if (entry) {
      entry.count++
      if (c.status === 'error') entry.errorCount++
    } else {
      map.set(key, { count: 1, errorCount: c.status === 'error' ? 1 : 0 })
    }
  }
  return Array.from(map, ([name, v]) => ({ name, ...v }))
}

function useRunningDots(active: boolean) {
  const [dots, setDots] = useState('')
  useEffect(() => {
    if (!active) { setDots(''); return }
    const timer = window.setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : `${prev}.`))
    }, 400)
    return () => window.clearInterval(timer)
  }, [active])
  return dots
}

/** Summarize LLM call records for display */
function summarizeLLMCalls(calls: LLMCallRecord[]): { count: number; totalTokens: number; avgDurationMs: number } | null {
  const completed = calls.filter(c => c.durationMs != null)
  if (completed.length === 0) return null
  const totalTokens = completed.reduce((sum, c) => sum + (c.usage?.totalTokens || 0), 0)
  const totalDuration = completed.reduce((sum, c) => sum + (c.durationMs || 0), 0)
  return {
    count: completed.length,
    totalTokens,
    avgDurationMs: Math.round(totalDuration / completed.length),
  }
}

export function ToolExecutionPanel({
  toolCalls = [],
  llmCalls = [],
  thinkingStatus,
  reasoningPreview,
  currentTaskTitle,
  phase,
  progress,
  contextUsage,
  runState,
  reconnectCount,
  maxReconnects,
  taskStartTime,
  taskEndTime,
  runError,
  onStop,
  onContinue,
  queuedCount = 0,
}: ToolExecutionPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const inferredRunning = !runState && !!thinkingStatus
  const isRunning = runState === 'running' || runState === 'reconnecting' || inferredRunning
  const dots = useRunningDots(isRunning)
  const elapsedText = useElapsedTime(taskStartTime, isRunning, taskEndTime)
  const reasoningSnippet = reasoningPreview ? reasoningPreview.slice(-200) : ''
  const toolCount = toolCalls.length
  const collapsed = useMemo(() => collapseCalls(toolCalls), [toolCalls])

  useEffect(() => {
    if (isRunning && onStop) {
      const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onStop() }
      window.addEventListener('keydown', h)
      return () => window.removeEventListener('keydown', h)
    }
  }, [isRunning, onStop])

  useEffect(() => {
    if (runState === 'error') setExpanded(true)
  }, [runState])

  const statusParts = useMemo(() => {
    const parts: string[] = []
    if (runState === 'error') parts.push(runError || 'Failed')
    else if (runState === 'canceled') parts.push('Stopped')
    else if (runState === 'reconnecting') {
      const rc = typeof reconnectCount === 'number' && typeof maxReconnects === 'number'
        ? ` ${reconnectCount}/${maxReconnects}` : ''
      parts.push(`Reconnecting${rc}`)
    } else if (runState === 'running') {
      const task = currentTaskTitle || thinkingStatus || (phase === 'planning' ? 'Planning' : phase === 'verification' ? 'Verifying' : phase === 'recovery' ? 'Recovering' : 'Thinking')
      parts.push(`${task}${dots}`)
    } else if (runState === 'completed') {
      parts.push('Completed')
    } else if (thinkingStatus) {
      parts.push(`${thinkingStatus}${dots}`)
    } else {
      parts.push('Waiting')
    }
    if (elapsedText) parts.push(runState === 'completed' ? `in ${elapsedText}` : elapsedText)
    if (isRunning && progress) parts.push(`${progress.iteration}/${progress.maxIterations}`)
    if (!isRunning && toolCount > 0) parts.push(`${toolCount} tool use${toolCount > 1 ? 's' : ''}`)
    if (isRunning && queuedCount > 0) parts.push(`${queuedCount} queued`)
    return parts
  }, [runState, runError, reconnectCount, maxReconnects, currentTaskTitle, thinkingStatus, phase, dots, elapsedText, progress, toolCount, queuedCount, isRunning])

  if (
    toolCalls.length === 0 && !thinkingStatus && !reasoningPreview &&
    !contextUsage && !progress && !runState
  ) return null

  const dim = tokens.colors.textSecondary
  const faint = tokens.colors.alpha[4]
  const sz = tokens.fontSize[1]

  // Hanging indent: ✻ sits in the left margin, body text aligns with message text
  const MARKER_W = 14

  return (
    <div>
      {/* Status line — hanging indent via negative text-indent */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          fontSize: sz,
          color: dim,
          lineHeight: '20px',
          cursor: toolCount > 0 ? 'pointer' : 'default',
          marginLeft: -MARKER_W,
        }}
      >
        <span style={{
          width: MARKER_W,
          flexShrink: 0,
          textAlign: 'center',
          color: isRunning ? dim : faint,
        }}>✻</span>

        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: dim }}>
          {statusParts.join(' · ')}
        </span>

        {isRunning && onStop && (
          <span
            onClick={(e) => { e.stopPropagation(); onStop() }}
            onMouseEnter={(e) => { e.currentTarget.style.color = tokens.colors.textPrimary }}
            onMouseLeave={(e) => { e.currentTarget.style.color = dim }}
            style={{ flexShrink: 0, cursor: 'pointer', marginLeft: tokens.space[2], transition: 'color 150ms ease' }}
          >esc to stop</span>
        )}

        {runState === 'canceled' && onContinue && (
          <span
            onClick={(e) => { e.stopPropagation(); onContinue() }}
            onMouseEnter={(e) => { e.currentTarget.style.color = tokens.colors.textPrimary }}
            onMouseLeave={(e) => { e.currentTarget.style.color = dim }}
            style={{ flexShrink: 0, cursor: 'pointer', marginLeft: tokens.space[2], transition: 'color 150ms ease' }}
          >continue</span>
        )}

        {toolCount > 0 && (
          <span style={{ flexShrink: 0, marginLeft: tokens.space[1], color: faint, fontSize: 10, display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}>▾</span>
        )}
      </div>

      {/* Reasoning snippet — same left edge as message text (no extra indent) */}
      {reasoningSnippet && (
        <div style={{
          marginTop: 2,
          fontSize: sz,
          lineHeight: '16px',
          color: faint,
          whiteSpace: 'pre-wrap',
          maxHeight: 36,
          overflow: 'hidden',
        }}>
          {reasoningSnippet}
        </div>
      )}

      {/* Expanded tool list — collapsed by name with counts */}
      {expanded && collapsed.length > 0 && (
        <div style={{ marginTop: tokens.space[1], display: 'flex', flexDirection: 'column', gap: 1 }}>
          {collapsed.map(entry => (
            <div key={entry.name} style={{ fontSize: sz, lineHeight: '18px', color: dim }}>
              {entry.name}{entry.count > 1 && <span style={{ color: faint }}> ×{entry.count}</span>}
              {entry.errorCount > 0 && (
                <span style={{ color: tokens.colors.error }}>
                  {' '}· {entry.errorCount} error{entry.errorCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Context bar — inline, same level */}
      {expanded && contextUsage && (
        <div style={{ marginTop: tokens.space[1], display: 'flex', alignItems: 'center', gap: tokens.space[2], fontSize: sz, color: faint }}>
          <span>ctx {contextUsage.percent}%</span>
          <div style={{ flex: 1, maxWidth: 80, height: 3, borderRadius: 999, background: tokens.colors.alpha[2], overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, Math.min(100, contextUsage.percent))}%`, height: '100%', background: contextUsage.percent >= 85 ? tokens.colors.warning : faint }} />
          </div>
        </div>
      )}

      {/* LLM call summary */}
      {expanded && (() => {
        const summary = summarizeLLMCalls(llmCalls)
        if (!summary) return null
        const tokenStr = summary.totalTokens > 0 ? ` · ${(summary.totalTokens / 1000).toFixed(1)}k tok` : ''
        return (
          <div style={{ marginTop: tokens.space[1], fontSize: sz, color: faint }}>
            {summary.count} llm call{summary.count > 1 ? 's' : ''} · avg {summary.avgDurationMs}ms{tokenStr}
          </div>
        )
      })()}
    </div>
  )
}
