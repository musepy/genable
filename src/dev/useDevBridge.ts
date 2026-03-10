import { useEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { emit, on } from '@create-figma-plugin/utilities'
import { ChatMessage } from '../types/chat'
import { AgentRuntimeEvent } from '../shared/protocol/agentRuntimeEvents'
import { generateLogDigest } from '../features/chat/logDigest'
import type { DevBridgeExportHandler, DevBridgeExportResultHandler } from '../types'

const BRIDGE_URL = 'http://localhost:3456'
const HEALTH_INTERVAL_MS = 10_000
const POLL_INTERVAL_MS = 2_000

type DevBridgeStatus = 'disconnected' | 'connected' | 'polling' | 'executing'
type RunState = 'idle' | 'running' | 'canceled' | 'error'

interface DevBridgeCallbacks {
  generateFromPrompt: (prompt: string) => Promise<void>
  handleRestore: () => void
  switchModel?: (provider: string, model: string) => void
}

interface DevBridgeState {
  loading: boolean
  runtimeState: RunState
  history: ChatMessage[]
  modelName: string
  eventBufferRef: RefObject<AgentRuntimeEvent[]>
}

interface TriggerPayload {
  id: string
  prompt: string
  reset?: boolean
  /** Switch model before running. Format: "provider/model" e.g. "dashscope/kimi-k2.5" or "gemini/gemini-2.5-flash-preview-04-17" */
  model?: string
}

async function fetchBridge(path: string, options?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${BRIDGE_URL}${path}`, options)
  } catch {
    return null
  }
}

/** Extract root node IDs from create tool results. Result shape: { idMap: { symbol: "802:1526", ... } } */
function extractRootNodeIds(history: ChatMessage[]): string[] {
  const ids: string[] = []
  for (const msg of history) {
    if (!msg.toolCalls) continue
    for (const tc of msg.toolCalls) {
      if (tc.name !== 'create' || tc.status !== 'success' || !tc.result) continue
      const result = typeof tc.result === 'string' ? (() => { try { return JSON.parse(tc.result) } catch { return null } })() : tc.result
      if (result?.idMap && typeof result.idMap === 'object') {
        // First entry in idMap is the root node
        const values = Object.values(result.idMap) as string[]
        if (values.length > 0 && typeof values[0] === 'string') {
          ids.push(values[0])
        }
      }
    }
  }
  return ids
}

/** Request node tree + screenshots from main thread via IPC. Timeout after 10s. */
function requestExport(rootNodeIds?: string[]): Promise<{ nodeTree: any; screenshots: Array<{ nodeId: string; name: string; base64: string }> }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ nodeTree: null, screenshots: [] })
    }, 10_000)

    const cleanup = on<DevBridgeExportResultHandler>('DEV_BRIDGE_EXPORT_RESULT', (data) => {
      clearTimeout(timeout)
      cleanup()
      resolve(data)
    })

    emit<DevBridgeExportHandler>('DEV_BRIDGE_EXPORT', { rootNodeIds })
  })
}

export function useDevBridge(callbacks: DevBridgeCallbacks, state: DevBridgeState) {
  const [status, setStatus] = useState<DevBridgeStatus>('disconnected')

  // Ref-based access to latest callbacks and state — avoids stale closures in setInterval
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const stateRef = useRef(state)
  stateRef.current = state

  // Non-null only during bridge-initiated runs
  const triggerIdRef = useRef<string | null>(null)
  const triggerStartTimeRef = useRef<number>(0)

  // Track previous runtimeState for transition detection
  const prevRuntimeStateRef = useRef<RunState>(state.runtimeState)

  // Post result back to bridge when a bridge-initiated run ends
  useEffect(() => {
    const prev = prevRuntimeStateRef.current
    const curr = state.runtimeState
    prevRuntimeStateRef.current = curr

    // Only fire on running → idle/error/canceled transitions
    if (prev !== 'running' || curr === 'running') return
    // Only for bridge-initiated runs
    if (!triggerIdRef.current) return

    const triggerId = triggerIdRef.current
    const durationMs = Date.now() - triggerStartTimeRef.current
    triggerIdRef.current = null
    triggerStartTimeRef.current = 0

    // Extract final text from last model message
    const lastModel = [...state.history].reverse().find(m => m.role === 'model')
    const finalText = lastModel?.text || ''

    // Collect tool call details (including per-call results for debugging)
    const allToolCalls = state.history.flatMap(m => m.toolCalls || [])
    const toolCallSummary = {
      total: allToolCalls.length,
      errors: allToolCalls.filter(tc => tc.status === 'error').length,
    }
    const toolCallDetails = allToolCalls.map(tc => ({
      name: tc.name,
      status: tc.status,
      durationMs: tc.endTime && tc.startTime ? tc.endTime - tc.startTime : undefined,
      params: tc.parameters ? JSON.stringify(tc.parameters) : undefined,
      result: tc.result ? JSON.stringify(tc.result) : undefined,
      error: tc.error,
    }))

    const logs = generateLogDigest(state.history, { modelName: state.modelName })
    const rootNodeIds = extractRootNodeIds(state.history)

    // Request node tree + screenshots from main thread, then POST everything
    requestExport(rootNodeIds).then(({ nodeTree, screenshots }) => {
      // Serialize full conversation history for debugging LLM decisions
      const conversationHistory = state.history.map(m => ({
        role: m.role,
        text: m.text,
        toolCalls: m.toolCalls?.map(tc => ({
          name: tc.name,
          parameters: tc.parameters,
          result: tc.result,
          status: tc.status,
          error: tc.error,
        })),
      }))

      const payload = {
        triggerId,
        status: curr,
        finalText,
        durationMs,
        modelName: state.modelName,
        toolCallSummary,
        toolCallDetails,
        conversationHistory,
        runtimeEvents: stateRef.current.eventBufferRef.current,
        logs,
        nodeTree,
        screenshots,
      }

      return fetchBridge('/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }).then(() => {
      setStatus('connected')
    })
  }, [state.runtimeState])

  // Main lifecycle: health-check → poll loop
  useEffect(() => {
    let healthTimer: ReturnType<typeof setInterval> | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let disposed = false

    const startPolling = () => {
      if (pollTimer || disposed) return
      setStatus('polling')
      pollTimer = setInterval(pollTrigger, POLL_INTERVAL_MS)
    }

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const checkHealth = async () => {
      const res = await fetchBridge('/health')
      if (disposed) return
      if (res && res.ok) {
        setStatus(prev => (prev === 'disconnected' ? 'connected' : prev))
        startPolling()
      } else {
        stopPolling()
        setStatus('disconnected')
      }
    }

    const pollTrigger = async () => {
      const { loading, runtimeState } = stateRef.current
      // Skip if busy
      if (loading || runtimeState === 'running' || triggerIdRef.current) return

      const res = await fetchBridge('/trigger')
      if (!res || !res.ok) {
        // Server gone — back to health-checking
        if (!res) {
          stopPolling()
          setStatus('disconnected')
        }
        return
      }

      let trigger: TriggerPayload
      try {
        trigger = await res.json()
      } catch {
        return
      }

      if (!trigger || !trigger.prompt) return

      // Claim the trigger
      await fetchBridge('/trigger', { method: 'DELETE' })

      triggerIdRef.current = trigger.id
      triggerStartTimeRef.current = Date.now()
      setStatus('executing')

      // Switch model if requested (triggers session reset via useChat's useEffect)
      if (trigger.model && callbacksRef.current.switchModel) {
        const [provider, ...modelParts] = trigger.model.split('/')
        const model = modelParts.join('/')
        if (provider && model) {
          console.log(`[DevBridge] Switching model to ${provider}/${model}`)
          callbacksRef.current.switchModel(provider, model)
          // Wait for session reset to settle
          await new Promise(r => setTimeout(r, 500))
        }
      }

      // Reset session if requested
      if (trigger.reset) {
        callbacksRef.current.handleRestore()
        // Small delay to let state settle after reset
        await new Promise(r => setTimeout(r, 100))
      }

      callbacksRef.current.generateFromPrompt(trigger.prompt)
    }

    // Initial health check, then periodic
    checkHealth()
    healthTimer = setInterval(checkHealth, HEALTH_INTERVAL_MS)

    return () => {
      disposed = true
      if (healthTimer) clearInterval(healthTimer)
      stopPolling()
    }
  }, [])

  return { devBridgeStatus: status }
}
