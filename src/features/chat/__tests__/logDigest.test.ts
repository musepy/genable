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
            name: 'jsx',
            parameters: { jsx: '<Frame name="Card" w="300" h="200"><Text>Hello</Text></Frame>' },
            status: 'success',
            startTime: 1000,
            endTime: 1200,
            result: { data: { id: '1:1', name: 'Card', created: 1 } }
          }
        ],
        iterations: [{ iteration: 1, thinking: 'Thinking...', startTime: 1000 }]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "Hello"');
    expect(result).toContain('Tools: 1 ok, 0 err');
    expect(result).toContain('#1 [jsx] 200ms OK');
    expect(result).toContain('jsx:');
  });

  it('should handle jsx with node info in results', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Create stuff', id: '1' },
      {
        role: 'model',
        text: 'Working...',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'jsx',
            parameters: {
              jsx: '<Frame name="Header" w="400" h="60"/>'
            },
            status: 'success',
            startTime: 1000,
            endTime: 2000,
            result: {
              data: { id: '3:1', name: 'Header', created: 2 }
            }
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('id: 3:1');
    expect(result).toContain('name: Header');
    expect(result).toContain('created: 2');
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
            name: 'jsx',
            parameters: { jsx: '' },
            status: 'error',
            startTime: 1000,
            endTime: 1100,
            error: 'Invalid JSX\nStack trace...'
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Tools: 0 ok, 1 err');
    expect(result).toContain('--- ERRORS ---');
    expect(result).toContain('#1 jsx: "Invalid JSX"');
  });

  it('should truncate long prompts', () => {
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
            name: 'edit',
            parameters: { target: 'Card#1:1', props: { w: 400 } },
            status: 'success',
            startTime: 1000,
            endTime: 1100
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "' + 'A'.repeat(100) + '..."');
    expect(result).toContain('target:');
  });

  it('should handle inspect tool in the digest', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Check the layout', id: '1' },
      {
        role: 'model',
        text: 'Inspecting...',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'inspect',
            parameters: { target: 'Panel#200:1', depth: 2 },
            status: 'success',
            startTime: 1000,
            endTime: 1500,
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('#1 [inspect] 500ms OK');
    expect(result).toContain('target: Panel#200:1, depth: 2');
  });
});
