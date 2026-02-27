import { AgentMode } from './tools';
import { planState } from './planState';
import { AgentLoopPolicy } from './agentLoopPolicy';
import { LLMMessage, LLMToolCall } from '../llm-client/providers/types';
import { ContextManager } from './context/contextManager';

export interface AgentState {
  consecutiveToolFailures: number;
  staleStepIterations: number;
  lastActiveStepId: string | null;
  recoveryActive: boolean;
  recoveryIterations: number;
  totalRecoveryCycles: number;
  verificationFixIterations: number;
  verificationEntryInjected: boolean;
  rootNodeId: string | null;
  hasPerformedVerificationInspect: boolean;
  currentMode: AgentMode;
}

export class AgentStateMachine {
  public state: AgentState = {
    consecutiveToolFailures: 0,
    staleStepIterations: 0,
    lastActiveStepId: null,
    recoveryActive: false,
    recoveryIterations: 0,
    totalRecoveryCycles: 0,
    verificationFixIterations: 0,
    verificationEntryInjected: false,
    rootNodeId: null,
    hasPerformedVerificationInspect: false,
    currentMode: 'PLANNING'
  };

  constructor(
    private loopPolicy: AgentLoopPolicy,
    private generateId: (prefix: string) => string
  ) {}

  public reset(): void {
    this.state = {
      consecutiveToolFailures: 0,
      staleStepIterations: 0,
      lastActiveStepId: null,
      recoveryActive: false,
      recoveryIterations: 0,
      totalRecoveryCycles: 0,
      verificationFixIterations: 0,
      verificationEntryInjected: false,
      rootNodeId: null,
      hasPerformedVerificationInspect: false,
      currentMode: 'PLANNING'
    };
  }

  /**
   * Evaluates the current plan and history to determine the next mode.
   * Also injects state-transition messages into the context.
   */
  public determineNextMode(context: ContextManager): AgentMode {
    let mode: AgentMode = 'PLANNING';
    let activeStep = planState.getActiveStep();
    const plan = planState.getPlan();

    // 1. Auto-advance steps
    if (plan.length > 0 && !activeStep) {
      const nextPending = plan.find(s => s.status === 'pending');
      const hasCompletedSteps = plan.some(s => s.status === 'completed');
      if (nextPending) {
        planState.startTask(nextPending.title, nextPending.description, nextPending.stepId);
        activeStep = planState.getActiveStep();
        if (hasCompletedSteps) {
          context.addMessage({
            id: this.generateId('step_advance'),
            role: 'user',
            content: `Now working on: "${nextPending.title}". If this step's objectives were already accomplished during a previous step, call complete_step(summary="Already completed in previous step", reason="already_done") to advance immediately. Do NOT repeat work that is already visible on the canvas.`
          });
        }
      }
    }

    // 2. Base Mode determination
    if (plan.length > 0) {
      if (activeStep) {
        mode = 'EXECUTION';
      } else if (plan.every(s => s.status === 'completed')) {
        mode = 'VERIFICATION';
        if (!this.state.verificationEntryInjected) {
          this.state.verificationEntryInjected = true;
          const rootRef = this.state.rootNodeId ? `, nodeId="${this.state.rootNodeId}"` : '';
          context.addMessage({
            id: this.generateId('verify_entry'),
            role: 'user',
            content: `All plan steps completed. MANDATORY VERIFICATION before complete_task:
1. Call inspectDesign(mode="hierarchy"${rootRef}, depth=3) — check the "anomalies" field in the response.
2. Fix any anomalies found: ZERO_DIM, TEXT_OVERFLOW, SIZING_REVERTED, CHILDREN_OVERFLOW, SIBLING_WIDTH_MISMATCH, MISSING_AUTO_LAYOUT.
3. Check: all row frames in VERTICAL containers use layoutSizingHorizontal=FILL (not FIXED). Root frame has explicit width/height.
4. Use applyDesignPatch to fix issues, then re-inspect to confirm.
5. Only call complete_task after a clean inspection with zero anomalies.`
          });
        }
      } else {
        mode = 'EXECUTION';
      }
    }

    // 3. Stale Step Detection
    if (activeStep) {
      if (activeStep.stepId === this.state.lastActiveStepId) {
        this.state.staleStepIterations++;
      } else {
        this.state.staleStepIterations = 0;
        this.state.lastActiveStepId = activeStep.stepId;
      }

      if (this.state.staleStepIterations >= this.loopPolicy.staleStepThreshold) {
        console.warn(`[AgentStateMachine] ⚠️ STALE STEP: "${activeStep.title}" has been active for ${this.state.staleStepIterations} iterations. Force-completing.`);
        planState.completeTask(activeStep.stepId, `Auto-completed after ${this.state.staleStepIterations} iterations`);
        this.state.staleStepIterations = 0;
        this.state.lastActiveStepId = null;

        const remainingSteps = planState.getPlan().filter(s => s.status === 'pending');
        if (remainingSteps.length === 0) {
          mode = 'VERIFICATION';
          const rootRef = this.state.rootNodeId ? `, nodeId="${this.state.rootNodeId}"` : '';
          context.addMessage({
            id: this.generateId('stale_done'),
            role: 'user',
            content: `All plan steps completed. MANDATORY VERIFICATION before complete_task:
1. Call inspectDesign(mode="hierarchy"${rootRef}, depth=3) — check the "anomalies" field in the response.
2. Fix any anomalies found.
3. Only call complete_task after a clean inspection with zero anomalies.`
          });
        }
      }
    }

    // 4. Recovery Mode Override
    if (this.loopPolicy.recovery.enabled && mode === 'EXECUTION') {
      const effectiveThreshold = this.state.totalRecoveryCycles > 0
        ? this.loopPolicy.recovery.escalatedFailureThreshold
        : this.loopPolicy.recovery.entryFailureThreshold;

      if (this.state.recoveryActive || this.state.consecutiveToolFailures >= effectiveThreshold) {
        if (!this.state.recoveryActive) {
          if (this.state.totalRecoveryCycles >= this.loopPolicy.recovery.maxTotalCycles) {
            context.addMessage({
              id: this.generateId('recovery_cap'),
              role: 'user',
              content: `Recovery cycle limit reached. Call complete_task NOW with a summary of what was built.`
            });
          } else {
            this.state.recoveryActive = true;
            this.state.recoveryIterations = 0;
            this.state.totalRecoveryCycles++;
            mode = 'RECOVERY';
            context.addMessage({
              id: this.generateId('recovery_enter'),
              role: 'user',
              content: `RECOVERY MODE (cycle ${this.state.totalRecoveryCycles}/${this.loopPolicy.recovery.maxTotalCycles}): repeated failures detected. Diagnose with inspectDesign/validateLayout first.`
            });
          }
        } else {
          mode = 'RECOVERY';
        }
      }
    }

    this.state.currentMode = mode;
    return mode;
  }

