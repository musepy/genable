/**
 * @file generator.ts
 * @description Core layout generation logic using Gemini API
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { NodeLayer } from '../../schema/layerSchema';
import {
  isTruncatedOutput,
  createTruncatedError,
  createParseError,
  formatErrorForUser,
} from '../../utils/errorUtils';
import { TreeReconstructor } from '../figma-adapter/treeReconstructor';
import { FlatNode, coerceNodeLayer } from '../../schema/layerSchema';

import { GEMINI_CONFIG, DEFAULT_THINKING_LEVEL } from './config';
import { isGemini3Model } from './modelFilter';
import { GenerateLayoutOptions, SafeCandidate, GenerateLayoutWithRetryOptions, GenerateLayoutWithRetryResult, GenerationPhase } from './types';
import { lint, hasErrors, formatWarningsForRetry } from '../layout-engine';
import { validateLayoutConstraints, formatConstraintFeedback, ConstraintValidationResult } from '../layout-engine/constraintValidator';
import { parseHybrid } from './hybridParser';
import { isEnabled } from '../../constants/featureFlags';
import { JsonStreamParser } from '../../utils/jsonStreamParser';

/**
 * Generate layout from user prompt using Gemini API
 */
export async function generateLayout(
  options: GenerateLayoutOptions
): Promise<{ data: NodeLayer; rawText: string }> {
  const {
    apiKey,
    modelName,
    systemPrompt,
    userPrompt,
    history = [],
    onProgress,
    onThinking,
    onStreamNode,
    onStateChange,
    streaming = false,
    thinkingLevel = DEFAULT_THINKING_LEVEL,
    designSystemId = 'vanilla',
  } = options;
  
  const sessionId = (options as any).sessionId || 'default';

  const updateState = (phase: GenerationPhase, progress?: string, extra?: Record<string, any>) => {
    onStateChange?.({
      sessionId,
      phase,
      progress,
      ...extra
    });
    if (progress) onProgress?.(progress);
  };

  updateState(GenerationPhase.UNDERSTANDING, 'Understanding your design...');
  
  let text = '';
  const genAI = new GoogleGenerativeAI(apiKey);
  const isGemini3 = isGemini3Model(modelName);
  
  const generationConfig: Record<string, any> = {
    maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
  };

  if (isGemini3) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  if (!streaming) {
    generationConfig.responseMimeType = 'application/json';
  }

  const model = genAI.getGenerativeModel({ 
    model: modelName,
    generationConfig: generationConfig as any,
  });

  console.log(`[Generator] Active Config: MaxTokens=${GEMINI_CONFIG.MAX_OUTPUT_TOKENS}`);

  updateState(GenerationPhase.PREPARING, 'Preparing context...');
  
  const chat = model.startChat({
    history: [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "OK. I will output ONLY Figma JSON." }] },
      ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] }))
    ],
  });

  updateState(GenerationPhase.GENERATING, 'Generating layout...');
  
  if (streaming) {
    let streamError: any = null;
    let stream: any;
    const parser = new JsonStreamParser();

    try {
      stream = await chat.sendMessageStream(userPrompt);
    } catch (e: any) {
      streamError = e;
    }

    if (options.onStreamNode) {
      parser.onValue = (value: any) => {
        try {
          if (!value || typeof value !== 'object') return;
          options.onStreamNode?.(value);
          updateState(GenerationPhase.GENERATING, undefined, { node: value });
        } catch (e) {}
      };
    }

    if (!streamError && stream?.stream) {
      try {
        for await (const chunk of stream.stream) {
          const chunkText = chunk.text();
          text += chunkText;
          
          try {
            parser.feed(chunkText);
          } catch(e) {}

          const candidate = chunk.candidates?.[0] as SafeCandidate | undefined;
          const thoughts = candidate?.content?.thoughts;
          if (thoughts && Array.isArray(thoughts)) {
            const thoughtStr = thoughts.join('\n');
            onThinking?.(thoughtStr);
            updateState(GenerationPhase.GENERATING, `Generating... ${text.length} chars`, { 
                thoughts: thoughtStr,
                count: text.length 
            });
          } else if (text.length > 0) {
            onThinking?.(`Generating... ${text.length} chars`);
            updateState(GenerationPhase.GENERATING, `Generating... ${text.length} chars`, { count: text.length });
          }
        }
      } catch (e: any) {
        streamError = e;
      }
    }

    if (streamError) {
      updateState(GenerationPhase.GENERATING, 'Streaming failed, falling back...', { error: streamError?.message });
      console.warn('[Generator] Streaming failed, falling back to non-streaming:', streamError?.message);
      try {
        updateState(GenerationPhase.GENERATING, 'Waiting for Gemini response...');
        const result = await chat.sendMessage(userPrompt);
        const response = await result.response;
        text = response.text();
      } catch (e: any) {
        updateState(GenerationPhase.ERROR, 'Generation failed', { error: e.message });
        throw e;
      }
    }
  } else {
    try {
      updateState(GenerationPhase.GENERATING, 'Waiting for Gemini response...');
      const result = await chat.sendMessage(userPrompt);
      const response = await result.response;
      text = response.text();
    } catch (e: any) {
      updateState(GenerationPhase.ERROR, 'Generation failed', { error: e.message });
      throw e;
    }
  }
  
  updateState(GenerationPhase.PARSING, 'Parsing response...');
  text = text.replace(/```json/g, '').replace(/```/g, '').trim();

  const parseResult = parseHybrid(text);
  const parsedJson = parseResult.rawJson ?? text;
  const isFlatMode = Array.isArray(parseResult.data);

  if (isTruncatedOutput(parsedJson)) {
    if (isFlatMode && parseResult.data.length > 0) {
        onProgress?.('Recovering from truncation...');
    } else {
        throw new Error(formatErrorForUser(createTruncatedError(parsedJson)));
    }
  }
  
  if (!parseResult.success || !parseResult.data) {
    throw new Error(formatErrorForUser(createParseError(new Error(parseResult.error), parsedJson)));
  }
  
  let finalData: NodeLayer;
  if (isFlatMode) {
    const { root } = new TreeReconstructor().reconstruct(parseResult.data as any[]);
    finalData = root ? coerceNodeLayer(root) : coerceNodeLayer({ type: 'FRAME', props: { name: 'Failed', semantic: 'DEFAULT' }, children: [] });
  } else {
    finalData = coerceNodeLayer(parseResult.data);
  }
  
  updateState(GenerationPhase.COMPLETE, 'Generation Complete!');
  return { data: finalData, rawText: text };
}

