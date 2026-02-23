/**
 * @file planState.ts
 * @description Runtime state manager for the agent's design plan.
 */

export interface TodoItem {
  id: string;
  label: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface PlanStep {
  stepId: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  todos: TodoItem[];
  startedAt?: number;
  completedAt?: number;
  /** High-level action description from planDesign (e.g. "Build header with logo and nav") */
  action?: string;
  /** Expected node names to create in this step */
  nodes?: string[];
  /** Why this step is needed */
  reasoning?: string;
  /** Original step ordering from planDesign */
  stepNumber?: number;
}

class PlanStateManager {
  private currentPlan: PlanStep[] = [];
  private activeStepId: string | null = null;
  private planId: string | null = null;

  /**
   * Initialize or replace the current plan.
   */
  private static readonly MAX_PLAN_STEPS = 10;

  setCurrentPlan(steps: any[]) {
    // Cap plan size to prevent over-granular plans that waste iterations.
    // If the model generated too many steps, keep only the first MAX_PLAN_STEPS.
    const cappedSteps = steps.slice(0, PlanStateManager.MAX_PLAN_STEPS);
    if (steps.length > PlanStateManager.MAX_PLAN_STEPS) {
      console.warn(`[PlanState] Plan had ${steps.length} steps, capped to ${PlanStateManager.MAX_PLAN_STEPS}. Encourage the model to group related operations.`);
    }

    this.currentPlan = cappedSteps.map((step, idx) => ({
      ...step,
      stepId: step.stepId || `step_${Date.now()}_${idx}`,
      title: step.title || step.action || 'Untitled Step',
      status: 'pending',
      todos: step.todos || []
    }));
    this.planId = `plan_${Date.now()}`;
    console.log(`[PlanState] Plan initialized with ${this.currentPlan.length} steps.`);
  }

  /**
   * Start a new task (LLM-driven).
   */
  startTask(title: string, description?: string, stepId?: string) {
    const id = stepId || `step_${Date.now()}`;
    const newStep: PlanStep = {
      stepId: id,
      title,
      description,
      status: 'in_progress',
      todos: [],
      startedAt: Date.now()
    };
    
    // If a step with this ID exists, update it. Otherwise, add it.
    const existingIdx = this.currentPlan.findIndex(s => s.stepId === id);
    if (existingIdx !== -1) {
      this.currentPlan[existingIdx] = { ...this.currentPlan[existingIdx], ...newStep };
    } else {
      this.currentPlan.push(newStep);
    }
    
    this.activeStepId = id;
    console.log(`[PlanState] Task started: ${title} (${id})`);
  }

  /**
   * Update the todo list for the active task.
   */
  updateTodos(items: TodoItem[]) {
    if (!this.activeStepId) {
      console.warn('[PlanState] No active task to update todos for.');
      return;
    }
    const step = this.currentPlan.find(s => s.stepId === this.activeStepId);
    if (step) {
      step.todos = items;
    }
  }

  /**
   * Mark the active or a specific step as complete.
   */
  completeTask(stepId?: string, summary?: string) {
    const id = stepId || this.activeStepId;
    if (!id) return;

    const step = this.currentPlan.find(s => s.stepId === id);
    if (step) {
      step.status = 'completed';
      step.completedAt = Date.now();
      if (summary) step.description = summary;
      console.log(`[PlanState] Task completed: ${id}`);
    }
    
    if (id === this.activeStepId) {
      this.activeStepId = null;
    }
  }

  /**
   * Get the full plan.
   */
  getPlan(): PlanStep[] {
    return this.currentPlan;
  }

  /**
   * Get the active step.
   */
  getActiveStep(): PlanStep | null {
    return this.currentPlan.find(s => s.stepId === this.activeStepId) || null;
  }

  /**
   * Get summary for LLM context.
   */
  getSummary(): string {
    if (this.currentPlan.length === 0) return 'No active tasks.';
    const completed = this.currentPlan.filter(s => s.status === 'completed').length;
    const total = this.currentPlan.length;
    const active = this.getActiveStep();

    let summary = `${completed}/${total} tasks completed.`;
    if (active) {
      summary += ` Currently working on: "${active.title}"`;
      if (active.nodes && active.nodes.length > 0) {
        summary += ` | Target nodes: [${active.nodes.join(', ')}]`;
      }
    }
    return summary;
  }

  reset() {
    this.currentPlan = [];
    this.activeStepId = null;
    this.planId = null;
  }
}

export const planState = new PlanStateManager();
