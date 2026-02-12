import { describe, it, expect } from 'vitest';
import { agentTools, getToolsForMode } from '../index';

describe('Tool mode filtering: RECOVERY', () => {
  it('should allow diagnostic and completion tools only', () => {
    const tools = getToolsForMode('RECOVERY', agentTools);
    const names = tools.map(t => t.name);

    expect(names).toContain('inspectDesign');
    expect(names).toContain('validateLayout');
    expect(names).toContain('summarize_progress');
    expect(names).toContain('complete_task');
    expect(names).not.toContain('createNode');
    expect(names).not.toContain('applyDesignPatch');
    expect(names).not.toContain('batchOperations');
  });
});