  /**
   * Updates state based on Figma tool execution results.
   * Handles recovery entry/exit and failure tracking.
   */
  public handleFigmaToolResults(
    toolCalls: LLMToolCall[],
    results: any[],
    context: LLMMessage[]
  ): boolean {
    const mode = this.state.currentMode;
    const figmaToolNames = new Set(toolCalls.map(tc => tc.name));
    const figmaResults = results.filter(tr => figmaToolNames.has(tr.name));
    
    const successCount = figmaResults.filter(tr => tr.response?.success !== false).length;
    const failCount = figmaResults.filter(tr => tr.response?.success === false).length;
    const hadErrors = failCount > 0;

    const preferredRecoveryToolUsed = toolCalls.some(tc =>
      this.loopPolicy.recovery.preferredTools.includes(tc.name)
    );

    if (mode === 'RECOVERY') {
      this.state.recoveryIterations++;

      if (preferredRecoveryToolUsed && successCount > 0) {
        this.state.recoveryActive = false;
        this.state.recoveryIterations = 0;
        this.state.consecutiveToolFailures = Math.max(0, this.state.consecutiveToolFailures - 1);
        console.log('[AgentStateMachine] RECOVERY evidence collected. Decay failures.');
      } else if (this.state.recoveryIterations >= this.loopPolicy.recovery.maxIterations) {
        this.state.recoveryActive = false;
        this.state.recoveryIterations = 0;
        this.state.consecutiveToolFailures = Math.max(0, this.state.consecutiveToolFailures - 1);
        console.warn('[AgentStateMachine] RECOVERY timeout.');
      }
    } else {
      if (hadErrors && successCount === 0) {
        this.state.consecutiveToolFailures++;
      } else if (successCount > 0) {
        this.state.consecutiveToolFailures = 0;
        this.state.recoveryActive = false;
      }
    }

    return hadErrors;
  }

  /**
   * Updates internal state from tool results (e.g. rootNodeId).
   */
  public updateStateFromToolResults(results: any[]): void {
    for (const tr of results) {
      if (tr.name === 'generateDesign' && tr.response?.data?.rootNodeId) {
        this.state.rootNodeId = tr.response.data.rootNodeId;
      }
      if (tr.name === 'batchOperations' && tr.response?.data?.idMap && !this.state.rootNodeId) {
        const firstId = Object.values(tr.response.data.idMap)[0] as string | undefined;
        if (firstId) this.state.rootNodeId = firstId;
      }
      if (this.state.currentMode === 'VERIFICATION' && tr.name === 'inspectDesign') {
        this.state.hasPerformedVerificationInspect = true;
      }
    }
  }

  /**
   * Manages the verification fix loop logic.
   */
  public handleVerificationFixLoop(results: any[], context: LLMMessage[]): void {
    if (this.state.currentMode !== 'VERIFICATION') return;

    const validateResult = results.find(tr => tr.name === 'validateLayout');
    const hasLayoutErrors = validateResult?.response?.data?.hasErrors;
    const hasAnomalies = results.some(tr => tr.response?.data?.anomalies?.length > 0);

    if (hasLayoutErrors || hasAnomalies) {
      this.state.verificationFixIterations++;
      if (this.state.verificationFixIterations < this.loopPolicy.verificationFixLimit) {
        context.push({
          id: this.generateId('vfix'),
          role: 'user',
          content: `Verification detected issues (fix attempt ${this.state.verificationFixIterations}/${this.loopPolicy.verificationFixLimit}). Use patchNode to fix critical flaws or call complete_task if acceptable.`
        });
      }
    }
  }
}
