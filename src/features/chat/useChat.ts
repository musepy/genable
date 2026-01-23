import { useState } from 'preact/hooks'
import { emit } from '@create-figma-plugin/utilities'
import {
  CreateLayersHandler,
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
import { NodeLayer } from '../../schema/layerSchema'
import { postProcess } from '../../engine/layout-engine'
import { t } from '../../ui/i18n'
import { PluginData } from '../../hooks/usePluginData'
import { ThinkingData } from '../../ui/components/ThinkingCard'
import { ChatMessage } from '../../types/chat'

// [Phase 4.6] Orchestration Imports
import { recognizeIntent } from '../../knowledge'


import { generateChatFeedback } from '../../engine/llm-client/feedbackEngine'
import { findTextContent } from '../../utils/figma'
import { isEnabled } from '../../constants/featureFlags'
// Types locally defined or imported
interface NodeLayerWithMeta extends NodeLayer {
  meta?: {
    designSystem?: string;
    styleVariant?: string;
    iconStyle?: string;
    constraints?: string[];
  };
}

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

  const generate = async () => {
    if (!prompt.trim()) return
    
    setLoading(true)
    setLoadingStatus(LOADING_STEPS[0])
    setError(null)
    const currentPrompt = prompt

    // Internal mode detection
    const { selectionStyles, analyzedPattern, variables, libraryResources, patternSummary } = pluginData
    
    const isModifyMode = !!(selectionStyles?.selectionNodes && selectionStyles.selectionNodes.length > 0 && analyzedPattern)
    const modifyTargetId = isModifyMode ? (selectionStyles?.selectionNodes?.[0] as NodeLayer & { id?: string })?.id : undefined

    // Add user message
    setHistory(prev => [...prev, { role: 'user', text: currentPrompt }])
    setPrompt('')

    try {
      const styleContextString = analyzedPattern ? `MIMIC THIS BOX MODEL: ${JSON.stringify(analyzedPattern)}` : ''
      const patternContext = patternSummary ? `\n\n${patternSummary}` : ''

      const designSystemId: DesignSystemId = 'vanilla';

      // [Architecture Phase 4.2] Explicit Config Resolution
      const designSystemConfig = getActiveEngineConfig(designSystemId);

      const referenceNode = selectionStyles?.selectionNodes?.[0] ?? null;

      // [Phase 4.6] Orchestration: Build dependencies BEFORE calling pure function
      // This makes all external data explicit and testable
      // RAG via RagService has been archived (stubbed). KnowledgeHub (MiniSearch) is the active path.
      const prioritizedComponents: any[] = [];
      const goldenTemplates: any[] = [];

      // [Phase 4.7] Pure Trust Architecture: Vanilla Context Only
      // [Phase 4.7] Pure Trust Architecture: Vanilla Context Only
      const dslTemplate = (await import('../../constants/prompts')).DSL_V6_TEMPLATE;
      const intent = recognizeIntent(currentPrompt, undefined, designSystemConfig.patterns);
      const skillName = designSystemConfig.manifest.name;

      const deps: PromptDependencies = {
        ragResults: { prioritizedComponents, goldenTemplates },
        intent,
        designSystemContext: {
          skillName
        }
      };

      const userStylesContext = styleContextString + ' ' + patternContext;

      // [Helper] Check for original text content in selection
      let originalTextContent = '';
      if (referenceNode) {
          originalTextContent = findTextContent(referenceNode);
      }


      const systemPrompt = composeSystemPrompt(deps, {
          isModifyMode,
          userStylesContext, // Passed to style-dna section
          originalTextContent, // Passed to original-content section
          externalTokens: null, // Legacy externalTokens removed
          // userPrompt: currentPrompt // Optional, intent is preferred
      });
      
      flowObserver.startTrace();
      flowObserver.log(FlowPhase.PROMPT, `Creative Generation Mode (${designSystemId})`, { systemPrompt: systemPrompt.substring(0, 500) + '...' });

      setIsThinkingStreaming(true);
      setThinkingText('');

      let data: any;
      let rawText: string;
      let retryCount = 0;
      let finalWarnings: any[] = [];
      let hasRemainingErrors = false;

      if (enableDistributed) {
        setLoadingStatus('Initializing Distributed Thinking...');
        const distributed = new DistributedGenerator(apiKey);
        const result = await distributed.generate({
          apiKey,
          modelName,
          systemPrompt,
          userPrompt: currentPrompt,
          history: analyzedPattern ? [] : history,
          onProgress: (step) => setLoadingStatus(step),
          streaming: true,
          onThinking: (thought) => setThinkingText(thought),
          thinkingLevel,
        });
        data = result.data;
        rawText = result.rawText;
      } else {
        const result = await generateLayoutWithValidation({ 
          apiKey, 
          modelName, 
          systemPrompt, 
          userPrompt: currentPrompt, 
          history: analyzedPattern ? [] : history,
          onProgress: (step) => setLoadingStatus(step),
          // [P0] Constraint Enforcement: Must disable streaming to use responseSchema
          // This ensures valid token generation at the cost of visual streaming
          streaming: false,
          onThinking: (thought) => setThinkingText(thought),
          thinkingLevel,
          designSystemId,
          enableRetry: true,
          maxRetries: 2,
          onRetry: (warnings, attempt) => {
            console.log(`[Self-Correction] Attempt ${attempt}, warnings:`, warnings.map(w => w.humanMessage));
            flowObserver.log(FlowPhase.LLM_RESPONSE, `Self-correction attempt ${attempt}`, { warnings: warnings.length });
          }
        });
        data = result.data;
        rawText = result.rawText;
        retryCount = result.retryCount;
        finalWarnings = result.finalWarnings;
        hasRemainingErrors = result.hasRemainingErrors;
      }
      
      if (retryCount > 0) {
        console.log(`[Self-Correction] Completed after ${retryCount} retries, hasRemainingErrors: ${hasRemainingErrors}`);
        flowObserver.log(FlowPhase.LLM_RESPONSE, `Self-correction completed`, { retryCount, hasRemainingErrors, finalWarnings: finalWarnings.length });
      }

      flowObserver.log(FlowPhase.LLM_RESPONSE, 'Received response from LLM', { rawText });
      flowObserver.log(FlowPhase.LLM_RESPONSE, 'Parsed DSL from LLM', { data });

      // [DIAGNOSTIC] Check for PostProcessor Bypass
      let correctedData;
      
      if (isEnabled('DISABLE_POST_PROCESSOR')) {
        console.log('[DIAGNOSTIC] PostProcessor DISABLED (Raw Output Mode)');
        console.log(`--- [RAW LLM OUTPUT (${designSystemId})] ---`);
        console.log(JSON.stringify(data, null, 2));
        correctedData = data;
      } else {
        correctedData = await postProcess(data);
        console.log(`--- [POST-PROCESSED DSL (${designSystemId})] ---`);
        console.log(JSON.stringify(correctedData, null, 2));
      }

      setIsThinkingStreaming(false);
      const currentRawOutput = rawText;

      setHistory(prev => [...prev, generateChatFeedback(currentPrompt, correctedData, designSystemConfig.manifest.name, currentRawOutput)])



      const payload = {
        ...correctedData,
        __modifyMode: isModifyMode,
        __modifyTargetId: modifyTargetId
      }
      
      const processedPayload = await prefetchIconSvgs(payload as NodeLayer)
      
      const renderContext = {
          width: selectionStyles?.referenceLayout?.width ?? 390,
          height: selectionStyles?.referenceLayout?.height ?? 844,
          isMobile: (selectionStyles?.referenceLayout?.width ?? 390) <= 480
      };

      emit<CreateLayersHandler>('CREATE_LAYERS', { 
        ...processedPayload as NodeLayer,
        designSystemId: designSystemId as any,
        __traceId: flowObserver.getTraceId(),
        renderContext
      })

      // Removed LEARN_FROM_OUTPUT (Legacy StyleMemory)

    } catch (e: unknown) {
      // [Observability] Sync UI error with Console Logs
      console.error('[ChatError] Generation failed:', e);
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
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
