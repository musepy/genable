import { describe, it, expect } from 'vitest';
import { ToolExecutionCoordinator } from '../toolExecutionCoordinator';

describe('ToolExecutionCoordinator', () => {
  const coordinator = new ToolExecutionCoordinator();

  it.each([
    ['outline', {}, 'nodeId'],
    ['query', {}, 'source'],
  ])('flags missing required parameter for %s', (toolName, args, missingParam) => {
    const result = coordinator.validateToolCall(toolName as string, args, 'EXECUTION');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('TOOL_VALIDATION_ERROR');
    expect(result.error.message).toContain(`Validation Error: ${toolName}`);
    expect(result.error.message).toContain(`missing required parameter(s): ${missingParam}`);
    expect(result.error.details.tool).toBe(toolName);
    expect(result.error.details.mode).toBe('EXECUTION');
    expect(result.error.details.missing).toContain(missingParam);
    expect(result.error.details).toHaveProperty('receivedKeys');
    expect(result.error.details.repairHint.length).toBeGreaterThan(0);
  });

  it('treats blank strings as missing required values', () => {
    const result = coordinator.validateToolCall(
      'outline',
      { nodeId: '   ' },
      'EXECUTION'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.details.missing).toContain('nodeId');
    expect(result.error.message).toContain('nodeId');
  });

  it('rejects unknown tool names with actionable repair hint', () => {
    const result = coordinator.validateToolCall(
      'complete_task',
      { summary: 'done' },
      'EXECUTION',
      ['context', 'outline', 'inspect', 'design', 'replace', 'query']
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('TOOL_VALIDATION_ERROR');
    expect(result.error.message).toContain('complete_task is not an available tool');
    expect(result.error.details.invalid).toContainEqual(
      expect.objectContaining({ name: 'toolName' })
    );
  });
});
