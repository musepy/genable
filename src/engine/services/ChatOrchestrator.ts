/**
 * @file ChatOrchestrator.ts
 * @description Core service to orchestrate the LLM generation flow.
 * Decouples logic from the useChat hook.
 */

import { emit } from '@create-figma-plugin/utilities';
import { PLUGIN_EVENTS } from '../../shared/protocol/events';
import { 
  RenderContext, 
  StreamPayload, 
  CreateLayersPayload,
  ThinkingLevel 
} from '../../shared/types';
import { 
  generateLayoutWithValidation, 
  DistributedGenerator 
} from '../llm-client';
import { recognizeIntent } from '../../knowledge';
import { composeSystemPrompt } from '../llm-client/context/promptComposer';
import { getActiveEngineConfig } from '../engineConfig';
import { flowObserver, FlowPhase } from '../figma-adapter/observers/flowObserver';
import { postProcess } from '../layout-engine';
import { prefetchIconSvgs } from '../figma-adapter/assets/iconPrefetcher';
import { configManager } from '../../config/configManager';
import { NodeLayer } from '../../schema/layerSchema';
import { ChatMessage } from '../../types/chat';

export interface OrchestratorOptions {
  apiKey: string;
  modelName: string;
  thinkingLevel: ThinkingLevel;
  onStatusChange: (status: string) => void;
  onThinkingUpdate: (thought: string) => void;
  onComplete: (data: any, rawText: string) => void;
  onError: (error: string) => void;
}

export class ChatOrchestrator {
  constructor(private options: OrchestratorOptions) {}

  async generate(prompt: string, pluginData: any, history: ChatMessage[]) {
    const { apiKey, modelName, thinkingLevel } = this.options;
    const { selectionStyles, analyzedPattern, patternSummary } = pluginData;

    try {
      // 1. Resolve Engine Config
      const designSystemId = 'vanilla';
      const designSystemConfig = getActiveEngineConfig(designSystemId);
      const isModifyMode = !!(selectionStyles?.selectionNodes && selectionStyles.selectionNodes.length > 0 && analyzedPattern);
      const modifyTargetId = isModifyMode ? (selectionStyles?.selectionNodes?.[0] as any)?.id : undefined;

      // 2. Intent Recognition
      this.options.onStatusChange(configManager.getLoadingSteps()[0]);
      const intent = recognizeIntent(prompt, undefined, designSystemConfig.patterns);

      // 3. Prompt Composition
      const styleContextString = analyzedPattern ? `MIMIC THIS BOX MODEL: ${JSON.stringify(analyzedPattern)}` : '';
      const patternContext = patternSummary ? `\n\n${patternSummary}` : '';
      const referenceNode = selectionStyles?.selectionNodes?.[0];
      
      const systemPrompt = composeSystemPrompt(
        { 
          intent, 
          ragResults: { prioritizedComponents: [], goldenTemplates: [] },
          designSystemContext: { skillName: designSystemConfig.manifest.name }
        }, 
        { 
          isModifyMode, 
          userStylesContext: styleContextString + ' ' + patternContext,
          originalTextContent: referenceNode ? (referenceNode as any).characters || '' : '',
          viewport: configManager.getViewport((selectionStyles?.referenceLayout?.width ?? 0) <= 480)
        }
      );

      // 4. Trace & Logging
      flowObserver.startTrace();
      flowObserver.log(FlowPhase.PROMPT, `Generation Mode (${designSystemId})`, { systemPrompt: systemPrompt.substring(0, 500) + '...' });

      // 5. LLM Call with Streaming
      const streamConfig = configManager.getStreamConfig();
      const streamSessionId = flowObserver.getTraceId();
      const renderContext: RenderContext = {
        width: selectionStyles?.referenceLayout?.width ?? configManager.getViewport(false).width,
        height: selectionStyles?.referenceLayout?.height ?? configManager.getViewport(false).height,
        isMobile: (selectionStyles?.referenceLayout?.width ?? 0) <= 480
      };

      const result = await generateLayoutWithValidation({
        apiKey,
        modelName,
        systemPrompt,
        userPrompt: prompt,
        history: analyzedPattern ? [] : history,
        onProgress: (step: string) => this.options.onStatusChange(step),
        streaming: true,
        onThinking: (thought: string) => this.options.onThinkingUpdate(thought),
        onStreamNode: (node: any) => {
           // Direct emitting from orchestrator to preserve performance
           emit(PLUGIN_EVENTS.STREAM_LAYERS, {
             ...node,
             __modifyMode: isModifyMode,
             __modifyTargetId: modifyTargetId,
             designSystemId,
             streamSessionId,
             renderContext
           });
        },
        thinkingLevel,
        designSystemId
      });

      // 6. Post Processing
      this.options.onStatusChange('Refining layout...');
      const correctedData = await postProcess(result.data);

      // 7. Assets & Final Sync
      const payload = { ...correctedData, __modifyMode: isModifyMode, __modifyTargetId: modifyTargetId };
      const processedPayload = await prefetchIconSvgs(payload as NodeLayer);

      emit(PLUGIN_EVENTS.CREATE_LAYERS, {
        ...processedPayload as NodeLayer,
        designSystemId,
        __traceId: streamSessionId,
        renderContext,
        meta: { replaceStreamSessionId: streamSessionId }
      });

      this.options.onComplete(correctedData, result.rawText);

    } catch (error: any) {
      console.error('[Orchestrator] Failed:', error);
      this.options.onError(error.message || 'Unknown error');
    }
  }
}
