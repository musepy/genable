import { describe, it, expect } from 'vitest';
import { ToolExecutionCoordinator } from '../toolExecutionCoordinator';

describe('ToolExecutionCoordinator', () => {
  const coordinator = new ToolExecutionCoordinator();

  it.each([
    ['signal', {}, 'type'],
    ['read_node', {}, 'mode'],
    ['create_node', {}, 'nodes'],
    ['patch_node', {}, 'patches'],
    ['delete_node', {}, 'nodeId'],
    ['query_knowledge', {}, 'source'],
    ['validate_design', {}, 'nodeId'],
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
      'delete_node',
      { nodeId: '   ' },
      'EXECUTION'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.details.missing).toContain('nodeId');
    expect(result.error.message).toContain('nodeId');
  });

  it('applies conditional required validation for read_node(node)', () => {
    const result = coordinator.validateToolCall(
      'read_node',
      { mode: 'node' },
      'EXECUTION'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.details.missing).toContain('nodeId');
    expect(result.error.message).toContain('read_node');
    expect(result.error.message).toContain('nodeId');
  });

  it('validates map path requirements for patches[].nodeId and patches[].props', () => {
    const result = coordinator.validateToolCall(
      'patch_node',
      {
        patches: [
          { nodeId: '', props: {} },
          { props: { width: 200 } },
        ],
      },
      'EXECUTION'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.details.missing).toContain('patches[].nodeId');
    expect(result.error.details.missing).toContain('patches[].props');
    expect(result.error.message).toContain('patch_node');
    expect(result.error.message).toContain('patches[].nodeId');
    expect(result.error.message).toContain('Please provide non-empty "patches"');
  });

  it('returns invalid details for enum-like validation failures', () => {
    const result = coordinator.validateToolCall(
      'signal',
      { type: 'invalid_type' },
      'EXECUTION'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.details.invalid).toContainEqual(
      expect.objectContaining({ name: 'type' })
    );
    expect(result.error.message).toContain('has invalid parameter(s): type');
    expect(result.error.message).toContain('Please set "type"');
  });

  it('rejects unknown tool names with actionable repair hint', () => {
    const result = coordinator.validateToolCall(
      'complete_task',
      { summary: 'done' },
      'EXECUTION',
      ['signal', 'read_node', 'create_node', 'patch_node', 'delete_node', 'query_knowledge', 'validate_design']
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('TOOL_VALIDATION_ERROR');
    expect(result.error.message).toContain('complete_task is not an available tool');
    expect(result.error.message).toContain('call signal with type "complete"');
    expect(result.error.details.invalid).toContainEqual(
      expect.objectContaining({ name: 'toolName' })
    );
  });
});
