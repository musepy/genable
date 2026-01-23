import { GoogleGenerativeAI } from '@google/generative-ai';
import { GenerateLayoutOptions } from '../types';
import { ThinkingPhase, GenerationContext, PhaseOutput } from './types';
import { GEMINI_CONFIG } from '../config';
import { coerceNodeLayer } from '../../../schema/layerSchema';
import { postProcess, lint } from '../../layout-engine';
import { validateLayoutConstraints, formatConstraintFeedback } from '../../layout-engine/constraintValidator';
import { formatSemanticFeedback, generateSemanticContext } from '../../layout-engine';

/**
 * DistributedGenerator handles the multi-phase "Thinking" execution
 * instead of a single monolithic prompt.
 * 
 * V5 STABLE: Linear 5-phase execution with constraint validation at each step.
 * This version follows PLAYBOOK Phase 2 (Semantic Compiler + Feedback Loop).
 */
export class DistributedGenerator {
  private genAI: GoogleGenerativeAI;
  
  constructor(private apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Main entry point for distributed generation
   */
  async generate(options: GenerateLayoutOptions): Promise<{ data: any; rawText: string }> {
    const context: GenerationContext = {
      intent: options.userPrompt,
      designSystemId: (options as any).designSystemId || 'shadcn',
      history: []
    };

    options.onProgress?.('Initializing distributed engine...');

    // Linear 5-Phase Execution (PLAYBOOK Phase 2 Compliant)
    await this.executePhase(ThinkingPhase.REQUIREMENT, context, options);
    await this.executePhase(ThinkingPhase.STRUCTURE, context, options);
    await this.executePhase(ThinkingPhase.LAYOUT, context, options);
    await this.executePhase(ThinkingPhase.STYLE, context, options);
    const finalResult = await this.executePhase(ThinkingPhase.GENERATE, context, options);

    // Apply full post-processing to the final result
    const processedData = postProcess(finalResult.data);

    return {
      data: processedData,
      rawText: finalResult.rawText
    };
  }

  /**
   * Executes a single phase with internal validation loop
   */
  private async executePhase(
    phase: ThinkingPhase, 
    context: GenerationContext, 
    options: GenerateLayoutOptions
  ): Promise<PhaseOutput> {
    const phaseName = phase.toUpperCase();
    const maxLocalRetries = 2;
    let attempt = 0;
    let lastOutput: PhaseOutput | null = null;
    
    options.onProgress?.(`Thinking: ${phaseName}...`);
    
    const model = this.genAI.getGenerativeModel({ 
      model: options.modelName,
      generationConfig: {
        maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
        // responseMimeType: 'application/json' <-- REMOVED to fix 400 error
      }
    });

    // Build history from previous phases
    const phaseHistory = context.history.map(h => [
      { role: 'user' as const, parts: [{ text: `PHASE ${h.phase} RESULT` }] },
      { role: 'model' as const, parts: [{ text: h.rawText }] }
    ]).flat();

    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: 'You are a multi-phase Figma UI generation agent. Follow instructions for the current phase.' }] },
        { role: 'model', parts: [{ text: 'OK. I will output JSON for the current phase.' }] },
        ...phaseHistory
      ]
    });

    let currentPrompt = this.getPhasePrompt(phase, context);

    while (attempt <= maxLocalRetries) {
      attempt++;
      if (attempt > 1) {
        options.onProgress?.(`Refining ${phaseName} (Attempt ${attempt})...`);
      }

      const result = await chat.sendMessage(currentPrompt);
      const response = await result.response;
      const text = response.text();

      let data: any;
      try {
        const rawJson = JSON.parse(text);
        // Apply coercion to normalize LLM output
        data = coerceNodeLayer(rawJson);
      } catch (e) {
        console.error(`[Distributed] Parse error in phase ${phase} (Attempt ${attempt}):`, text);
        if (attempt <= maxLocalRetries) {
          currentPrompt = `INVALID JSON. Please output a valid JSON object following the schema for phase ${phaseName}. Error: ${e instanceof Error ? e.message : 'Parse error'}`;
          continue;
        }
        throw new Error(`Failed to parse response in ${phase} phase after ${attempt} attempts`);
      }

      lastOutput = { phase, data, rawText: text };

      // Skip validation for REQUIREMENT phase (no geometric constraints)
      if (phase === ThinkingPhase.REQUIREMENT) {
        break;
      }

      // Validation using existing PLAYBOOK Phase 2 infrastructure
      const warnings = lint(data);
      const constraints = validateLayoutConstraints(data);
      const hasErrors = warnings.some(w => w.severity === 'error') || constraints.hasErrors;

      if (!hasErrors || attempt > maxLocalRetries) {
        if (hasErrors) {
          console.warn(`[Distributed] Phase ${phaseName} finished with remaining errors after ${attempt} attempts.`);
        }
        break; 
      }

      // [Phase 1.1] Enrich warnings with semantic context for better LLM understanding
      const enrichedWarnings = warnings.map(w => ({
        ...w,
        semanticContext: w.semanticContext || generateSemanticContext(w, context.designSystemId)
      }));

      // Build feedback for retry using semantic-aware format
      const feedback = formatSemanticFeedback(enrichedWarnings, context.designSystemId);
      
      if (constraints.hasErrors) {
        currentPrompt = feedback + "\n\n### Constraint Violations\n" + formatConstraintFeedback(constraints);
      } else {
        currentPrompt = feedback;
      }
      
      console.log(`[Distributed] Retrying phase ${phaseName} due to validation errors. Attempt: ${attempt}`);
    }

    if (!lastOutput) throw new Error(`Phase ${phaseName} failed to produce output`);
    
    context.history.push(lastOutput);
    return lastOutput;
  }

  /**
   * Get specialized prompt for each phase
   */
  private getPhasePrompt(phase: ThinkingPhase, context: GenerationContext): string {
    switch (phase) {
      case ThinkingPhase.REQUIREMENT:
        return `
PHASE: REQUIREMENT ANALYSIS
USER INTENT: "${context.intent}"
DESIGN SYSTEM: ${context.designSystemId}

TASK: Parse the user intent into a semantic requirement.
OUTPUT FORMAT (JSON):
{
  "semantic": "CARD | BUTTON | DASHBOARD | LIST | FORM | ...",
  "intent": "brief description of what is being built",
  "hypothesis": "primary visual goal"
}`;

      case ThinkingPhase.STRUCTURE:
        const req = context.history.find(h => h.phase === ThinkingPhase.REQUIREMENT)?.data;
        return `
PHASE: STRUCTURE PLANNING
REQUIREMENT: ${JSON.stringify(req)}

TASK: Plan the DOM-like hierarchy for this UI. Do NOT include styles or dimensions.
OUTPUT FORMAT (JSON):
{
  "type": "FRAME",
  "children": [
    { "type": "TEXT", "role": "title" },
    { "type": "FRAME", "role": "content-row", "children": [...] }
  ]
}`;

      case ThinkingPhase.LAYOUT:
        const struct = context.history.find(h => h.phase === ThinkingPhase.STRUCTURE)?.data;
        return `
PHASE: LAYOUT CALCULATION
STRUCTURE: ${JSON.stringify(struct)}

TASK: Assign physical layout properties (width, height, padding, gap, layoutMode).
Follow design system ${context.designSystemId} grid rules.

OUTPUT FORMAT (JSON, use 'props' for properties):
{
  "type": "FRAME",
  "props": { "width": 400, "padding": 16, "gap": 12, "layout": "VERTICAL" },
  "children": [...] (mapped to original structure with layout props included)
}`;

      case ThinkingPhase.STYLE:
        const layout = context.history.find(h => h.phase === ThinkingPhase.LAYOUT)?.data;
        return `
PHASE: STYLE INJECTION
LAYOUT: ${JSON.stringify(layout)}

TASK: Inject visual styles using ${context.designSystemId} tokens.
Add cornerRadius, fills (colors), fontSize, etc.

OUTPUT FORMAT (JSON, use 'props' for properties):
{
  "type": "FRAME",
  "props": { "fills": ["var:bg"], "cornerRadius": 8, "layout": "VERTICAL" },
  "children": [...] (mapped to layout with visual props added)
}`;

      case ThinkingPhase.GENERATE:
        const style = context.history.find(h => h.phase === ThinkingPhase.STYLE)?.data;
        return `
PHASE: FINAL JSON GENERATION
PREVIOUS STYLE RESULT: ${JSON.stringify(style)}

TASK: Ensure the output follows the canonical NodeLayer JSON schema.
Merge all semantic, structure, layout, and style data into the "props" object.

CRITICAL: The output MUST follow this structure for every node:
{
  "type": "FRAME" | "TEXT" | "ICON",
  "props": { 
     "semantic": "...", 
     "layout": "VERTICAL | HORIZONTAL",
     "padding": number,
     "fills": [...],
     ...all other properties...
  },
  "children": [...]
}

OUTPUT: A single valid NodeLayer JSON object.`;

      default:
        return "";
    }
  }
}
