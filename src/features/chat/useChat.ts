import { useState } from 'preact/hooks'
import { emit } from '@create-figma-plugin/utilities'
import {
  ClearStreamHandler,
  CreateLayersHandler,
  StreamLayersHandler,
} from '../../types'
// [ARCHIVED] contextBuilder.ts moved to _archive
import { composeSystemPrompt } from '../../engine/llm-client/context/promptComposer'
import { PromptDependencies } from '../../types/context'
import { getActiveEngineConfig } from '../../engine/engineConfig'
import { DesignSystemId } from '../../types/designSystem'
import { flowObserver, FlowPhase } from '../../engine/figma-adapter/observers/flowObserver'
import { generateLayoutWithValidation, DistributedGenerator } from '../../engine/llm-client'
import { prefetchIconSvgs } from '../../engine/figma-adapter/assets/iconPrefetcher'
import { LOADING_STEPS } from '../../constants'
import { coerceNodeLayer, FlatNode, NodeLayer } from '../../schema/layerSchema'
import { postProcess } from '../../engine/layout-engine'
import { TreeReconstructor } from '../../engine/figma-adapter/treeReconstructor'
import { t } from '../../ui/i18n'
import { PluginData } from '../../hooks/usePluginData'
import { ThinkingData } from '../../ui/components/ThinkingCard'
import { ChatMessage } from '../../types/chat'
import { generateChatFeedback } from '../../engine/llm-client/feedbackEngine'
import { ChatOrchestrator } from '../../engine/services/ChatOrchestrator'

interface UseChatProps {
  apiKey: string
  modelName: string
  pluginData: PluginData
  setApiKey?: (key: string) => void
  setModelName?: (name: string) => void
  suggestedModels?: { name: string; displayName: string }[]
  onOpenSettings?: () => void
}

export function useChat({ 
  apiKey, 
  modelName, 
  pluginData,
  setApiKey,
  setModelName,
  suggestedModels,
  onOpenSettings
}: UseChatProps) {
  const [prompt, setPrompt] = useState<string>('')
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingStatus, setLoadingStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  
  // Thinking Stream states
  const [thinkingText, setThinkingText] = useState<string>('')
  const [isThinkingStreaming, setIsThinkingStreaming] = useState<boolean>(false)
  
  // Thinking Level for Gemini 3.0+ (default: high)
  const [thinkingLevel] = useState<'minimal' | 'low' | 'high'>('high')
  
  // Feature flags
  const [enableDistributed] = useState<boolean>(false)

  const handleUndo = () => {
    if (history.length >= 2) {
      setHistory(prev => prev.slice(0, -2))
    }
  }

  const handleRestore = () => {
    setHistory([])
    setPrompt('')
    setError(null)
  }

// [Phase 2] Use Orchestrator for generation
  const generate = async () => {
    if (!prompt.trim()) return
    
    setLoading(true)
    setError(null)
    const currentPrompt = prompt

    // Add user message
    setHistory(prev => [...prev, { role: 'user', text: currentPrompt }])
    setPrompt('')

    const orchestrator = new ChatOrchestrator({
      apiKey,
      modelName,
      thinkingLevel,
      onStatusChange: (status) => setLoadingStatus(status),
      onThinkingUpdate: (thought) => {
        setIsThinkingStreaming(true);
        setThinkingText(thought);
      },
      onComplete: (data, rawText) => {
        setIsThinkingStreaming(false);
        const designSystemName = getActiveEngineConfig('vanilla').manifest.name;
        setHistory(prev => [...prev, generateChatFeedback(currentPrompt, data, designSystemName, rawText)]);
        setLoading(false);
      },
      onError: (msg) => {
        setError(msg);
        setLoading(false);
      }
    });

    await orchestrator.generate(currentPrompt, pluginData, history);
  }


  return {
    prompt,
    setPrompt,
    history,
    setHistory,
    loading,
    loadingStatus,
    error,
    setError,  // Allow clearing error from UI
    thinkingText,
    isThinkingStreaming,
    handleUndo,
    handleRestore,
    generate,
    // Pass through props
    apiKey,
    setApiKey,
    modelName,
    setModelName,
    suggestedModels: suggestedModels ?? [],
    onOpenSettings
  }
}

export type { ChatMessage, UseChatProps }
