import { useState, useRef, useEffect } from 'preact/hooks'
import { AgentOrchestrator } from '../../engine/services/AgentOrchestrator'
import { ChatMessage, ContentBlock, ToolCallRecord, IterationRecord } from '../../types/chat'
import type { ContextAttachment } from '../../types'
import { PluginData } from '../../hooks/usePluginData'
import { knowledgeSearch } from '../../engine/agent/tools/knowledgeSearch'
import { agentTools } from '../../engine/agent/tools'
import type {
  AgentRuntimeEvent,
} from '../../shared/protocol/agentRuntimeEvents'
import { useDevBridge, GenerateOptions } from '../../dev/useDevBridge'
import { useLocale, useTranslations } from '../../ui/i18n'
import { useMcpBridge } from '../../dev/useMcpBridge'

interface UseChatProps {
  apiKey: string
  modelName: string
  pluginData: PluginData
  setApiKey?: (key: string) => void
  setModelName?: (name: string) => void
  suggestedModels?: { name: string; displayName: string }[]
  onOpenSettings?: () => void
  providerName: 'gemini' | 'openrouter' | 'dashscope' | 'claude'
}

export interface UserQuestionRequest {
  question: string
  options: { label: string; description?: string }[]
}

type RunState = 'idle' | 'running' | 'canceled' | 'error' | 'empty_response'

