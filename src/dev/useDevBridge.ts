import { useEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { emit, on } from '@create-figma-plugin/utilities'
import { ChatMessage } from '../types/chat'
import { AgentRuntimeEvent } from '../shared/protocol/agentRuntimeEvents'
import { generateLogDigest } from '../features/chat/logDigest'
import type { DevBridgeExportHandler, DevBridgeExportResultHandler } from '../types'

const BRIDGE_URL = 'http://localhost:3456'
const HEALTH_INTERVAL_MS = 10_000
const LONG_POLL_WAIT_SEC = 30
const RESULT_TIMEOUT_MS = 300_000 // Force post result if agent runs >5min

type DevBridgeStatus = 'disconnected' | 'connected' | 'polling' | 'executing'
type RunState = 'idle' | 'running' | 'canceled' | 'error' | 'empty_response'

export interface GenerateOptions {
  /** Restrict LLM to only these tools (e.g. ["jsx"]) */
  toolFilter?: string[]
}

interface DevBridgeCallbacks {
  generateFromPrompt: (prompt: string, options?: GenerateOptions) => Promise<void>
  handleRestore: () => void
  switchModel?: (provider: string, model: string) => void
  respondToQuestion?: (answer: string) => void
}

interface DevBridgeState {
  loading: boolean
  runtimeState: RunState
  history: ChatMessage[]
  modelName: string
  eventBufferRef: RefObject<AgentRuntimeEvent[]>
  pendingQuestion: { question: string; options: { label: string; description?: string }[] } | null
}

interface TriggerPayload {
  id: string
  prompt: string
  reset?: boolean
  /** Switch model before running. Format: "provider/model" e.g. "dashscope/kimi-k2.5" or "gemini/gemini-2.5-flash-preview-04-17" */
  model?: string
  /** Restrict LLM to only these tools. E.g. ["jsx"] to cut off inspect/edit/run */
  toolFilter?: string[]
}

async function fetchBridge(path: string, options?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${BRIDGE_URL}${path}`, options)
  } catch {
    return null
  }
}

/** Extract root node IDs from mk/create tool results. Handles both legacy ({idMap}) and current ({data:{idMap}}) shapes. */
function extractRootNodeIds(history: ChatMessage[]): string[] {
  const ids = new Set<string>()
  for (const msg of history) {
    if (!msg.toolCalls) continue
    for (const tc of msg.toolCalls) {
      if (tc.status !== 'success' || !tc.result) continue
      // Accept current (jsx/mk/render) and legacy (design/create) tool names
      if (tc.name !== 'jsx' && tc.name !== 'mk' && tc.name !== 'render' && tc.name !== 'design' && tc.name !== 'create') continue
      const result = typeof tc.result === 'string' ? (() => { try { return JSON.parse(tc.result) } catch { return null } })() : tc.result
      // Current shape: { success, data: { idMap: { n1: "802:1526", ... } } }
      // Legacy shape: { idMap: { symbol: "802:1526", ... } }
      const idMap = result?.data?.idMap || result?.idMap
      if (idMap && typeof idMap === 'object') {
        // First entry is the root node of this mk batch
        const values = Object.values(idMap) as string[]
        if (values.length > 0 && typeof values[0] === 'string') {
          ids.add(values[0])
        }
      }
    }
  }
  return [...ids]
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

  // Stream tool call events to bridge as they complete
  const lastCompletedCountRef = useRef<number>(0)
  useEffect(() => {
    if (!triggerIdRef.current) return
    const allToolCalls = state.history.flatMap(m => m.toolCalls || [])
    // Only count completed tool calls (not 'running')
    const completed = allToolCalls.filter(tc => tc.status !== 'running')
    if (completed.length <= lastCompletedCountRef.current) return
    // Post each newly completed tool call
    for (let i = lastCompletedCountRef.current; i < completed.length; i++) {
      const tc = completed[i]
      const quality = (() => {
        try {
          const r = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result
          const stderr = r?._stderr || ''
          const line = stderr.split('\n').find((l: string) => l.includes('[quality]'))
          return line?.trim() || null
        } catch { return null }
      })()
      fetchBridge(`/event/${triggerIdRef.current}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tool',
          index: i + 1,
          name: tc.name,
          status: tc.status,
          error: tc.error || null,
          quality,
        }),
      }).catch(() => {})
    }
    lastCompletedCountRef.current = completed.length
  }, [state.history])

  // Handle ask_user questions during bridge-initiated runs:
  // stream the question to bridge, long-poll for answer, then respond
  useEffect(() => {
    if (!triggerIdRef.current || !state.pendingQuestion) return
    if (!callbacksRef.current.respondToQuestion) return

    const triggerId = triggerIdRef.current
    const question = state.pendingQuestion
    let canceled = false

    // Stream question event to bridge SSE
    fetchBridge(`/event/${triggerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ask_user_question',
        question: question.question,
        options: question.options,
      }),
    }).catch(() => {})

    console.log(`[DevBridge] ask_user: "${question.question}" — polling /answer/${triggerId}`)

    // Long-poll for answer (up to 120s)
    fetchBridge(`/answer/${triggerId}?wait=120`).then(async (res) => {
      if (canceled) return
      // 200 with answer = explicit response from external caller
      if (res && res.ok) {
        try {
          const data = await res.json()
          if (data.answer && callbacksRef.current.respondToQuestion) {
            console.log(`[DevBridge] answer received: "${data.answer}"`)
            callbacksRef.current.respondToQuestion(data.answer)
            return
          }
        } catch { /* parse error — fall through to fallback */ }
      }
      // Timeout (204), error (404/500), or no answer field → auto-select first option
      if (callbacksRef.current.respondToQuestion) {
        const fallback = question.options[0]?.label || ''
        console.log(`[DevBridge] no answer (status=${res?.status}), auto-selecting: "${fallback}"`)
        callbacksRef.current.respondToQuestion(fallback)
      }
    }).catch(() => {
      if (!canceled && callbacksRef.current.respondToQuestion) {
        const fallback = question.options[0]?.label || ''
        console.log(`[DevBridge] answer fetch failed, auto-selecting: "${fallback}"`)
        callbacksRef.current.respondToQuestion(fallback)
      }
    })

    return () => { canceled = true }
  }, [state.pendingQuestion])

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
    clearResultTimeout()

    console.log(`[DevBridge] Run ended (${prev} → ${curr}), posting result for ${triggerId}`)

    try {
      const historySnapshot = [...stateRef.current.history]
      const runtimeEventsSnapshot = [...(stateRef.current.eventBufferRef.current ?? [])]
      const modelNameSnapshot = stateRef.current.modelName

      // Extract final text from last model message
      const lastModel = [...historySnapshot].reverse().find(m => m.role === 'model')
      const finalText = lastModel?.text || ''

      // Collect tool call details (including per-call results for debugging).
      // Cap rejects (code === 'CAP_REJECT') are runtime-synthesized retry
      // instructions, not genuine tool failures — excluded from `errors` and
      // surfaced separately as `capRejects` for accurate quality metrics.
      const allToolCalls = historySnapshot.flatMap(m => m.toolCalls || [])
      const isCapReject = (tc: typeof allToolCalls[number]) => tc.code === 'CAP_REJECT'
      const toolCallSummary = {
        total: allToolCalls.length,
        errors: allToolCalls.filter(tc => tc.status === 'error' && !isCapReject(tc)).length,
        capRejects: allToolCalls.filter(isCapReject).length,
      }
      const toolCallDetails = allToolCalls.map(tc => {
        let params: string | undefined
        let result: string | undefined
        try { params = tc.parameters ? JSON.stringify(tc.parameters) : undefined } catch { params = '[unserializable]' }
        try { result = tc.result ? JSON.stringify(tc.result) : undefined } catch { result = '[unserializable]' }
        return {
          name: tc.name,
          status: tc.status,
          durationMs: tc.endTime && tc.startTime ? tc.endTime - tc.startTime : undefined,
          params,
          result,
          error: tc.error,
          code: tc.code,
        }
      })

      const logs = generateLogDigest(historySnapshot, { modelName: modelNameSnapshot })
      const rootNodeIds = extractRootNodeIds(historySnapshot)
      const conversationHistory = historySnapshot.map(m => ({
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

      // Request node tree + screenshots from main thread, then POST everything
      requestExport(rootNodeIds).then(({ nodeTree, screenshots }) => {
        let body: string
        try {
          body = JSON.stringify({
            triggerId,
            status: curr,
            finalText,
            durationMs,
            modelName: modelNameSnapshot,
            rootNodeIds,
            toolCallSummary,
            toolCallDetails,
            conversationHistory,
            runtimeEvents: runtimeEventsSnapshot,
            logs,
            nodeTree,
            screenshots,
          })
        } catch (e) {
          console.error('[DevBridge] Failed to serialize result payload:', e)
          // Fallback: post minimal result without large fields
          body = JSON.stringify({
            triggerId,
            status: curr,
            finalText,
            durationMs,
            modelName: modelNameSnapshot,
            toolCallSummary,
            toolCallDetails,
            logs,
            error: `Serialization failed: ${e}`,
          })
        }

        return fetchBridge('/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      }).then((res) => {
        if (res && res.ok) {
          console.log(`[DevBridge] Result posted successfully for ${triggerId}`)
        } else {
          console.error(`[DevBridge] Result POST failed: ${res ? res.status : 'no response'}`)
        }
        setStatus('connected')
      }).catch((err) => {
        console.error('[DevBridge] Failed to post result:', err)
        setStatus('connected')
      })
    } catch (err) {
      console.error('[DevBridge] Error preparing result:', err)
    }
  }, [state.runtimeState])

  // Result timeout: if agent runs too long, force-post a timeout result
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearResultTimeout = () => {
    if (resultTimeoutRef.current) {
      clearTimeout(resultTimeoutRef.current)
      resultTimeoutRef.current = null
    }
  }

  const startResultTimeout = (triggerId: string) => {
    clearResultTimeout()
    resultTimeoutRef.current = setTimeout(() => {
      if (triggerIdRef.current !== triggerId) return
      console.warn(`[DevBridge] Result timeout after ${RESULT_TIMEOUT_MS}ms for ${triggerId}`)
      // DON'T clear triggerIdRef — let the real completion handler still fire
      // and post the actual result, overwriting this timeout placeholder
      fetchBridge('/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerId,
          status: 'timeout',
          finalText: `Agent did not complete within ${RESULT_TIMEOUT_MS / 1000}s`,
          durationMs: RESULT_TIMEOUT_MS,
          modelName: stateRef.current.modelName,
          toolCallSummary: { total: 0, errors: 0, capRejects: 0 },
        }),
      }).catch(() => {})
    }, RESULT_TIMEOUT_MS)
  }

  // Main lifecycle: health-check → long-poll loop
  useEffect(() => {
    let healthTimer: ReturnType<typeof setInterval> | null = null
    let disposed = false
    let longPollActive = false

    const longPollLoop = async () => {
      if (disposed || longPollActive) return
      longPollActive = true
      setStatus('polling')

      while (!disposed) {
        const { loading, runtimeState } = stateRef.current
        // Wait if busy
        if (loading || runtimeState === 'running' || triggerIdRef.current) {
          await new Promise(r => setTimeout(r, 1000))
          continue
        }

        // Long-poll: hangs until server has a trigger or timeout
        const res = await fetchBridge(`/trigger?wait=${LONG_POLL_WAIT_SEC}`)
        if (disposed) break

        if (!res) {
          // Server gone — back to health-checking
          setStatus('disconnected')
          longPollActive = false
          return
        }

        // 204 = no trigger (timeout), loop again
        if (res.status === 204) continue

        let trigger: TriggerPayload
        try {
          trigger = await res.json()
        } catch {
          continue
        }

        if (!trigger || !trigger.prompt) continue

        // Claim the trigger
        await fetchBridge('/trigger', { method: 'DELETE' })

        triggerIdRef.current = trigger.id
        triggerStartTimeRef.current = Date.now()
        lastCompletedCountRef.current = 0
        setStatus('executing')

        // Start result timeout protection
        startResultTimeout(trigger.id)

        // Switch model if requested
        if (trigger.model && callbacksRef.current.switchModel) {
          const [provider, ...modelParts] = trigger.model.split('/')
          const model = modelParts.join('/')
          if (provider && model) {
            console.log(`[DevBridge] Switching model to ${provider}/${model}`)
            callbacksRef.current.switchModel(provider, model)
            await new Promise(r => setTimeout(r, 500))
          }
        }

        // Reset session if requested
        if (trigger.reset) {
          callbacksRef.current.handleRestore()
          await new Promise(r => setTimeout(r, 100))
        }

        callbacksRef.current.generateFromPrompt(trigger.prompt, {
          toolFilter: trigger.toolFilter,
        })
        // Don't loop immediately — wait for result to be posted (useEffect on runtimeState)
        // The long-poll will resume after triggerIdRef is cleared
      }
      longPollActive = false
    }

    const checkHealth = async () => {
      const res = await fetchBridge('/health')
      if (disposed) return
      if (res && res.ok) {
        setStatus(prev => (prev === 'disconnected' ? 'connected' : prev))
        longPollLoop() // Start long-poll if not already running
      } else {
        setStatus('disconnected')
      }
    }

    // Initial health check, then periodic
    checkHealth()
    healthTimer = setInterval(checkHealth, HEALTH_INTERVAL_MS)

    return () => {
      disposed = true
      if (healthTimer) clearInterval(healthTimer)
      clearResultTimeout()
    }
  }, [])

  return { devBridgeStatus: status }
}
