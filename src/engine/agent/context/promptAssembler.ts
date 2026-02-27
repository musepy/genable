import { composeAgentSystemPrompt, composeAgentDynamicContext } from '../../llm-client/context/promptComposer';
import { AgentBehaviorConfig } from '../agentBehaviorConfig';
import { ToolDefinition } from '../tools';
import { AgentMode } from '../../../shared/protocol/agentRuntimeEvents';
import { LLMProvider, LLMMessage } from '../../llm-client/providers/types';
import { PromptDependencies } from '../../../types/context';

import { skillRegistry } from '../skills/SkillRegistry';

export interface PromptAssemblerOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  maxContextTokens: number;
  behaviorConfig: AgentBehaviorConfig;
  designSystemId?: string;
  selectionContext?: { hasSelection: boolean; nodes: any[] };
  generateId: (prefix: string) => string;
}

export class PromptAssembler {
  /** Last mode for which a system prompt was built. */
  private cachedMode: AgentMode | null = null;
  /** The built system prompt string, reused while mode and skills stay constant. */
  private cachedSystemPrompt: string | null = null;
  /**
   * Fingerprint of skill sticky-activation state at the time of the last build.
   * Format: comma-joined sorted list of activated skill IDs.
   * When a new skill becomes sticky-active this string changes, forcing a rebuild.
   */
  private cachedSkillFingerprint: string = '';

  constructor(private options: PromptAssemblerOptions) {}

  /**
   * Returns a stable fingerprint representing which skills are currently sticky-active.
   * This is cheap to compute and compare.
   */
  private getSkillFingerprint(): string {
    return skillRegistry.getAll()
      .filter(skill => skillRegistry.getState(skill.id)?.stickyActive)
      .map(skill => skill.id)
      .sort()
      .join(',');
  }

  /**
   * Replaces the current system prompt in the context history.
   *
   * CACHE STRATEGY: The system prompt is deterministic for a given (mode, skill set).
   * - operationLog  → goes into injectDynamicContext (user message), NOT here
   * - activeStep    → goes into injectDynamicContext (user message), NOT here
   * - planSummary   → goes into injectDynamicContext (user message), NOT here
   *
   * Therefore we only need to rebuild when:
   *   1. mode changes (different sections become active/inactive), or
   *   2. a new skill turns sticky-active for the first time (adds content to skill-context section)
   *
   * On a cache hit we keep the existing messages[0] object untouched, which is
   * important for prefix caching at the API layer — the LLM provider only gets a
   * cache hit when the system message object reference and content are stable.
   */
  public async hotSwapSystemPrompt(
    messages: LLMMessage[],
    currentMode: AgentMode,
    originalUserRequest: string,
    operationLog: any[]
  ): Promise<void> {
    const currentSkillFingerprint = this.getSkillFingerprint();
    const isCacheHit =
      this.cachedMode === currentMode &&
      this.cachedSystemPrompt !== null &&
      this.cachedSkillFingerprint === currentSkillFingerprint;

    if (isCacheHit) {
      // System prompt is identical to what is already in messages[0].
      // Verify it is actually there to guard against external mutations.
      const existing = messages.find(m => m.role === 'system');
      if (existing && existing.content === this.cachedSystemPrompt) {
        console.log(`[PromptAssembler] ⚡ Cache hit — skipping system prompt rebuild (mode=${currentMode}, skills="${currentSkillFingerprint}")`);
        return;
      }
      // Fall through to rebuild if the message is missing or was mutated.
      console.warn(`[PromptAssembler] Cache hit but system message missing/mutated — rebuilding.`);
    } else {
      const reason = this.cachedMode !== currentMode
        ? `mode changed: ${this.cachedMode} → ${currentMode}`
        : `skill fingerprint changed: "${this.cachedSkillFingerprint}" → "${currentSkillFingerprint}"`;
      console.log(`[PromptAssembler] 🔄 Rebuilding system prompt (${reason})`);
    }

    const deps: PromptDependencies = {
      ragResults: { prioritizedComponents: [], goldenTemplates: [] },
      designSystemContext: { skillName: this.options.designSystemId || 'default' },
      intent: {
        originalRequest: originalUserRequest,
        requiresLayoutKnowledge: true
      },
      selectionContext: this.options.selectionContext,
      behaviorConfig: this.options.behaviorConfig,
      // operationLog is passed to satisfy the type but the section builders
      // that use it (iterationStateSummary) run inside injectDynamicContext, not here.
      operationLog
    };

    const systemPrompt = await composeAgentSystemPrompt(
      deps,
      this.options.tools,
      this.options.provider,
      {
        totalBudget: this.options.maxContextTokens,
        mode: currentMode
      }
    );

    // Update cache
    this.cachedMode = currentMode;
    this.cachedSystemPrompt = systemPrompt;
    this.cachedSkillFingerprint = currentSkillFingerprint;

    // Filter out existing system prompts
    const filtered = messages.filter(m => m.role !== 'system');

    // Unshift the new system prompt.
    // Use a stable id derived from mode so the message object is identical
    // across runs with the same mode – helping prefix caching where supported.
    messages.length = 0;
    messages.push({
      id: `sys_${currentMode}`,
      role: 'system',
      content: systemPrompt
    }, ...filtered);
  }

  /**
   * Generates dynamic context as a user message.
   * Caches or simplifies repetitive information to keep the system prompt static.
   */
  public injectDynamicContext(
    messages: LLMMessage[],
    originalUserRequest: string,
    operationLog: any[]
  ): void {
    const dynamicContext = composeAgentDynamicContext({
      ragResults: { prioritizedComponents: [], goldenTemplates: [] },
      designSystemContext: { skillName: this.options.designSystemId || 'default' },
      intent: {
        originalRequest: originalUserRequest,
        requiresLayoutKnowledge: true
      },
      selectionContext: this.options.selectionContext,
      behaviorConfig: this.options.behaviorConfig,
      operationLog
    });

    if (dynamicContext) {
      // Clean up previous iteration's dynamic prompt to prevent buildup
      const prevIdx = messages.findIndex(m => m.id?.startsWith('dyn_ctx'));
      if (prevIdx !== -1) {
        messages.splice(prevIdx, 1);
      }

      messages.push({
        id: this.options.generateId('dyn_ctx'),
        role: 'user',
        content: dynamicContext,
        hidden: true // Keep context lean for long-term memory
      });
    }
  }
}
