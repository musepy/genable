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
import { GenerateLayoutOptions, SafeCandidate, GenerateLayoutWithRetryOptions, GenerateLayoutWithRetryResult } from './types';
import { lint, hasErrors, formatWarningsForRetry } from '../layout-engine';
import { validateLayoutConstraints, formatConstraintFeedback, ConstraintValidationResult } from '../layout-engine/constraintValidator';
import { parseHybrid } from './hybridParser';
import { isEnabled } from '../../constants/featureFlags';

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
    streaming = false,
    thinkingLevel = DEFAULT_THINKING_LEVEL,
    designSystemId = 'vanilla',
  } = options;
  
  onProgress?.('Understanding your design...');
  
  let text = '';
  const genAI = new GoogleGenerativeAI(apiKey);
  const isGemini3 = isGemini3Model(modelName);
  
  const generationConfig: Record<string, any> = {
    maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
  };

  if (isGemini3) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  // Always request JSON format (prompt-only guidance; no responseJsonSchema)
  generationConfig.responseMimeType = 'application/json';
  // Intentionally avoid responseJsonSchema + tool calling.
  // These features have shown poor stability (especially when combined).

  const model = genAI.getGenerativeModel({ 
    model: modelName,
    generationConfig: generationConfig as any,
  });

  console.log(`[Generator] Active Config: MaxTokens=${GEMINI_CONFIG.MAX_OUTPUT_TOKENS}, Timeout=${GEMINI_CONFIG.REQUEST_TIMEOUT_MS}ms`);

  onProgress?.('Preparing context...');
  
  const chat = model.startChat({
    history: [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "OK. I will output ONLY Figma JSON." }] },
      ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] }))
    ],
  });

  onProgress?.('Generating layout...');
  
  if (streaming && onThinking) {
    const stream = await chat.sendMessageStream(userPrompt);
    for await (const chunk of stream.stream) {
      text += chunk.text();
      const candidate = chunk.candidates?.[0] as SafeCandidate | undefined;
      const thoughts = candidate?.content?.thoughts;
      if (thoughts && Array.isArray(thoughts)) {
        onThinking(thoughts.join('\n'));
      } else if (text.length > 0) {
        onThinking(`Generating... ${text.length} chars`);
      }
    }
  } else {
    try {
      onProgress?.('Waiting for Gemini response...');
      // [Gemini Protocol] No client-side timeout. Trust the model and network.
      const result = await chat.sendMessage(userPrompt);

      const response = await result.response;
      text = response.text();
    } finally {}
  }
  
  onProgress?.('Parsing response...');
  text = text.replace(/```json/g, '').replace(/```/g, '').trim();

  const parseResult = parseHybrid(text);
  const isFlatMode = Array.isArray(parseResult.data);

  if (isTruncatedOutput(text)) {
    if (isFlatMode && parseResult.data.length > 0) {
        onProgress?.('Recovering from truncation...');
    } else {
        throw new Error(formatErrorForUser(createTruncatedError(text)));
    }
  }
  
  if (!parseResult.success || !parseResult.data) {
    throw new Error(formatErrorForUser(createParseError(new Error(parseResult.error), text)));
  }
  
  let finalData: NodeLayer;
  if (isFlatMode) {
    const { root } = new TreeReconstructor().reconstruct(parseResult.data as any[]);
    finalData = root ? coerceNodeLayer(root) : coerceNodeLayer({ type: 'FRAME', props: { name: 'Failed', semantic: 'DEFAULT' }, children: [] });
  } else {
    finalData = coerceNodeLayer(parseResult.data);
  }
  
  onProgress?.('Rendering to Figma...');
  return { data: finalData, rawText: text };
}

function isStructuralViolation(node: any): boolean {
  // [Pure Trust] Empty containers are valid architectural choices.
  // Structural violation is now only triggered by critical data corruption (not shown here).
  return false;
}

export async function generateLayoutWithValidation(
  options: GenerateLayoutWithRetryOptions
): Promise<GenerateLayoutWithRetryResult> {
  const { maxRetries = 2, designSystemId = 'shadcn', enableRetry = true, ...baseOptions } = options;
  // designSystemLoader removed. Nexus handles registry.
  
  // Check if Self-Correction is disabled via feature flag
  const selfCorrectionDisabled = isEnabled('DISABLE_SELF_CORRECTION');
  if (selfCorrectionDisabled) {
    console.log('[Generator] ⚠️ Self-Correction DISABLED (DISABLE_SELF_CORRECTION flag is ON)');
  }
  
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
    
    // [History Compaction] Strip massive JSON to prevent token window overflow
    history = [
      ...history,
      { role: 'model' as const, text: `[PREVIOUS OUTPUT OMITTED: CONTAINED ${lastWarnings.length} ERRORS]` },
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
