import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, PauseCircle, Terminal } from 'lucide-preact'
import { tokens } from '../design-system/tokens'
import { ToolCallRecord } from '../../types/chat'
import { AgentRuntimeContextUsage, AgentRuntimePhase } from '../../shared/protocol/agentRuntimeEvents'

interface ToolExecutionPanelProps {
  toolCalls?: ToolCallRecord[]
  thinkingStatus?: string
  reasoningPreview?: string
  currentTaskTitle?: string
  phase?: AgentRuntimePhase
  progress?: { iteration: number; maxIterations: number } | null
  contextUsage?: AgentRuntimeContextUsage | null
  runState?: 'idle' | 'running' | 'completed' | 'canceled' | 'error'
  onStop?: () => void
  onContinue?: () => void
  queuedCount?: number
}

function getPhaseLabel(phase?: AgentRuntimePhase): string {
  switch (phase) {
    case 'planning':
      return 'Planning'
    case 'execution':
      return 'Executing'
    case 'verification':
      return 'Verifying'
    case 'recovery':
      return 'Recovering'
    default:
      return 'Idle'
  }
}

function getRunStateLabel(state?: ToolExecutionPanelProps['runState']): string {
  switch (state) {
    case 'running':
      return 'Working'
    case 'completed':
      return 'Completed'
    case 'canceled':
      return 'Stopped'
    case 'error':
      return 'Needs attention'
    default:
      return 'Waiting'
  }
}

function formatDurationMs(record: ToolCallRecord): string {
  if (!record.endTime) return '-'
  const durationMs = Math.max(0, record.endTime - record.startTime)
  return `${durationMs}ms`
}

function formatToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function RunStateIcon({ runState }: { runState: ToolExecutionPanelProps['runState'] }) {
  if (runState === 'error') return <AlertCircle size={14} color={tokens.colors.error} />
  if (runState === 'completed') return <CheckCircle2 size={14} color={tokens.colors.success} />
  if (runState === 'canceled') return <PauseCircle size={14} color={tokens.colors.warning} />
  if (runState === 'running') return <Loader2 size={14} color={tokens.colors.textSecondary} />
  return <Terminal size={14} color={tokens.colors.textSecondary} />
}

function ToolStatusIcon({ status }: { status: ToolCallRecord['status'] }) {
  if (status === 'error') return <AlertCircle size={12} color={tokens.colors.error} />
  if (status === 'success') return <CheckCircle2 size={12} color={tokens.colors.success} />
  if (status === 'running' || status === 'pending') return <Loader2 size={12} color={tokens.colors.textSecondary} />
  return <Terminal size={12} color={tokens.colors.textSecondary} />
}

function useRunningDots(active: boolean) {
  const [dots, setDots] = useState('')

  useEffect(() => {
    if (!active) {
      setDots('')
      return
    }
    const timer = window.setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : `${prev}.`))
    }, 350)
    return () => window.clearInterval(timer)
  }, [active])

  return dots
}

