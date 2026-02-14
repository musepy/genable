import { useState, useRef } from 'preact/hooks'
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
import { searchDesignKnowledge, getComponentAnatomy, getFigmaLayoutRules } from '../../engine/agent/tools/knowledgeTools'
import { validateLayout } from '../../engine/agent/tools/validationTools'

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

  // [FIX] Use refs for stale closure protection in callbacks like onComplete
  const iterationsRef = useRef<IterationRecord[]>([]);
  const toolCallsRef = useRef<ToolCallRecord[]>([]);

  // Update refs in sync with state
  const setIterationsWithRef = (val: IterationRecord[] | ((prev: IterationRecord[]) => IterationRecord[])) => {
    setIterations(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      iterationsRef.current = next;
      return next;
    });
  };

  const setToolCallsWithRef = (val: ToolCallRecord[] | ((prev: ToolCallRecord[]) => ToolCallRecord[])) => {
    setCurrentToolCalls(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      toolCallsRef.current = next;
      return next;
    });
  };
  
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
    setToolCallsWithRef([]); // Use ref-synced setter
    setIterationsWithRef([]); // Use ref-synced setter [FIX] Clear previous iterations
    setThinkingText(''); // [FIX] Clear thinking text
    const currentPrompt = prompt;

    if (isDirectImportJson(currentPrompt)) {
      console.log('[Dogfood] Detected JSON Array, bypassing LLM for direct import.');
      emit<import('../../types').ImportJsonHandler>('IMPORT_JSON', { jsonString: currentPrompt });
      setHistory(prev => [
        ...prev, 
        { role: 'user', text: '(Imported JSON Data)', id: `u-${Date.now()}` },
        { role: 'model', text: '✅ Detected JSON layout data. Importing directly into Figma...', id: `m-${Date.now() + 1}` }
      ]);
      setPrompt('');
      setLoading(false);
      return;
    }
    
    const findLastStreamingIndex = (msgs: ChatMessage[]) => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'model' && msgs[i].streaming) return i;
      }
      return -1;
    };

    const userMsgId = `u-${Date.now()}`;
    const modelMsgId = `m-${Date.now() + 1}`;

    setHistory(prev => [...prev, { role: 'user', text: currentPrompt, id: userMsgId }]);
    
    // [NEW] Push initial model response placeholder to history
    setHistory(prev => [...prev, { 
      role: 'model', 
      text: '', 
      streaming: true,
      iterations: [],
      toolCalls: [],
      id: modelMsgId
    }]);

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
        
        // Sync to history
        setHistory(prev => {
          const next = [...prev];
          const idx = findLastStreamingIndex(next);
          if (idx === -1) return prev;
          const msg = next[idx];
          const its = [...(msg.iterations || [])];
          if (its.length > 0) {
            its[its.length - 1] = { ...its[its.length - 1], thinking: thought };
          }
          next[idx] = { ...msg, iterations: its };
          return next;
        });

        // Still update state/ref for local use if needed
        setIterationsWithRef(prev => {
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
        const newIt = {
          iteration,
          thinking: '',
          startTime: Date.now(),
          taskId: taskInfo?.taskId,
          taskTitle: taskInfo?.taskTitle
        };
        
        setHistory(prev => {
          const next = [...prev];
          const idx = findLastStreamingIndex(next);
          if (idx === -1) return prev;
          const msg = next[idx];
          next[idx] = { ...msg, iterations: [...(msg.iterations || []), newIt] };
          return next;
        });

        setIterationsWithRef(prev => [...prev, newIt]);
      },
      onComplete: (data, rawText) => {
        setIsThinkingStreaming(false);
        setHistory(prev => {
          const next = [...prev];
          const lastIndex = findLastStreamingIndex(next);
          if (lastIndex === -1) return prev;
          
          next[lastIndex] = { 
            ...next[lastIndex],
            role: 'model', 
            text: rawText || 'Agent loop complete.',
            toolCalls: [...toolCallsRef.current],
            iterations: [...iterationsRef.current],
            streaming: false // Mark as complete
          };
          return next;
        });
        setLoading(false);
      },
      onIteration: (iteration, response, taskInfo) => {
        setIterationsWithRef(prev => {
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
        const newTc: ToolCallRecord = {
          id: tc.id,
          name: tc.name,
          parameters: tc.args,
          status: 'running',
          startTime: Date.now()
        };

        setHistory(prev => {
          const next = [...prev];
          const idx = findLastStreamingIndex(next);
          if (idx === -1) return prev;
          const msg = next[idx];
          next[idx] = { ...msg, toolCalls: [...(msg.toolCalls || []), newTc] };
          return next;
        });

        setToolCallsWithRef(prev => [...prev, newTc]);
      },
      onToolResult: (id, result) => {
        const updater = (t: ToolCallRecord) => {
          if (t.id !== id) return t;

          const isError = result?.success === false;
          const status: ToolCallRecord['status'] = isError ? 'error' : 'success';
          const errorMessage = isError
            ? (result?.error?.message || result?.error?.code || 'Tool execution failed.')
            : undefined;

          return {
            ...t,
            status,
            result,
            error: errorMessage,
            endTime: Date.now()
          };
        };
        
        setHistory(prev => {
          const next = [...prev];
          const idx = findLastStreamingIndex(next);
          if (idx === -1) return prev;
          const msg = next[idx];
          next[idx] = { ...msg, toolCalls: (msg.toolCalls || []).map(updater) };
          return next;
        });

        setToolCallsWithRef(prev => prev.map(updater));
      }
    });

    try {
      const localExecutors = { searchDesignKnowledge, getComponentAnatomy, getFigmaLayoutRules, validateLayout };

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
