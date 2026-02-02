import { useState } from 'preact/hooks'
import { emit } from '@create-figma-plugin/utilities'
import {
  ClearStreamHandler,
  CreateLayersHandler,
  StreamLayersHandler,
} from '../../types'
// [ARCHIVED] contextBuilder.ts moved to _archive
import { AgentOrchestrator } from '../../engine/services/AgentOrchestrator'
import { ChatMessage, ToolCallRecord, IterationRecord } from '../../types/chat'
import { PluginData } from '../../hooks/usePluginData'

interface UseChatProps {
  apiKey: string
  modelName: string
  pluginData: PluginData
  setApiKey?: (key: string) => void
  setModelName?: (name: string) => void
  suggestedModels?: { name: string; displayName: string }[]
  onOpenSettings?: () => void
  providerName: 'gemini' | 'openrouter' // [NEW]
}

export function useChat({ 
  apiKey, 
  modelName, 
  pluginData,
  setApiKey,
  setModelName,
  suggestedModels,
  onOpenSettings,
  providerName
}: UseChatProps) {
  const [prompt, setPrompt] = useState<string>('')
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingStatus, setLoadingStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  
  // Thinking Stream states
  const [thinkingText, setThinkingText] = useState<string>('')
  const [isThinkingStreaming, setIsThinkingStreaming] = useState<boolean>(false)
  
  // [NEW] Token Usage State
  const [tokenUsage, setTokenUsage] = useState<any>(null);

  // [NEW] Tool Execution State for Phase 1
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolCallRecord[]>([]);
  const [iterations, setIterations] = useState<IterationRecord[]>([]); // [NEW]
  
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

  function isDirectImportJson(input: string): boolean {
    const trimmed = input.trim();
    if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return false;
    try {
      return Array.isArray(JSON.parse(trimmed));
    } catch {
      return false;
    }
  }

  const generate = async () => {
    if (!prompt.trim()) return;
    
    setLoading(true);
    setError(null);
    setCurrentToolCalls([]);
    const currentPrompt = prompt;

    if (isDirectImportJson(currentPrompt)) {
      console.log('[Dogfood] Detected JSON Array, bypassing LLM for direct import.');
      emit<import('../../types').ImportJsonHandler>('IMPORT_JSON', { jsonString: currentPrompt });
      setHistory(prev => [
        ...prev, 
        { role: 'user', text: '(Imported JSON Data)' },
        { role: 'model', text: '✅ Detected JSON layout data. Importing directly into Figma...' }
      ]);
      setPrompt('');
      setLoading(false);
      return;
    }

    setHistory(prev => [...prev, { role: 'user', text: currentPrompt }]);
    setPrompt('');

    const orchestrator = new AgentOrchestrator({
      apiKey,
      modelName,
      providerName,
      thinkingLevel,
      onStatusChange: setLoadingStatus,
      onThinkingUpdate: (thought) => {
        setIsThinkingStreaming(true);
        setThinkingText(thought);
        setIterations(prev => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.thinking === thought) return prev;
          next[next.length - 1] = { ...last, thinking: thought };
          return next;
        });
      },
      onUsageUpdate: setTokenUsage,
      onIterationStart: (iteration, taskInfo) => {
        setIterations(prev => [...prev, {
          iteration,
          thinking: '',
          startTime: Date.now(),
          taskId: taskInfo?.taskId,
          taskTitle: taskInfo?.taskTitle
        }]);
      },
      onComplete: (data, rawText) => {
        setIsThinkingStreaming(false);
        setHistory(prev => [...prev, { 
          role: 'model', 
          text: rawText || 'Agent loop complete.',
          toolCalls: [...currentToolCalls],
          iterations: [...iterations]
        }]);
        setLoading(false);
      },
      onIteration: (iteration, response, taskInfo) => {
        setIterations(prev => {
          const idx = prev.findIndex(it => it.iteration === iteration);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { 
            ...next[idx], 
            taskId: taskInfo?.taskId || next[idx].taskId,
            taskTitle: taskInfo?.taskTitle || next[idx].taskTitle
          };
          return next;
        });
      },
      onError: (msg) => {
        setError(msg);
        setLoading(false);
      },
      onToolCall: (tc) => {
        setCurrentToolCalls(prev => [...prev, {
          id: tc.id,
          name: tc.name,
          parameters: tc.args,
          status: 'running',
          startTime: Date.now()
        }]);
      },
      onToolResult: (id, result) => {
        setCurrentToolCalls(prev => prev.map(t => 
          t.id === id ? { ...t, status: 'success', result, endTime: Date.now() } : t
        ));
      }
    });

    try {
      const { searchDesignKnowledge, getComponentAnatomy, getFigmaLayoutRules } = await import('../../engine/agent/tools/knowledgeTools');
      const localExecutors = { searchDesignKnowledge, getComponentAnatomy, getFigmaLayoutRules };

      await orchestrator.generate(currentPrompt, { ...pluginData, toolExecutors: localExecutors }, history);
    } catch (e: any) {
      console.error('[useChat] Error during generation:', e);
      setError(e.message || 'An unexpected error occurred during generation.');
    } finally {
      setLoading(false);
      setIsThinkingStreaming(false);
    }
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
    handleRestore,
    generate,
    // Pass through props
    apiKey,
    setApiKey,
    modelName,
    setModelName,
    suggestedModels: suggestedModels ?? [],
    onOpenSettings,
    providerName, // [NEW]
    tokenUsage, // [NEW]
    currentToolCalls, // [NEW]
    iterations // [NEW]
  }
}

export type { ChatMessage, UseChatProps }
