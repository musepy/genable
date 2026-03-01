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
            name: 'build_design',
            parameters: { instructions: 'FRAME "Card" w=300 h=200\n  TEXT "Title" chars="Hello"' },
            status: 'success',
            startTime: 1000,
            endTime: 1200,
            result: { success: true, data: { idMap: { Card: '1:1' } } }
          }
        ],
        iterations: [{ iteration: 1, thinking: 'Thinking...', startTime: 1000 }]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "Hello"');
    expect(result).toContain('Tools: 1 ok, 0 err');
    expect(result).toContain('#1 [build_design] 200ms OK');
    expect(result).toContain('2 lines:');
  });

  it('should handle build_design with idMap in results', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Create stuff', id: '1' },
      {
        role: 'model',
        text: 'Working...',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'build_design',
            parameters: {
              instructions: 'FRAME "Header" w=400 h=60\nFRAME "Footer" w=400 h=40'
            },
            status: 'success',
            startTime: 1000,
            endTime: 2000,
            result: {
              success: true,
              data: {
                idMap: { 'Header': '3:1', 'Footer': '3:2' }
              }
            }
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('ids: Header→3:1, Footer→3:2');
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
            name: 'build_design',
            parameters: { instructions: '' },
            status: 'error',
            startTime: 1000,
            endTime: 1100,
            error: 'Invalid instructions\nStack trace...'
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Tools: 0 ok, 1 err');
    expect(result).toContain('--- ERRORS ---');
    expect(result).toContain('#1 build_design: "Invalid instructions"');
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
            name: 'signal',
            parameters: { type: 'complete', summary: 'B'.repeat(150) },
            status: 'success',
            startTime: 1000,
            endTime: 1100
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "' + 'A'.repeat(100) + '..."');
    expect(result).toContain('params: {complete: ' + 'B'.repeat(80) + '}');
  });
});
