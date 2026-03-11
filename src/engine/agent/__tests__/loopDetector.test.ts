import { describe, expect, it } from 'vitest';
import { LoopDetector } from '../loopDetector';
import type { LLMToolCall } from '../../llm-client/providers/types';

function makeToolCall(name: string, args: any): LLMToolCall {
  return { name, args };
}

describe('LoopDetector', () => {
  it('flags repeated read-only inspect loops', () => {
    const detector = new LoopDetector();
    let result = null;

    for (const nodeId of ['1:1', '1:2', '1:3', '1:4']) {
      result = detector.detect(
        [makeToolCall('inspect', { nodeId, depth: 2 })],
        { identical: 99, monotone: 4 }
      );
    }

    expect(result).not.toBeNull();
    expect(result?.type).toBe('monotone');
    expect(result?.fatal).toBe(false);
    expect(result?.hint).toContain('read-only tools');
    expect(result?.hint).toContain('inspect');
  });

  it('does not flag alternating inspect and design iterations as a monotone loop', () => {
    const detector = new LoopDetector();
    const sequence: LLMToolCall[][] = [
      [makeToolCall('inspect', { nodeId: '1:1', depth: 2 })],
      [makeToolCall('design', { xml: '<frame name="Card"/>' })],
      [makeToolCall('inspect', { nodeId: '1:2', depth: 2 })],
      [makeToolCall('design', { xml: '<text name="Label">Hello</text>' })],
    ];

    let result = null;
    for (const iteration of sequence) {
      result = detector.detect(iteration, { identical: 99, monotone: 4 });
    }

    expect(result).toBeNull();
  });
});