export function ToolExecutionPanel({
  toolCalls = [],
  thinkingStatus,
  reasoningPreview,
  currentTaskTitle,
  phase,
  progress,
  contextUsage,
  runState,
  onStop,
  onContinue,
  queuedCount = 0,
}: ToolExecutionPanelProps) {
  const recentCalls = toolCalls.slice(-6).reverse()
  const [expanded, setExpanded] = useState(false)
  const dots = useRunningDots(runState === 'running')
  const reasoningSnippet = reasoningPreview ? reasoningPreview.slice(-240) : ''

  useEffect(() => {
    if (runState === 'error') setExpanded(true)
  }, [runState])

  const summaryText = useMemo(() => {
    const base = currentTaskTitle || thinkingStatus || getPhaseLabel(phase)
    if (runState === 'running' && progress) {
      const queueHint = queuedCount > 0 ? ` · ${queuedCount} queued` : ''
      return `${base} · ${progress.iteration}/${progress.maxIterations}${queueHint}${dots}`
    }
    if (runState === 'running') {
      const queueHint = queuedCount > 0 ? ` · ${queuedCount} queued` : ''
      return `${base}${queueHint}${dots}`
    }
    return base
  }, [currentTaskTitle, thinkingStatus, phase, runState, progress, dots, queuedCount])

  const contextPercent = contextUsage ? Math.max(0, Math.min(100, contextUsage.percent)) : 0

  if (
    toolCalls.length === 0 &&
    !thinkingStatus &&
    !reasoningPreview &&
    !contextUsage &&
    !progress &&
    !runState
  ) {
    return null
  }

  return (
    <div style={{
      border: `1px solid ${tokens.colors.alpha[3]}`,
      borderRadius: 'var(--radius-4)',
      background: tokens.colors.surface,
      padding: `${tokens.space[2]}px ${tokens.space[2]}px`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
        <button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: tokens.space[2],
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
            color: tokens.colors.textPrimary,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
            <RunStateIcon runState={runState} />
            <span style={{ fontSize: tokens.fontSize[1], fontWeight: 500 }}>
              {getRunStateLabel(runState)}
            </span>
          </div>
          <ChevronDown
            size={14}
            color={tokens.colors.textSecondary}
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
            }}
          />
        </button>

        {runState === 'running' && onStop && (
          <button
            onClick={onStop}
            style={{
              height: 24,
              border: `1px solid ${tokens.colors.alpha[4]}`,
              borderRadius: 999,
              background: 'transparent',
              color: tokens.colors.textSecondary,
              fontSize: 11,
              padding: '0 10px',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        )}

        {runState === 'canceled' && onContinue && (
          <button
            onClick={onContinue}
            style={{
              height: 24,
              border: `1px solid ${tokens.colors.alpha[4]}`,
              borderRadius: 999,
              background: 'transparent',
              color: tokens.colors.textSecondary,
              fontSize: 11,
              padding: '0 10px',
              cursor: 'pointer',
            }}
          >
            Continue
          </button>
        )}
      </div>

      <div style={{
        marginTop: 4,
        fontSize: tokens.fontSize[1],
        color: tokens.colors.textSecondary,
        lineHeight: '16px',
        paddingLeft: 20,
      }}>
        {summaryText}
      </div>

      {reasoningSnippet && (
        <div style={{
          marginTop: 4,
          marginLeft: 20,
          fontSize: 11,
          lineHeight: '15px',
          color: tokens.colors.textSecondary,
          whiteSpace: 'pre-wrap',
          maxHeight: 48,
          overflow: 'hidden',
        }}>
          {reasoningSnippet}
        </div>
      )}

      <div style={{
        maxHeight: expanded ? 360 : 0,
        opacity: expanded ? 1 : 0,
        overflow: 'hidden',
        transition: 'max-height 180ms ease, opacity 140ms ease',
        marginTop: expanded ? tokens.space[2] : 0,
        paddingTop: expanded ? tokens.space[2] : 0,
        borderTop: expanded ? `1px solid ${tokens.colors.alpha[2]}` : 'none',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          <div style={{ fontSize: tokens.fontSize[1], fontWeight: 500, color: tokens.colors.textPrimary }}>
            Recent actions
          </div>
          {recentCalls.length === 0 ? (
            <div style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
              No action yet.
            </div>
          ) : (
            recentCalls.map(record => (
              <div key={record.id} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '12px 1fr auto',
                  alignItems: 'center',
                  gap: tokens.space[1],
                  fontSize: tokens.fontSize[1],
                  color: tokens.colors.textPrimary,
                }}>
                  <ToolStatusIcon status={record.status} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatToolName(record.name)}
                  </span>
                  <span style={{ color: tokens.colors.textSecondary, fontSize: 11 }}>
                    {formatDurationMs(record)}
                  </span>
                </div>
                {record.error && (
                  <div style={{
                    marginLeft: 16,
                    fontSize: 11,
                    color: tokens.colors.error,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {record.error}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div style={{
          marginTop: tokens.space[2],
          paddingTop: tokens.space[2],
          borderTop: `1px solid ${tokens.colors.alpha[2]}`,
        }}>
          <div style={{ fontSize: tokens.fontSize[1], fontWeight: 500, color: tokens.colors.textPrimary, marginBottom: 4 }}>
            Context usage
          </div>
          {contextUsage ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
                <span>{contextUsage.current}/{contextUsage.max}</span>
                <span>{contextUsage.percent}%</span>
              </div>
              <div style={{
                height: 4,
                borderRadius: 999,
                background: tokens.colors.alpha[2],
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${contextPercent}%`,
                  height: '100%',
                  background: contextPercent >= 85 ? tokens.colors.warning : tokens.colors.textPrimary,
                }} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
              Not available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
