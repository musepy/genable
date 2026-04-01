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

/** Special-case overrides for tool display names that don't auto-derive well. */
const TOOL_DISPLAY_OVERRIDES: Record<string, string> = {
  jsx: 'JSX',
  js: 'JavaScript',
}

/** Auto-derive display name: snake_case → Title Case, with overrides. */
function getDisplayName(c: ToolCallRecord): string {
  if (TOOL_DISPLAY_OVERRIDES[c.name]) return TOOL_DISPLAY_OVERRIDES[c.name]
  return c.name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
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
  const isError = runState === 'error'
  const dots = useRunningDots(isRunning)
  const elapsedText = useElapsedTime(taskStartTime, isRunning, taskEndTime)
  const reasoningSnippet = reasoningPreview ? reasoningPreview.slice(-200) : ''
  const toolCount = toolCalls.length
  const collapsed = useMemo(() => collapseCalls(toolCalls), [toolCalls])
  const errorCount = useMemo(() => toolCalls.filter(c => c.status === 'error').length, [toolCalls])

  // Latest tool activity for live feed
  const latestTool = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null

  useEffect(() => {
    if (isRunning && onStop) {
      const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onStop() }
      window.addEventListener('keydown', h)
      return () => window.removeEventListener('keydown', h)
    }
  }, [isRunning, onStop])

  useEffect(() => {
    if (isError) setExpanded(true)
  }, [isError])

  // Build status text — preview style: "12.4s · 8 tools" (completed), "3.2s" (running)
  const statusParts = useMemo(() => {
    const parts: string[] = []
    if (isError) parts.push(runError || 'Failed')
    else if (runState === 'canceled') parts.push('Stopped')
    else if (runState === 'reconnecting') {
      const rc = typeof reconnectCount === 'number' && typeof maxReconnects === 'number'
        ? ` ${reconnectCount}/${maxReconnects}` : ''
      parts.push(`Reconnecting${rc}`)
    } else if (isRunning) {
      // Running: just elapsed time
    } else {
      // Idle/waiting — no label needed
    }
    if (elapsedText) parts.push(elapsedText)
    if (!isRunning && toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`)
    if (!isRunning && errorCount > 0) parts.push(`${errorCount} failed`)
    return parts
  }, [runState, runError, reconnectCount, maxReconnects, dots, elapsedText, toolCount, errorCount, isRunning, isError])

  if (
    toolCalls.length === 0 && !thinkingStatus && !reasoningPreview &&
    !contextUsage && !progress && !runState
  ) return null

  const dim = tokens.colors.textSecondary
  const faint = tokens.colors.alpha[4]
  const sz = tokens.fontSize[1]
  const MARKER_W = 14

  // Marker color — preview: running=accent, done=gray-6, error=error
  const stateColor = isError ? tokens.colors.error : (isRunning ? tokens.colors.accent : 'var(--gray-6)')

  return (
    <div style={{
      // Error: subtle left border accent
      borderLeft: isError ? `2px solid ${tokens.colors.error}` : undefined,
      paddingLeft: isError ? tokens.space[2] : undefined,
      // Error: subtle tinted background
      background: isError ? tokens.colors.errorMuted : undefined,
      borderRadius: isError ? 'var(--radius-2)' : undefined,
      marginLeft: isError ? -tokens.space[2] : undefined,
      paddingTop: isError ? tokens.space[1] : undefined,
      paddingBottom: isError ? tokens.space[1] : undefined,
    }}>
      {/* Status line */}
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
          color: stateColor,
        }}>{isError ? '✕' : '✻'}</span>

        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isError ? tokens.colors.error : dim }}>
          {statusParts.join(' · ')}
        </span>

        {isRunning && onStop && (
          <span
            onClick={(e) => { e.stopPropagation(); onStop() }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            style={{ flexShrink: 0, cursor: 'pointer', marginLeft: 'auto', padding: '2px 6px', borderRadius: 'var(--radius-2)', color: dim, transition: 'background 150ms ease' }}
          >esc</span>
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

      {/* Progress bar removed — iteration count is not meaningful to users */}

      {/* Live tool feed — ⎿ bracket style per preview design */}
      {isRunning && latestTool && (
        <div
          key={latestTool.name + toolCount}
          style={{
            marginTop: 2,
            fontSize: sz,
            lineHeight: '18px',
            color: dim,
            display: 'flex',
            alignItems: 'baseline',
            gap: 0,
            overflow: 'hidden',
            height: '18px',
            animation: 'tool-slide-up 0.25s ease-out',
          }}
        >
          <span style={{ color: faint, marginRight: 6, fontSize: '13px', lineHeight: '18px' }}>⎿</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getDisplayName(latestTool)}
          </span>
        </div>
      )}

      {/* Reasoning snippet */}
      {reasoningSnippet && !isRunning && (
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

      {/* Expanded tool list — collapsed by name with counts + status icons */}
      {expanded && collapsed.length > 0 && (
        <div style={{ marginTop: tokens.space[1], display: 'flex', flexDirection: 'column', gap: 2 }}>
          {collapsed.map(entry => (
            <div key={entry.name} style={{ fontSize: sz, lineHeight: '18px', color: dim, display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
              <span style={{ color: entry.errorCount > 0 ? tokens.colors.error : tokens.colors.success, fontSize: '8px', width: 10, textAlign: 'center' }}>
                {entry.errorCount > 0 ? '✕' : '✓'}
              </span>
              <span>{entry.name}</span>
              {entry.count > 1 && <span style={{ color: faint }}>×{entry.count}</span>}
              {entry.errorCount > 0 && (
                <span style={{ color: tokens.colors.error, fontSize: '11px' }}>
                  {entry.errorCount} failed
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Inline error detail (user-actionable) */}
      {isError && runError && (() => {
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

      {/* Context bar — inline */}
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
