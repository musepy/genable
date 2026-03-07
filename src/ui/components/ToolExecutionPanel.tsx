import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useElapsedTime } from '../hooks/useElapsedTime'
import { tokens } from '../design-system/tokens'
import { ToolCallRecord, LLMCallRecord } from '../../types/chat'
import { AgentRuntimeContextUsage } from '../../shared/protocol/agentRuntimeEvents'
import { categorizeError } from '../../engine/llm-client/errorCategorizer'
import { t } from '../i18n'
import type { ErrorActionType } from '../../config/errorPatterns'

interface ToolExecutionPanelProps {
  toolCalls?: ToolCallRecord[]
  llmCalls?: LLMCallRecord[]
  thinkingStatus?: string
  reasoningPreview?: string
  currentTaskTitle?: string
  phase?: 'execution' | 'idle'
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
  onErrorAction?: (action: ErrorActionType) => void
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
function summarizeLLMCalls(calls: LLMCallRecord[]): { count: number; totalTokens: number; totalPromptTokens: number; totalCompletionTokens: number; avgDurationMs: number } | null {
  const completed = calls.filter(c => c.durationMs != null)
  if (completed.length === 0) return null
  const totalTokens = completed.reduce((sum, c) => sum + (c.usage?.totalTokens || 0), 0)
  const totalPromptTokens = completed.reduce((sum, c) => sum + (c.usage?.promptTokens || 0), 0)
  const totalCompletionTokens = completed.reduce((sum, c) => sum + (c.usage?.completionTokens || 0), 0)
  const totalDuration = completed.reduce((sum, c) => sum + (c.durationMs || 0), 0)
  return {
    count: completed.length,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
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
  onErrorAction,
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
      const task = currentTaskTitle || thinkingStatus || ('Thinking')
      parts.push(`${task}${dots}`)
    } else if (thinkingStatus) {
      parts.push(`${thinkingStatus}${dots}`)
    } else {
      parts.push('Waiting')
    }
    if (elapsedText) parts.push(elapsedText)
    if (isRunning && progress) parts.push(`${progress.iteration}/${progress.maxIterations}`)
    if (!isRunning && toolCount > 0) parts.push(`${toolCount} tool use${toolCount > 1 ? 's' : ''}`)
    return parts
  }, [runState, runError, reconnectCount, maxReconnects, currentTaskTitle, thinkingStatus, phase, dots, elapsedText, progress, toolCount, isRunning])

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
          <span style={{ flexShrink: 0, marginLeft: tokens.space[1], color: faint, fontSize: '10px', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}>▾</span>
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

      {/* Inline error detail */}
      {runState === 'error' && runError && (() => {
        const cat = categorizeError(runError)
        const content = t.errors[cat.i18nKey as keyof typeof t.errors]
        if (!content) return null
        const showAction = (cat.handler === 'openSettings' || cat.handler === 'retry') && onErrorAction
        const isWarning = cat.handler === 'retry'
        const bannerBg = isWarning ? tokens.colors.warningMuted : tokens.colors.errorMuted
        const bannerBorder = isWarning ? tokens.colors.warningBorder : tokens.colors.errorBorder
        const bannerAccent = isWarning ? tokens.colors.warning : tokens.colors.error
        return (
          <div style={{
            marginTop: tokens.space[2],
            background: bannerBg,
            border: `1px solid ${bannerBorder}`,
            borderRadius: 'var(--radius-3)',
            padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[1],
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], minWidth: 0 }}>
              <span style={{ fontSize: sz, fontWeight: tokens.fontWeight.medium, color: bannerAccent, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {content.title}
              </span>
              {showAction && (
                <button
                  onClick={() => onErrorAction(cat.handler)}
                  style={{ marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, color: bannerAccent, fontSize: sz, fontWeight: tokens.fontWeight.medium, cursor: 'pointer' }}
                >
                  {content.action}
                </button>
              )}
            </div>
            <div style={{ fontSize: sz, color: tokens.colors.textSecondary, lineHeight: '16px', whiteSpace: 'normal', wordBreak: 'break-word' }}>
              {content.message}
            </div>
          </div>
        )
      })()}

      {/* Context bar — inline, same level */}
      {expanded && contextUsage && (
        <div style={{ marginTop: tokens.space[1], display: 'flex', alignItems: 'center', gap: tokens.space[2], fontSize: sz, color: faint }}>
          <span>ctx {contextUsage.percent}%</span>
          <div style={{ flex: 1, maxWidth: 80, height: 3, borderRadius: 'var(--radius-full)', background: tokens.colors.alpha[2], overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, Math.min(100, contextUsage.percent))}%`, height: '100%', background: contextUsage.percent >= 85 ? tokens.colors.warning : faint }} />
          </div>
        </div>
      )}

      {/* LLM call summary */}
      {expanded && (() => {
        const summary = summarizeLLMCalls(llmCalls)
        if (!summary) return null
        const hasBreakdown = summary.totalPromptTokens > 0 || summary.totalCompletionTokens > 0
        const tokenStr = hasBreakdown
          ? ` · ${(summary.totalPromptTokens / 1000).toFixed(1)}k in · ${(summary.totalCompletionTokens / 1000).toFixed(1)}k out`
          : summary.totalTokens > 0 ? ` · ${(summary.totalTokens / 1000).toFixed(1)}k tok` : ''
        return (
          <div style={{ marginTop: tokens.space[1], fontSize: sz, color: faint }}>
            {summary.count} llm call{summary.count > 1 ? 's' : ''} · avg {summary.avgDurationMs}ms{tokenStr}
          </div>
        )
      })()}
    </div>
  )
}
