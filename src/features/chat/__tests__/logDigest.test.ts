import { describe, it, expect } from 'vitest';
import { generateLogDigest } from '../logDigest';
import { ChatMessage } from '../../../types/chat';

describe('generateLogDigest', () => {
  it('should handle empty history', () => {
    const history: ChatMessage[] = [];
    const result = generateLogDigest(history);
    expect(result).toContain('=== AGENT DIGEST ===');
    expect(result).toContain('Iterations: 0');
    expect(result).toContain('Tools: 0 ok, 0 err');
  });

  it('should extract basic information from a simple success scenario', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Hello', id: '1' },
      {
        role: 'model',
        text: 'Hi',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'createIcon',
            parameters: { name: 'mail', size: 24, color: '#000' },
            status: 'success',
            startTime: 1000,
            endTime: 1200,
            result: { success: true }
          }
        ],
        iterations: [{ iteration: 1, thinking: 'Thinking...', startTime: 1000 }]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "Hello"');
    expect(result).toContain('Tools: 1 ok, 0 err');
    expect(result).toContain('#1 [createIcon] 200ms OK');
    expect(result).toContain('params: {mail, 24, #000}');
  });

  it('should handle batchOperations with correct payload structure and idMap', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Create stuff', id: '1' },
      {
        role: 'model',
        text: 'Working...',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'batchOperations',
            parameters: {
              operations: [
                { action: 'createNode', params: { name: 'Header', type: 'FRAME' }, opId: 'op_h' },
                { action: 'createNode', params: { name: 'Footer', type: 'FRAME' }, opId: 'op_f' }
              ]
            },
            status: 'success',
            startTime: 1000,
            endTime: 2000,
            result: {
              success: true,
              data: {
                idMap: { 'op_h': '3:1', 'op_f': '3:2' }
              }
            }
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('createNode(Header/FRAME), createNode(Footer/FRAME)');
    expect(result).toContain('ids: op_h→3:1, op_f→3:2');
  });

  it('should handle truncated tool parameters gracefully', () => {
    const history: ChatMessage[] = [
      {
        role: 'model',
        text: 'Thinking...',
        id: 'trunc',
        toolCalls: [
          {
            id: 'call_trunc',
            name: 'batchOperations',
            parameters: {
              _truncated: true,
              operations: [
                { opId: 'op1', action: 'createNode', name: 'TruncatedNode' }
              ]
            },
            status: 'success',
            startTime: 1100,
            endTime: 1200
          }
        ]
      }
    ];

    const digest = generateLogDigest(history);
    expect(digest).toContain('createNode(TruncatedNode)');
  });

  it('should summarize errors correctly', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Fail please', id: '1' },
      {
        role: 'model',
        text: 'Attempting...',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'batchOperations',
            parameters: { operations: [] },
            status: 'error',
            startTime: 1000,
            endTime: 1100,
            error: 'Invalid parent node\nStack trace...'
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Tools: 0 ok, 1 err');
    expect(result).toContain('--- ERRORS ---');
    expect(result).toContain('#1 batchOperations: "Invalid parent node"');
  });

  it('should truncate long prompts and summaries', () => {
    const longPrompt = 'A'.repeat(200);
    const history: ChatMessage[] = [
      { role: 'user', text: longPrompt, id: '1' },
      {
        role: 'model',
        text: 'Done',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'complete_task',
            parameters: { summary: 'B'.repeat(150) },
            status: 'success',
            startTime: 1000,
            endTime: 1100
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "' + 'A'.repeat(100) + '..."');
    expect(result).toContain('params: {' + 'B'.repeat(80) + '}');
  });
});
