import { useState, useRef, useEffect } from 'preact/hooks'
import { AgentOrchestrator } from '../../engine/services/AgentOrchestrator'
import { ChatMessage, ContentBlock, ToolCallRecord, IterationRecord, LLMCallRecord } from '../../types/chat'
import { PluginData } from '../../hooks/usePluginData'
import guidelinesCatalog from '../../generated/guidelines-catalog.json'
import styleCatalog from '../../generated/style-catalog.json'
import { matchStyleGuide, normalizeStyleTags, StyleGuideEntry } from './styleGuideMatcher'
import { helpIndex } from '../../engine/agent/tools/helpIndex'
import { agentTools } from '../../engine/agent/tools'
import skillsRegistry from '../../generated/skills-registry.json'

// ==========================================
// Skill lookup helpers (from build-time skills-registry.json)
// ==========================================

type SkillRegistryEntry = { id: string; name: string; description: string; body: string }

function getSkillById(id: string): SkillRegistryEntry | null {
  const entry = (skillsRegistry as Record<string, any>)[id]
  if (!entry) return null
  return { id: entry.id, name: entry.name, description: entry.description, body: entry.body }
}

function getSkillTopics(): { id: string; title: string; whenToUse: string }[] {
  return Object.values(skillsRegistry as Record<string, any>).map((s: any) => ({
    id: s.id,
    title: s.name,
    whenToUse: s.description,
  }))
}
import {
  AgentRuntimeContextUsage,
  AgentRuntimeEvent,
} from '../../shared/protocol/agentRuntimeEvents'
import { useDevBridge, GenerateOptions } from '../../dev/useDevBridge'
import { useMcpBridge } from '../../dev/useMcpBridge'

interface UseChatProps {
  apiKey: string
  modelName: string
  pluginData: PluginData
  setApiKey?: (key: string) => void
  setModelName?: (name: string) => void
  suggestedModels?: { name: string; displayName: string }[]
  onOpenSettings?: () => void
  providerName: 'gemini' | 'openrouter' | 'dashscope'
}

export interface ToolApprovalRequest {
  toolCalls: { id: string; name: string; args: any }[]
}