function isStructuralViolation(node: any): boolean {
  return false;
}

export async function generateLayoutWithValidation(
  options: GenerateLayoutWithRetryOptions
): Promise<GenerateLayoutWithRetryResult> {
  const { maxRetries = 2, designSystemId = 'shadcn', enableRetry = true, ...baseOptions } = options;
  
  const selfCorrectionDisabled = isEnabled('DISABLE_SELF_CORRECTION');
  
  let attempt = 0;
  let history = [...(options.history || [])];
  let lastResult: { data: any; rawText: string } | null = null;
  let lastWarnings: any[] = [];
  
  if (!enableRetry || selfCorrectionDisabled) {
    const result = await generateLayout({ ...baseOptions, history });
    return { data: result.data, rawText: result.rawText, retryCount: 0, finalWarnings: [], hasRemainingErrors: false };
  }
  
  while (attempt <= maxRetries) {
    attempt++;
    options.onProgress?.(`Generation attempt ${attempt}...`);
    
    const result = await generateLayout({ ...baseOptions, history, designSystemId });
    lastResult = result;
    
    const lintWarnings = lint(result.data);
    const constraintResult = validateLayoutConstraints(result.data);
    const isStructureBroken = isStructuralViolation(result.data);
    
    lastWarnings = [...lintWarnings, ...constraintResult.warnings];
    const hasSemanticsIssues = lintWarnings.some(w => w.rule === 'SEMANTIC_MISSING' || w.rule === 'SemanticMissing');
    const hasBlockingErrors = isStructureBroken || hasSemanticsIssues;
    
    if (!hasBlockingErrors) {
      return { data: result.data, rawText: result.rawText, retryCount: attempt - 1, finalWarnings: lastWarnings, hasRemainingErrors: hasErrors(lintWarnings) };
    }
    
    if (attempt > maxRetries) break;
    
    const feedback = buildValidationFeedback(lintWarnings, constraintResult);
    options.onRetry?.(lastWarnings, attempt);
    
    history = [
      ...history,
      { role: 'model' as const, text: `[PREVIOUS OUTPUT OMITTED]` },
      { role: 'user' as const, text: feedback }
    ];
  }
  
  return { data: lastResult!.data, rawText: lastResult!.rawText, retryCount: attempt - 1, finalWarnings: lastWarnings, hasRemainingErrors: true };
}

function buildValidationFeedback(lintWarnings: any[], constraintResult: ConstraintValidationResult): string {
  const parts = ['## Validation Failed', '', 'Please regenerate with these corrections:', ''];
  if (hasErrors(lintWarnings)) parts.push('### Semantic Issues\n', formatWarningsForRetry(lintWarnings), '');
  if (constraintResult.hasErrors) parts.push('### Layout Violations\n', formatConstraintFeedback(constraintResult), '');
  parts.push('---\nOutput ONLY the corrected JSON.');
  return parts.join('\n');
}