export interface RetryInfo {
  errorCode: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

const ERROR_CODE_LABELS: Record<string, string> = {
  RETRYABLE_RATE_LIMIT: 'Rate limit',
  RETRYABLE_TRANSIENT: 'Server error',
  RETRYABLE_NETWORK: 'Network',
  RETRYABLE_MALFORMED: 'Format error',
};

function extractErrorCode(message: string, category: string): string {
  const match = message.match(/\b(\d{3})\b/);
  if (match) return match[1];
  return ERROR_CODE_LABELS[category] || category;
}

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
  const locale = useLocale()
  const t = useTranslations()
  const [prompt, setPrompt] = useState<string>('')
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingStatus, setLoadingStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [thinkingText, setThinkingText] = useState<string>('')
  const [runtimeState, setRuntimeState] = useState<RunState>('idle')
  const [pendingQuestion, setPendingQuestion] = useState<UserQuestionRequest | null>(null)
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null)

  const [thinkingLevel] = useState<'minimal' | 'low' | 'high'>('high')

  const activeOrchestratorRef = useRef<AgentOrchestrator | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const eventBufferRef = useRef<AgentRuntimeEvent[]>([])

  // End session and dispose orchestrator
  const endSession = () => {
    activeOrchestratorRef.current?.endSession()
    activeOrchestratorRef.current = null
  }

  // Reset session on config change
  useEffect(() => {
    endSession()
  }, [apiKey, modelName, providerName])

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

  /** Like updateStreamingMessage but targets the last model message regardless of streaming state. */
  const updateLastModelMessage = (updater: (msg: ChatMessage) => ChatMessage) => {
    setHistory(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'model') {
          next[i] = updater(next[i])
          return next
        }
      }
      return prev
    })
  }

  // ---- Block routing helpers ----
  /** Append text to the last text block, or create a new one if last block is tool_group. */
  function appendTextBlock(blocks: ContentBlock[], delta: string): ContentBlock[] {
    const next = [...blocks]
    const last = next[next.length - 1]
    if (last && last.type === 'text') {
      next[next.length - 1] = { ...last, content: last.content + delta }
    } else {
      next.push({ type: 'text', content: delta })
    }
    return next
  }

  /** Add a tool to the last tool_group, or create a new one if last block is text. */
  function appendToolBlock(blocks: ContentBlock[], tool: ToolCallRecord): ContentBlock[] {
    const next = [...blocks]
    const last = next[next.length - 1]
    if (last && last.type === 'tool_group') {
      next[next.length - 1] = { ...last, tools: [...last.tools, tool] }
    } else {
      next.push({ type: 'tool_group', tools: [tool] })
    }
    return next
  }

  /** Update a tool's status within any tool_group block. */
  function updateToolInBlocks(blocks: ContentBlock[], toolId: string, updater: (tc: ToolCallRecord) => ToolCallRecord): ContentBlock[] {
    return blocks.map(block => {
      if (block.type !== 'tool_group') return block
      const hasMatch = block.tools.some(t => t.id === toolId)
      if (!hasMatch) return block
      return { ...block, tools: block.tools.map(t => t.id === toolId ? updater(t) : t) }
    })
  }

  const handleRuntimeEvent = (event: AgentRuntimeEvent) => {
    eventBufferRef.current.push(event)

    if (!activeRunIdRef.current) {
      activeRunIdRef.current = event.runId
    }
    if (activeRunIdRef.current !== event.runId && event.runId !== 'orchestrator_fallback') {
      return
    }

    switch (event.type) {
      case 'iteration_start': {
        setRuntimeState('running')
        setRetryInfo(null)
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
          blocks: appendToolBlock(msg.blocks || [], newToolCall),
        }))
        break
      }
      case 'tool_result': {
        const toolUpdater = (tc: ToolCallRecord) => ({
          ...tc,
          status: (event.toolResult.error ? 'error' : 'success') as ToolCallRecord['status'],
          endTime: tc.startTime + event.toolResult.durationMs,
          error: event.toolResult.error,
          code: event.toolResult.code,
          result: event.toolResult.raw,
        })
        updateStreamingMessage(msg => ({
          ...msg,
          toolCalls: (msg.toolCalls || []).map(tc =>
            tc.id === event.toolResult.id ? toolUpdater(tc) : tc
          ),
          blocks: updateToolInBlocks(msg.blocks || [], event.toolResult.id, toolUpdater),
        }))
        break
      }
      case 'status': {
        setLoadingStatus(event.message)
        break
      }
      case 'reasoning_delta': {
        const delta = event.text || ''
        if (!delta) break

        setThinkingText(prev => `${prev}${delta}`.slice(-4000))
        break
      }
      case 'text_delta': {
        const delta = event.text || ''
        if (!delta) break
        updateStreamingMessage(msg => ({
          ...msg,
          text: (msg.text || '') + delta,
          blocks: appendTextBlock(msg.blocks || [], delta),
        }))
        break
      }
      case 'ask_user_question': {
        setPendingQuestion({ question: event.question, options: event.options })
        break
      }
      case 'turn_end': {
        const isEmptyResponse = !!(event as any).emptyResponse
        setLoading(false)
        setRuntimeState(isEmptyResponse ? 'empty_response' : 'idle')
        setRetryInfo(null)
        setLoadingStatus('')
        updateStreamingMessage(msg => {
          const finalText = event.summary || msg.text || ''
          // Replace last text block with summary, or append one
          let blocks = msg.blocks || []
          if (event.summary) {
            const lastIdx = blocks.length - 1
            if (lastIdx >= 0 && blocks[lastIdx].type === 'text') {
              blocks = [...blocks]
              blocks[lastIdx] = { type: 'text', content: event.summary }
            } else {
              blocks = [...blocks, { type: 'text', content: event.summary }]
            }
          }
          // Empty response: append hint as a text block
          if (isEmptyResponse) {
            blocks = [...blocks, { type: 'text' as const, content: t.emptyResponseHint }]
          }
          return {
            ...msg,
            text: isEmptyResponse ? '' : finalText,
            blocks,
            streaming: false,
            runState: isEmptyResponse ? 'empty_response' : 'completed',
            endTime: Date.now(),
          }
        })
        break
      }
      case 'canceled': {
        setLoading(false)
        setRuntimeState('canceled')
        setLoadingStatus('Canceled by user')
        
        setPendingQuestion(null)
        updateStreamingMessage(msg => ({
          ...msg,
          text: msg.text || event.reason || 'Canceled by user',
          streaming: false,
          runState: 'canceled',
          endTime: Date.now(),
        }))
        break
      }
      case 'retry': {
        setRetryInfo({
          errorCode: extractErrorCode(event.errorMessage, event.errorCategory),
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
        })
        break
      }
      case 'error': {
        setLoading(false)
        setRuntimeState('error')
        setRetryInfo(null)
        setError(event.message)
        setPendingQuestion(null)
        updateStreamingMessage(msg => ({
          ...msg,
          streaming: false,
          runState: 'error',
          runError: event.message,
          endTime: Date.now(),
        }))
        break
      }
      case 'debrief': {
        updateLastModelMessage(msg => ({
          ...msg,
          debrief: {
            exitReason: event.exitReason,
            text: event.debrief,
            structured: event.structured,
          },
        }))
        break
      }
      default:
        break
    }
  }

  const generateFromPrompt = async (inputPrompt: string, options?: GenerateOptions & { attachments?: ContextAttachment[] }) => {
    const normalizedPrompt = inputPrompt.trim()
    if (!normalizedPrompt) return

    // Enrich prompt with skill references for the agent
    const skillTokens = (options?.attachments ?? [])
      .filter((a): a is Extract<ContextAttachment, { type: 'skill' }> => a.type === 'skill')
      .map(a => `@${a.skillId}`)
    const enrichedPrompt = skillTokens.length > 0
      ? `${skillTokens.join(' ')} ${normalizedPrompt}`
      : normalizedPrompt

    setLoading(true)
    setError(null)
    setRuntimeState('running')
    setRetryInfo(null)
    setLoadingStatus('Agent starting...')
    setThinkingText('')
    setPendingQuestion(null)
    activeRunIdRef.current = null
    eventBufferRef.current = []

    setHistory(prev => [
      ...prev,
      { role: 'user', text: normalizedPrompt, attachments: options?.attachments, id: `u-${Date.now()}` },
      {
        role: 'model',
        text: '',
        streaming: true,
        iterations: [],
        toolCalls: [],
        blocks: [],
        id: `m-${Date.now() + 1}`,
        startTime: Date.now(),
        runState: 'running',
      },
    ])

    setPrompt('')

    // Tool filter: restrict LLM to only specified tools (e.g. ["jsx"])
    // Force-recreate orchestrator when filter changes
    const filteredTools = options?.toolFilter
      ? agentTools.filter(t => options.toolFilter!.includes(t.name))
      : undefined
    if (options?.toolFilter) {
      // Destroy existing orchestrator — tool set changed
      activeOrchestratorRef.current?.endSession()
      activeOrchestratorRef.current = null
      console.log(`[useChat] Tool filter active: [${options.toolFilter.join(', ')}]`)
    }

    // Reuse or create orchestrator (session persists across turns)
    if (!activeOrchestratorRef.current) {
      activeOrchestratorRef.current = new AgentOrchestrator({
        apiKey,
        modelName,
        providerName,
        thinkingLevel,
        locale,
        workerUrl: 'https://figma-ai-generator.muse40007.workers.dev',
        onRuntimeEvent: handleRuntimeEvent,
        ...(filteredTools ? { tools: filteredTools } : {}),
      })
    }

    try {
      const localExecutors = {
        knowledge: async (params: any) => {
          const id = params.id || ''
          if (!id) {
            return { success: false, error: 'Missing id. Check the KNOWLEDGE LIBRARY menu in your system context.' }
          }
          const content = knowledgeSearch.read(id)
          if (!content) {
            return { success: false, error: `Unknown id "${id}". Check the KNOWLEDGE LIBRARY menu in your system context.` }
          }
          return { success: true, data: { id, content } }
        },
      }

      await activeOrchestratorRef.current.generate(enrichedPrompt, { toolExecutors: localExecutors })
    } catch (e: any) {
      console.error('[useChat] Unhandled generation error:', e)
      setRuntimeState('error')
    } finally {
      setLoading(false)
    }
  }

  const generate = async (attachments?: ContextAttachment[]) => {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt || loading) return
    await generateFromPrompt(normalizedPrompt, { attachments })
  }

  const stopGeneration = () => {
    if (!loading) return
    activeOrchestratorRef.current?.cancel('Canceled by user')
  }

  const continueGeneration = async () => {
    if (loading) return
    await generateFromPrompt('Continue from where you left off.')
  }

  const retryGeneration = async () => {
    if (loading) return
    // Find the last user message to re-send
    const lastUser = [...history].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    const retryPrompt = lastUser.text
    // Remove the empty user+model pair from UI history, then re-send
    setHistory(prev => {
      if (prev.length >= 2 && prev[prev.length - 1]?.runState === 'empty_response') {
        return prev.slice(0, -2)
      }
      return prev
    })
    await generateFromPrompt(retryPrompt)
  }

  const respondToQuestion = (answer: string) => {
    activeOrchestratorRef.current?.answerQuestion(answer)
    setPendingQuestion(null)
  }

  const handleRestore = () => {
    endSession()
    setHistory([])
    setPrompt('')
    setError(null)
    setRuntimeState('idle')
    setRetryInfo(null)
    setLoadingStatus('')
    setThinkingText('')
    setPendingQuestion(null)
  }

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

    const setFlowCalls = (calls: ToolCallRecord[], streaming = true, text?: string, msgRunState?: ChatMessage['runState']) => {
      setHistory(prev =>
        prev.map(msg => {
          if (msg.id !== modelId) return msg
          // Build blocks from toolCalls + text
          const blocks: ContentBlock[] = []
          if (calls.length > 0) blocks.push({ type: 'tool_group', tools: calls })
          const finalText = text ?? msg.text
          if (finalText) blocks.push({ type: 'text', content: finalText })
          return {
            ...msg,
            toolCalls: calls,
            blocks,
            streaming,
            text: finalText,
            ...(msgRunState ? { runState: msgRunState } : {}),
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
      setPrompt('Refine the flow, reduce visual noise.')
      setRuntimeState('running')
      setLoadingStatus('Planning interaction flow')
      setThinkingText('Analyzing current UI and identifying layout repetition.')
      setLoading(true)
      setError(null)
      setHistory([
        { role: 'user', text: 'Refine this plugin UI flow and keep it cleaner.', id: userId },
        { role: 'model', text: '', streaming: true, iterations: [], toolCalls: [], blocks: [], id: modelId },
      ])

      queue(500, () => {
        setLoadingStatus('Applying design patch')
        calls.unshift(buildCall('tc-1', 'edit', 'success', 29))
        setFlowCalls([...calls])
      })

      queue(950, () => {
        setLoadingStatus('Reading hierarchy')
        calls.unshift(buildCall('tc-2', 'inspect', 'success', 91))
        setFlowCalls([...calls])
      })

      queue(1400, () => {
        setLoadingStatus('Building design')
        calls.unshift(buildCall('tc-3', 'jsx', 'success', 370))
        setFlowCalls([...calls])
      })

      queue(1950, () => {
        setLoadingStatus('Patching nodes')
        calls.unshift(buildCall('tc-5', 'edit', 'error', 3840, '3 edits failed'))
        setFlowCalls([...calls])
      })

      queue(2950, () => {
        calls.unshift(buildCall('tc-6', 'inspect', 'success', 50))
        setFlowCalls([...calls])
      })

      queue(3600, () => {
        setLoading(false)
        setThinkingText('')
        setRuntimeState('idle')
        setLoadingStatus('')
        setFlowCalls(
          [...calls],
          false,
          'Flow simulation complete. UI cleaned up and skill search enabled.',
          'completed'
        )
      })
    }

    const runErrorSimulation = () => {
      resetPreview()

      const calls: ToolCallRecord[] = [
        buildCall('err-1', 'inspect', 'success', 68),
        buildCall('err-2', 'jsx', 'error', 2100, 'Validation failed on 2 nodes'),
      ]

      setPrompt('@design-knowledge improve validation')
      setLoading(true)
      setRuntimeState('running')
      setLoadingStatus('Executing changes')
      // Simulate retry info
      setRetryInfo({ errorCode: '429', attempt: 1, maxAttempts: 5, delayMs: 2000 })
      queue(800, () => setRetryInfo({ errorCode: '429', attempt: 2, maxAttempts: 5, delayMs: 4000 }))
      queue(1400, () => setRetryInfo(null))
      setHistory([
        { role: 'user', text: 'Run validation-heavy rewrite', id: `${userId}-error` },
        {
          role: 'model',
          text: '',
          streaming: true,
          iterations: [],
          toolCalls: calls,
          blocks: [{ type: 'tool_group' as const, tools: calls }],
          id: `${modelId}-error`,
        },
      ])

      queue(1800, () => {
        setLoading(false)
        setRuntimeState('error')
        setLoadingStatus('Error')
        setError('Validation failed. Please revise the latest instruction.')
        setHistory(prev =>
          prev.map(msg => {
            if (msg.id !== `${modelId}-error`) return msg
            return {
              ...msg,
              streaming: false,
              runState: 'error',
              runError: 'Validation failed. Please revise the latest instruction.',
              text: 'The run failed in verification. Try a narrower instruction and retry.',
            }
          })
        )
      })
    }

    let activeReplayControl: { abort: () => void } | null = null

    const runEventReplay = (events: AgentRuntimeEvent[], opts?: { speed?: number; prompt?: string }) => {
      // Abort any previous replay
      activeReplayControl?.abort()
      activeReplayControl = null

      resetPreview()

      const speed = opts?.speed ?? 5
      const promptText = opts?.prompt ?? 'Replaying recorded session'

      setHistory([
        { role: 'user', text: promptText, id: `u-replay-${Date.now()}` },
        {
          role: 'model',
          text: '',
          streaming: true,
          iterations: [],
          toolCalls: [],
          id: `m-replay-${Date.now() + 1}`,
          startTime: Date.now(),
          runState: 'running',
        },
      ])
      setLoading(true)
      setRuntimeState('running')
      activeRunIdRef.current = null

      // Dynamic import to avoid bundling replay engine in production
      import('../../../preview/eventReplay').then(({ replayEvents }) => {
        const control = replayEvents(events, {
          speed,
          onEvent: handleRuntimeEvent,
          onComplete: () => {
            activeReplayControl = null
          },
        })
        activeReplayControl = control
      })
    }

    ;(window as any).runMockUiFlow = runFlowSimulation
    ;(window as any).runMockUiErrorFlow = runErrorSimulation
    ;(window as any).resetMockUiFlow = resetPreview
    ;(window as any).__GENABLE_PREVIEW_HARNESS__ = {
      runFlowSimulation,
      runErrorSimulation,
      resetPreview,
      runEventReplay,
    }

    queue(600, runFlowSimulation)

    return () => {
      clearTimers()
      activeReplayControl?.abort()
      delete (window as any).runMockUiFlow
      delete (window as any).runMockUiErrorFlow
      delete (window as any).resetMockUiFlow
      delete (window as any).__GENABLE_PREVIEW_HARNESS__
    }
  }, [])

  const switchModel = (provider: string, model: string) => {
    const validProviders = ['gemini', 'openrouter', 'dashscope'] as const
    if (validProviders.includes(provider as any)) {
      (setModelName as any)?.(model)
      // providerName is not directly settable from useChat — we need the parent's setter
      // For now, emit a message that the parent can handle
      ;(window as any).__GENABLE_SWITCH_PROVIDER__?.(provider, model)
    }
  }

  const { devBridgeStatus } = useDevBridge(
    { generateFromPrompt, handleRestore, switchModel, respondToQuestion },
    { loading, runtimeState, history, modelName, eventBufferRef, pendingQuestion },
  )

  const { mcpBridgeStatus } = useMcpBridge()

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
    retryGeneration,
    pendingQuestion,
    respondToQuestion,
    runtimeState,
    retryInfo,
    // Pass-through props
    apiKey,
    setApiKey,
    modelName,
    setModelName,
    suggestedModels: suggestedModels ?? [],
    onOpenSettings,
    providerName,
    devBridgeStatus,
    mcpBridgeStatus,
  }
}

export type { ChatMessage, UseChatProps }
