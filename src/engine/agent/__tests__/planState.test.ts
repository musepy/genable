import { describe, it, expect, beforeEach } from 'vitest';
import { planState } from '../planState';

describe('PlanStateManager', () => {
  beforeEach(() => {
    planState.reset();
  });

  it('should initialize a plan with steps', () => {
    const steps = [
      { title: 'create frame', action: 'createNode' },
      { title: 'add text', action: 'createNode' }
    ];

    planState.setCurrentPlan(steps);
    const plan = planState.getPlan();

    expect(plan).toHaveLength(2);
    expect(plan[0].status).toBe('pending');
    expect(plan[0].title).toBe('create frame');
  });

  it('should start and complete a task', () => {
    planState.startTask('My Task', 'Initial description');
    
    const active = planState.getActiveStep();
    expect(active?.title).toBe('My Task');
    expect(active?.status).toBe('in_progress');

    planState.completeTask(undefined, 'Finished everything');
    
    expect(planState.getPlan()[0].status).toBe('completed');
    expect(planState.getPlan()[0].description).toBe('Finished everything');
    expect(planState.getActiveStep()).toBeNull();
  });

  it('should update todo items', () => {
    planState.startTask('Task with Todos');
    planState.updateTodos([
      { id: '1', label: 'Item 1', status: 'completed' },
      { id: '2', label: 'Item 2', status: 'pending' }
    ]);

    const active = planState.getActiveStep();
    expect(active?.todos).toHaveLength(2);
    expect(active?.todos[0].status).toBe('completed');
  });

  it('should return a summary of progress', () => {
    planState.setCurrentPlan([
      { title: 'Step 1' },
      { title: 'Step 2' }
    ]);

    expect(planState.getSummary()).toBe('0/2 tasks completed.');

    planState.startTask('Step 1', undefined, planState.getPlan()[0].stepId);
    expect(planState.getSummary()).toContain('Currently working on: "Step 1"');

    planState.completeTask();
    expect(planState.getSummary()).toBe('1/2 tasks completed.');
  });
});