type RunState = 'idle' | 'running' | 'canceled' | 'error'

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
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingStatus, setLoadingStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [thinkingText, setThinkingText] = useState<string>('')
  const [runtimeState, setRuntimeState] = useState<RunState>('idle')
  const [runtimePhase, setRuntimePhase] = useState<'execution' | 'idle'>('idle')
  const [runtimeProgress, setRuntimeProgress] = useState<{ iteration: number; maxIterations: number } | null>(null)
  const [runtimeContextUsage, setRuntimeContextUsage] = useState<AgentRuntimeContextUsage | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const [memoryCount, setMemoryCount] = useState<number>(0)

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
      case 'llm_request': {
        const record: LLMCallRecord = {
          llmCallId: event.llmCallId,
          iteration: event.iteration,
          startTime: event.timestamp,
          messageCount: event.messageCount,
          toolNames: event.toolNames,
          config: event.config,
        }
        updateStreamingMessage(msg => ({
          ...msg,
          llmCalls: [...(msg.llmCalls || []), record],
        }))
        break
      }
      case 'llm_response': {
        updateStreamingMessage(msg => ({
          ...msg,
          llmCalls: (msg.llmCalls || []).map(rec => {
            if (rec.llmCallId !== event.llmCallId) return rec
            return {
              ...rec,
              endTime: event.timestamp,
              durationMs: event.durationMs,
              usage: event.usage,
              responseShape: event.responseShape,
              success: event.success,
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
        if ((event as any).memoryCount !== undefined) {
          setMemoryCount((event as any).memoryCount)
        }
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
      case 'tool_approval_request': {
        setPendingApproval({ toolCalls: event.toolCalls })
        break
      }
      case 'budget_exhausted': {
        updateStreamingMessage(msg => ({
          ...msg,
          budgetExhausted: true,
        }))
        break
      }
      case 'turn_end': {
        setLoading(false)
        setRuntimeState('idle')
        setRuntimePhase(event.phase)
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
          return {
            ...msg,
            text: finalText,
            blocks,
            streaming: false,
            runState: 'completed',
            endTime: Date.now(),
          }
        })
        break
      }
      case 'canceled': {
        setLoading(false)
        setRuntimeState('canceled')
        setLoadingStatus('Canceled by user')
        setRuntimePhase(event.phase)
        setPendingApproval(null)
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
        setLoadingStatus(`Retrying (${event.attempt}/${event.maxAttempts})...`)
        break
      }
      case 'error': {
        setLoading(false)
        setRuntimeState('error')
        setRuntimePhase(event.phase)
        setError(event.message)
        setPendingApproval(null)
        updateStreamingMessage(msg => ({
          ...msg,
          streaming: false,
          runState: 'error',
          runError: event.message,
          runErrorCode: event.code,
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

  const generateFromPrompt = async (inputPrompt: string, options?: GenerateOptions) => {
    const normalizedPrompt = inputPrompt.trim()
    if (!normalizedPrompt) return

    setLoading(true)
    setError(null)
    setRuntimeState('running')
    setRuntimePhase('idle')
    setRuntimeProgress(null)
    setRuntimeContextUsage(null)
    setLoadingStatus('Agent starting...')
    setThinkingText('')
    setPendingApproval(null)
    activeRunIdRef.current = null
    eventBufferRef.current = []

    setHistory(prev => [
      ...prev,
      { role: 'user', text: normalizedPrompt, id: `u-${Date.now()}` },
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
        workerUrl: 'https://figma-ai-generator.muse40007.workers.dev',
        requireToolApproval: false,
        onRuntimeEvent: handleRuntimeEvent,
        ...(filteredTools ? { tools: filteredTools } : {}),
      })
    }

    try {
      const localExecutors = {
        query: async (params: any) => {
          if (params.source === 'guidelines') {
            const topic = (params.query || '').toLowerCase().trim()
            const content = (guidelinesCatalog as Record<string, string>)[topic]
            if (!content) {
              return { success: false, error: `Unknown topic "${topic}". Available: ${Object.keys(guidelinesCatalog).join(', ')}` }
            }
            return { success: true, data: { topic, content } }
          }
          if (params.source === 'style-tags') {
            return { success: true, data: { tags: (styleCatalog as any).tags } }
          }
          if (params.source === 'style') {
            const queryTags = normalizeStyleTags(params.query || '')
            const guides = (styleCatalog as any).guides as Record<string, StyleGuideEntry>
            const match = matchStyleGuide(queryTags, guides)
            if (!match) {
              return { success: false, error: `No style guide matched tags "${queryTags.join(', ')}". Use query(source="style-tags") to see available tags.` }
            }
            return {
              success: true,
              data: { name: match.name, tags: match.guide.tags, content: match.guide.content }
            }
          }
          if (params.source === 'help') {
            const query = (params.query || '').trim()
            if (!query) {
              return { success: true, data: { topics: [...helpIndex.listTopics(), ...getSkillTopics()] } }
            }
            // 1. Exact match helpIndex
            const exact = helpIndex.getById(query)
            if (exact) {
              return { success: true, data: { topic: exact.id, title: exact.title, content: exact.content } }
            }
            // 2. Exact match skill ID
            const skill = getSkillById(query)
            if (skill) {
              return { success: true, data: { topic: skill.id, title: skill.name, content: skill.body } }
            }
            // 3. BM25 fuzzy search helpIndex
            const results = helpIndex.search(query, 2)
            if (results.length > 0) {
              return { success: true, data: { results: results.map(r => ({ topic: r.id, title: r.title, content: r.content })) } }
            }
            // 4. No match
            return { success: true, data: {
              message: `No help article matched "${query}".`,
              availableTopics: [...helpIndex.listTopics(), ...getSkillTopics()]
            } }
          }
          return null
        },
        knowledge: async (params: any) => {
          // knowledge tool — local knowledge sources (guidelines, style, help)
          const source = params.source || 'help'
          // Accept both 'topic' (new schema) and 'query' (legacy) for the lookup key
          const topicOrQuery = params.topic || params.tags || params.query || ''
          if (source === 'guidelines') {
            const topic = topicOrQuery.toLowerCase().trim()
            const content = (guidelinesCatalog as Record<string, string>)[topic]
            if (!content) {
              return { success: false, error: `Unknown topic "${topic}". Available: ${Object.keys(guidelinesCatalog).join(', ')}` }
            }
            return { success: true, data: { topic, content } }
          }
          if (source === 'style-tags') {
            return { success: true, data: { tags: (styleCatalog as any).tags } }
          }
          if (source === 'style') {
            const queryTags = normalizeStyleTags(topicOrQuery)
            const guides = (styleCatalog as any).guides as Record<string, StyleGuideEntry>
            const match = matchStyleGuide(queryTags, guides)
            if (!match) {
              return { success: false, error: `No style guide matched tags "${queryTags.join(', ')}". Use knowledge({source: "style-tags"}) to see available tags.` }
            }
            return {
              success: true,
              data: { name: match.name, tags: match.guide.tags, content: match.guide.content }
            }
          }
          if (source === 'help') {
            const query = topicOrQuery.trim()
            if (!query) {
              return { success: true, data: { topics: [...helpIndex.listTopics(), ...getSkillTopics()] } }
            }
            // 1. Exact match helpIndex
            const exact = helpIndex.getById(query)
            if (exact) {
              return { success: true, data: { topic: exact.id, title: exact.title, content: exact.content } }
            }
            // 2. Exact match skill ID
            const skill = getSkillById(query)
            if (skill) {
              return { success: true, data: { topic: skill.id, title: skill.name, content: skill.body } }
            }
            // 3. BM25 fuzzy search helpIndex
            const results = helpIndex.search(query, 2)
            if (results.length > 0) {
              return { success: true, data: { results: results.map(r => ({ topic: r.id, title: r.title, content: r.content })) } }
            }
            // 4. No match
            return { success: true, data: {
              message: `No help article matched "${query}".`,
              availableTopics: [...helpIndex.listTopics(), ...getSkillTopics()]
            } }
          }
          return null
        },
      }

      await activeOrchestratorRef.current.generate(normalizedPrompt, { toolExecutors: localExecutors })
    } catch (e: any) {
      console.error('[useChat] Unhandled generation error:', e)
      setRuntimeState('error')
    } finally {
      setLoading(false)
    }
  }

  const generate = async () => {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt || loading) return
    await generateFromPrompt(normalizedPrompt)
  }

  const stopGeneration = () => {
    if (!loading) return
    activeOrchestratorRef.current?.cancel('Canceled by user')
  }

  const continueGeneration = async () => {
    if (loading) return
    await generateFromPrompt('Continue from where you left off.')
  }

  const respondToApproval = (approved: boolean) => {
    activeOrchestratorRef.current?.approveTools(approved)
    setPendingApproval(null)
  }

  const handleRestore = () => {
    endSession()
    setHistory([])
    setPrompt('')
    setError(null)
    setRuntimeState('idle')
    setRuntimePhase('idle')
    setRuntimeProgress(null)
    setRuntimeContextUsage(null)
    setLoadingStatus('')
    setThinkingText('')
    setPendingApproval(null)
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
      setRuntimePhase('execution')
      setRuntimeProgress({ iteration: 1, maxIterations: 40 })
      setRuntimeContextUsage({ current: 11872, max: 200000, percent: 6, visibleMessages: 2, hiddenMessages: 0 })
      setLoadingStatus('Planning interaction flow')
      setThinkingText('Analyzing current UI and identifying layout repetition.')
      setLoading(true)
      setError(null)
      setHistory([
        { role: 'user', text: 'Refine this plugin UI flow and keep it cleaner.', id: userId },
        { role: 'model', text: '', streaming: true, iterations: [], toolCalls: [], blocks: [], id: modelId },
      ])

      queue(500, () => {
        setRuntimePhase('execution')
        setRuntimeProgress({ iteration: 8, maxIterations: 40 })
        setLoadingStatus('Applying design patch')
        calls.unshift(buildCall('tc-1', 'edit', 'success', 29))
        setFlowCalls([...calls])
      })

      queue(950, () => {
        setRuntimeProgress({ iteration: 10, maxIterations: 40 })
        setLoadingStatus('Reading hierarchy')
        calls.unshift(buildCall('tc-2', 'outline', 'success', 91))
        setFlowCalls([...calls])
      })

      queue(1400, () => {
        setRuntimeProgress({ iteration: 12, maxIterations: 40 })
        setRuntimeContextUsage({ current: 54410, max: 200000, percent: 27, visibleMessages: 2, hiddenMessages: 3 })
        setLoadingStatus('Building design')
        calls.unshift(buildCall('tc-3', 'create', 'success', 370))
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
        setRuntimePhase('idle')
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
        buildCall('err-1', 'outline', 'success', 68),
        buildCall('err-2', 'create', 'error', 2100, 'Validation failed on 2 nodes'),
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
          blocks: [{ type: 'tool_group' as const, tools: calls }],
          id: `${modelId}-error`,
        },
      ])

      queue(1800, () => {
        setLoading(false)
        setRuntimeState('error')
        setRuntimePhase('idle')
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
    { generateFromPrompt, handleRestore, switchModel },
    { loading, runtimeState, history, modelName, eventBufferRef },
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
    pendingApproval,
    respondToApproval,
    runtimeState,
    runtimePhase,
    runtimeProgress,
    runtimeContextUsage,
    memoryCount,
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
