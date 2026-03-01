import { useState, useRef, useEffect } from 'preact/hooks'
import { emit } from '@create-figma-plugin/utilities'
import { AgentOrchestrator } from '../../engine/services/AgentOrchestrator'
import { ChatMessage, ToolCallRecord, IterationRecord } from '../../types/chat'
import { PluginData } from '../../hooks/usePluginData'
import { searchDesignKnowledgeExecutor, projectUIExecutors } from '../../engine/agent/tools/unified/queryKnowledge'
import { validateLayoutExecutor } from '../../engine/agent/tools/unified/validateDesign'
import {
  AgentRuntimeContextUsage,
  AgentRuntimeEvent,
  AgentRuntimePhase,
} from '../../shared/protocol/agentRuntimeEvents'

interface UseChatProps {
  apiKey: string
  modelName: string
  pluginData: PluginData
  setApiKey?: (key: string) => void
  setModelName?: (name: string) => void
  suggestedModels?: { name: string; displayName: string }[]
  onOpenSettings?: () => void
  providerName: 'gemini' | 'openrouter'
}

type RunState = 'idle' | 'running' | 'completed' | 'canceled' | 'error'

export function useChat({
  apiKey,
  modelName,
  pluginData,
  setApiKey,
  setModelName,
  suggestedModels,
  onOpenSettings,
  providerName,
}: UseChatProps) {
  const [prompt, setPrompt] = useState<string>('')
  const [queuedMessages, setQueuedMessages] = useState<Array<{ id: string; text: string }>>([])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingStatus, setLoadingStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [thinkingText, setThinkingText] = useState<string>('')
  const [runtimeState, setRuntimeState] = useState<RunState>('idle')
  const [runtimePhase, setRuntimePhase] = useState<AgentRuntimePhase>('idle')
  const [runtimeProgress, setRuntimeProgress] = useState<{ iteration: number; maxIterations: number } | null>(null)
  const [runtimeContextUsage, setRuntimeContextUsage] = useState<AgentRuntimeContextUsage | null>(null)

  const [thinkingLevel] = useState<'minimal' | 'low' | 'high'>('high')

  const activeOrchestratorRef = useRef<AgentOrchestrator | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const lastPromptRef = useRef<string>('')
  const queueDispatchingRef = useRef(false)

  function isDirectImportJson(input: string): boolean {
    const trimmed = input.trim()
    if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return false
    try {
      return Array.isArray(JSON.parse(trimmed))
    } catch {
      return false
    }
  }

  const findLastStreamingIndex = (messages: ChatMessage[]) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'model' && messages[i].streaming) return i
    }
    return -1
  }

  const updateStreamingMessage = (updater: (msg: ChatMessage) => ChatMessage) => {
    setHistory(prev => {
      const next = [...prev]
      const idx = findLastStreamingIndex(next)
      if (idx === -1) return prev
      next[idx] = updater(next[idx])
      return next
    })
  }

  const handleRuntimeEvent = (event: AgentRuntimeEvent) => {
    if (!activeRunIdRef.current) {
      activeRunIdRef.current = event.runId
    }
    if (activeRunIdRef.current !== event.runId && event.runId !== 'orchestrator_fallback') {
      return
    }

    switch (event.type) {
      case 'iteration_start': {
        setRuntimePhase(event.phase)
        setRuntimeState('running')
        setRuntimeProgress({ iteration: event.iteration, maxIterations: event.maxIterations })
        const newIteration: IterationRecord = {
          iteration: event.iteration,
          thinking: '',
          startTime: event.timestamp,
          taskId: event.taskInfo?.taskId,
          taskTitle: event.taskInfo?.taskTitle,
        }
        updateStreamingMessage(msg => ({
          ...msg,
          iterations: [...(msg.iterations || []), newIteration],
        }))
        break
      }
      case 'tool_call': {
        const newToolCall: ToolCallRecord = {
          id: event.toolCall.id,
          name: event.toolCall.name,
          parameters: event.toolCall.args,
          status: 'running',
          startTime: event.timestamp,
        }
        updateStreamingMessage(msg => ({
          ...msg,
          toolCalls: [...(msg.toolCalls || []), newToolCall],
        }))
        break
      }
      case 'tool_result': {
        updateStreamingMessage(msg => ({
          ...msg,
          toolCalls: (msg.toolCalls || []).map(tc => {
            if (tc.id !== event.toolResult.id) return tc
            return {
              ...tc,
              status: event.toolResult.success ? 'success' : 'error',
              endTime: tc.startTime + event.toolResult.durationMs,
              error: event.toolResult.error,
              result: event.toolResult.raw,
            }
          }),
        }))
        break
      }
      case 'context_usage': {
        setRuntimeContextUsage(event.usage)
        break
      }
      case 'status': {
        setRuntimePhase(event.phase)
        setLoadingStatus(event.message)
        if (event.iteration && event.maxIterations) {
          setRuntimeProgress({ iteration: event.iteration, maxIterations: event.maxIterations })
        }
        break
      }
      case 'reasoning_delta': {
        const delta = event.text || ''
        if (!delta) break

        setThinkingText(prev => `${prev}${delta}`.slice(-4000))
        break
      }
      case 'completed': {
        setLoading(false)
        setRuntimeState('completed')
        setRuntimePhase(event.phase)
        setLoadingStatus('Completed')
        updateStreamingMessage(msg => ({
          ...msg,
          text: event.summary || msg.text || 'Completed',
          streaming: false,
          runState: 'completed',
          endTime: Date.now(),
        }))
        break
      }
      case 'canceled': {
        setLoading(false)
        setRuntimeState('canceled')
        setLoadingStatus('Canceled by user')
        setRuntimePhase(event.phase)
        updateStreamingMessage(msg => ({
          ...msg,
          text: msg.text || event.reason || 'Canceled by user',
          streaming: false,
          runState: 'canceled',
          endTime: Date.now(),
        }))
        break
      }
      case 'error': {
        setLoading(false)
        setRuntimeState('error')
        setRuntimePhase(event.phase)
        setError(event.message)
        updateStreamingMessage(msg => ({
          ...msg,
          streaming: false,
          runState: 'error',
          runError: event.message,
          endTime: Date.now(),
        }))
        break
      }
      default:
        break
    }
  }

  const generateFromPrompt = async (
    inputPrompt: string,
    options: { appendUserMessage?: boolean } = {}
  ) => {
    const normalizedPrompt = inputPrompt.trim()
    if (!normalizedPrompt) return
    const appendUserMessage = options.appendUserMessage !== false

    setLoading(true)
    setError(null)
    setRuntimeState('running')
    setRuntimePhase('idle')
    setRuntimeProgress(null)
    setRuntimeContextUsage(null)
    setLoadingStatus('Agent starting...')
    setThinkingText('')
    activeRunIdRef.current = null
    lastPromptRef.current = normalizedPrompt

    if (isDirectImportJson(normalizedPrompt)) {
      emit<import('../../types').ImportJsonHandler>('IMPORT_JSON', { jsonString: normalizedPrompt })
      setHistory(prev => [
        ...prev,
        { role: 'user', text: '(Imported JSON Data)', id: `u-${Date.now()}` },
        { role: 'model', text: 'Detected JSON layout data. Importing directly into Figma...', id: `m-${Date.now() + 1}` },
      ])
      setPrompt('')
      setLoading(false)
      setRuntimeState('completed')
      setLoadingStatus('Completed')
      return
    }

    const modelMsgId = `m-${Date.now() + 1}`

    setHistory(prev => {
      const next = [...prev]
      if (appendUserMessage) {
        next.push({ role: 'user', text: normalizedPrompt, id: `u-${Date.now()}` })
      }
      next.push({
        role: 'model',
        text: '',
        streaming: true,
        iterations: [],
        toolCalls: [],
        id: modelMsgId,
        startTime: Date.now(),
        runState: 'running',
      })
      return next
    })

    setPrompt('')

    const orchestrator = new AgentOrchestrator({
      apiKey,
      modelName,
      providerName,
      thinkingLevel,
      onRuntimeEvent: handleRuntimeEvent,
    })

    activeOrchestratorRef.current = orchestrator

    try {
      const localExecutors = {
        // ── Unified tool executors ──
        query_knowledge: async (params: any) => {
          switch (params.source) {
            case 'knowledge':
              return searchDesignKnowledgeExecutor(params)
            case 'components':
              return projectUIExecutors.listProjectComponents?.(params) ?? { success: true, data: [] }
            case 'tokens':
              return projectUIExecutors.getDesignSystemTokens?.(params) ?? { success: true, data: [] }
            default:
              return { success: false, error: { code: 'INVALID_SOURCE', message: `Unknown source: ${params.source}` } }
          }
        },
        signal: async (params: any) => {
          // signal tool: plan/task_start/progress/complete
          // 'complete' is handled directly in agentRuntime (returns early as terminal action)
          // Other types are informational and just succeed
          return { success: true, type: params.type, summary: params.summary || params.title || 'Signal received' }
        },
      }

      await orchestrator.generate(normalizedPrompt, { ...pluginData, toolExecutors: localExecutors }, history)
    } catch (e: any) {
      setError(e.message || 'An unexpected error occurred during generation.')
      setRuntimeState('error')
    } finally {
      setLoading(false)
      activeOrchestratorRef.current = null
    }
  }

  const generate = async () => {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return

    if (loading) {
      const queuedId = `u-${Date.now()}`
      // Queue instructions in order and show as regular user messages immediately.
      setQueuedMessages(prev => [...prev, { id: queuedId, text: normalizedPrompt }])
      setHistory(prev => [...prev, { role: 'user', text: normalizedPrompt, id: queuedId }])
      setPrompt('')
      return
    }

    await generateFromPrompt(normalizedPrompt)
  }

  const stopGeneration = () => {
    if (!loading) return
    activeOrchestratorRef.current?.cancel('Canceled by user')
  }

  const continueGeneration = async () => {
    if (loading) return
    const previousPrompt = lastPromptRef.current.trim()
    if (!previousPrompt) return
    await generateFromPrompt(previousPrompt)
  }

  const handleRestore = () => {
    setHistory([])
    setPrompt('')
    setError(null)
    setRuntimeState('idle')
    setRuntimePhase('idle')
    setRuntimeProgress(null)
    setRuntimeContextUsage(null)
    setLoadingStatus('')
    setThinkingText('')
    setQueuedMessages([])
  }

  useEffect(() => {
    if (loading) return
    if (queuedMessages.length === 0) return
    if (queueDispatchingRef.current) return

    const [next, ...rest] = queuedMessages
    const nextPrompt = next.text.trim()
    if (!nextPrompt) {
      setQueuedMessages(rest)
      return
    }

    queueDispatchingRef.current = true
    setQueuedMessages(rest)
    Promise.resolve()
      .then(() => generateFromPrompt(nextPrompt, { appendUserMessage: false }))
      .finally(() => {
        queueDispatchingRef.current = false
      })
  }, [loading, queuedMessages])

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).__GENABLE_PREVIEW__) {
      return
    }

    let timers: number[] = []

    const queue = (delayMs: number, callback: () => void) => {
      const timer = window.setTimeout(callback, delayMs)
      timers.push(timer)
    }

    const clearTimers = () => {
      timers.forEach(timer => window.clearTimeout(timer))
      timers = []
    }

    const modelId = 'preview-model-flow'
    const userId = 'preview-user-flow'

    const setFlowCalls = (calls: ToolCallRecord[], streaming = true, text?: string) => {
      setHistory(prev =>
        prev.map(msg => {
          if (msg.id !== modelId) return msg
          return {
            ...msg,
            toolCalls: calls,
            streaming,
            text: text ?? msg.text,
          }
        })
      )
    }

    const now = () => Date.now()

    const buildCall = (
      id: string,
      name: string,
      status: ToolCallRecord['status'],
      durationMs?: number,
      error?: string
    ): ToolCallRecord => {
      const startTime = now()
      return {
        id,
        name,
        status,
        startTime,
        endTime: durationMs ? startTime + durationMs : undefined,
        parameters: {},
        error,
      }
    }

    const resetPreview = () => {
      clearTimers()
      handleRestore()
      setLoading(false)
    }

    const runFlowSimulation = () => {
      resetPreview()

      const calls: ToolCallRecord[] = []
      setPrompt('Refine the flow, reduce visual noise, and mention @project-ui-context.')
      setRuntimeState('running')
      setRuntimePhase('planning')
      setRuntimeProgress({ iteration: 1, maxIterations: 40 })
      setRuntimeContextUsage({ current: 11872, max: 200000, percent: 6, visibleMessages: 2, hiddenMessages: 0 })
      setLoadingStatus('Planning interaction flow')
      setThinkingText('Analyzing current UI and identifying layout repetition.')
      setLoading(true)
      setError(null)
      setHistory([
        { role: 'user', text: 'Refine this plugin UI flow and keep it cleaner.', id: userId },
        { role: 'model', text: '', streaming: true, iterations: [], toolCalls: [], id: modelId },
      ])

      queue(500, () => {
        setRuntimePhase('execution')
        setRuntimeProgress({ iteration: 8, maxIterations: 40 })
        setLoadingStatus('Applying design patch')
        calls.unshift(buildCall('tc-1', 'patch_node', 'success', 29))
        setFlowCalls([...calls])
      })

      queue(950, () => {
        setRuntimeProgress({ iteration: 10, maxIterations: 40 })
        setLoadingStatus('Reading hierarchy')
        calls.unshift(buildCall('tc-2', 'read_node', 'success', 91))
        setFlowCalls([...calls])
      })

      queue(1400, () => {
        setRuntimeProgress({ iteration: 12, maxIterations: 40 })
        setRuntimeContextUsage({ current: 54410, max: 200000, percent: 27, visibleMessages: 2, hiddenMessages: 3 })
        setLoadingStatus('Building design')
        calls.unshift(buildCall('tc-3', 'build_design', 'success', 370))
        setFlowCalls([...calls])
      })

      queue(1950, () => {
        setRuntimePhase('verification')
        setRuntimeProgress({ iteration: 14, maxIterations: 40 })
        setRuntimeContextUsage({ current: 97738, max: 200000, percent: 49, visibleMessages: 3, hiddenMessages: 8 })
        setLoadingStatus('Verifying output')
        calls.unshift(buildCall('tc-4', 'validate_design', 'success', 73))
        setFlowCalls([...calls])
      })

      queue(2500, () => {
        setLoadingStatus('Patching nodes')
        calls.unshift(buildCall('tc-5', 'patch_node', 'error', 3840, '3 patches failed'))
        setFlowCalls([...calls])
      })

      queue(2950, () => {
        calls.unshift(buildCall('tc-6', 'read_node', 'success', 50))
        setFlowCalls([...calls])
      })

      queue(3600, () => {
        setLoading(false)
        setThinkingText('')
        setRuntimeState('completed')
        setRuntimePhase('verification')
        setLoadingStatus('Completed')
        setFlowCalls(
          [...calls],
          false,
          'Flow simulation complete. UI cleaned up and skill search enabled.'
        )
      })
    }

    const runErrorSimulation = () => {
      resetPreview()

      const calls: ToolCallRecord[] = [
        buildCall('err-1', 'read_node', 'success', 68),
        buildCall('err-2', 'build_design', 'error', 2100, 'Validation failed on 2 nodes'),
      ]

      setPrompt('@design-knowledge improve validation')
      setLoading(true)
      setRuntimeState('running')
      setRuntimePhase('execution')
      setRuntimeProgress({ iteration: 4, maxIterations: 12 })
      setRuntimeContextUsage({ current: 45200, max: 200000, percent: 22, visibleMessages: 2, hiddenMessages: 2 })
      setLoadingStatus('Executing changes')
      setHistory([
        { role: 'user', text: 'Run validation-heavy rewrite', id: `${userId}-error` },
        {
          role: 'model',
          text: '',
          streaming: true,
          iterations: [],
          toolCalls: calls,
          id: `${modelId}-error`,
        },
      ])

      queue(1800, () => {
        setLoading(false)
        setRuntimeState('error')
        setRuntimePhase('recovery')
        setLoadingStatus('Error')
        setError('Validation failed. Please revise the latest instruction.')
        setHistory(prev =>
          prev.map(msg => {
            if (msg.id !== `${modelId}-error`) return msg
            return {
              ...msg,
              streaming: false,
              text: 'The run failed in verification. Try a narrower instruction and retry.',
            }
          })
        )
      })
    }

    ;(window as any).runMockUiFlow = runFlowSimulation
    ;(window as any).runMockUiErrorFlow = runErrorSimulation
    ;(window as any).resetMockUiFlow = resetPreview
    ;(window as any).__GENABLE_PREVIEW_HARNESS__ = {
      runFlowSimulation,
      runErrorSimulation,
      resetPreview,
    }

    queue(600, runFlowSimulation)

    return () => {
      clearTimers()
      delete (window as any).runMockUiFlow
      delete (window as any).runMockUiErrorFlow
      delete (window as any).resetMockUiFlow
      delete (window as any).__GENABLE_PREVIEW_HARNESS__
    }
  }, [])

  return {
    prompt,
    setPrompt,
    history,
    setHistory,
    loading,
    loadingStatus,
    error,
    setError,
    thinkingText,
    handleRestore,
    generate,
    stopGeneration,
    continueGeneration,
    queuedCount: queuedMessages.length,
    runtimeState,
    runtimePhase,
    runtimeProgress,
    runtimeContextUsage,
    // Pass-through props
    apiKey,
    setApiKey,
    modelName,
    setModelName,
    suggestedModels: suggestedModels ?? [],
    onOpenSettings,
    providerName,
  }
}

export type { ChatMessage, UseChatProps }
