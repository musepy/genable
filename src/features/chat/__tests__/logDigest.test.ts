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
            name: 'create',
            parameters: { xml: '<frame name="Card" w="300" h="200"><text>Hello</text></frame>' },
            status: 'success',
            startTime: 1000,
            endTime: 1200,
            result: { data: { idMap: { Card: '1:1' } } }
          }
        ],
        iterations: [{ iteration: 1, thinking: 'Thinking...', startTime: 1000 }]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "Hello"');
    expect(result).toContain('Tools: 1 ok, 0 err');
    expect(result).toContain('#1 [create] 200ms OK');
    expect(result).toContain('xml:');
  });

  it('should handle create with idMap in results', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Create stuff', id: '1' },
      {
        role: 'model',
        text: 'Working...',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'create',
            parameters: {
              xml: '<frame name="Header" w="400" h="60"/><frame name="Footer" w="400" h="40"/>'
            },
            status: 'success',
            startTime: 1000,
            endTime: 2000,
            result: {
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
            name: 'create',
            parameters: { xml: '' },
            status: 'error',
            startTime: 1000,
            endTime: 1100,
            error: 'Invalid XML\nStack trace...'
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Tools: 0 ok, 1 err');
    expect(result).toContain('--- ERRORS ---');
    expect(result).toContain('#1 create: "Invalid XML"');
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
            parameters: { xml: '<delete id="1:1"/>' },
            status: 'success',
            startTime: 1000,
            endTime: 1100
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('Prompt: "' + 'A'.repeat(100) + '..."');
    expect(result).toContain('xml:');
  });

  it('should include design receipt details in the digest', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Build settings panel', id: '1' },
      {
        role: 'model',
        text: 'Working...',
        id: '2',
        toolCalls: [
          {
            id: 'tc1',
            name: 'design',
            parameters: { parentId: '200:1', xml: '<frame name="Panel"/>' },
            status: 'success',
            startTime: 1000,
            endTime: 1500,
            result: {
              data: {
                created: 4,
                edited: 2,
                idMap: {
                  panel: '10:1',
                  title: '10:2',
                  subtitle: '10:3',
                  toggle: '10:4',
                  colorSwatch: '10:5',
                },
                defaultsAppliedCount: 6,
                defaultsApplied: [
                  { property: 'textAutoResize' },
                  { property: 'layoutSizingHorizontal' },
                ],
                violations: [
                  { code: 'TEXT_OVERFLOW', severity: 'warning' },
                  { code: 'SIZING_REVERTED', severity: 'error' },
                ],
                nodeLimitWarning: 'Large batch',
              },
            },
          }
        ]
      }
    ];

    const result = generateLogDigest(history);
    expect(result).toContain('#1 [design] 500ms OK');
    expect(result).toContain('parentId: 200:1');
    expect(result).toContain('created 4, edited 2');
    expect(result).toContain('ids: panel→10:1, title→10:2, subtitle→10:3, toggle→10:4');
    expect(result).toContain('defaults(6): textAutoResize, layoutSizingHorizontal');
    expect(result).toContain('violations(2): TEXT_OVERFLOW:warning, SIZING_REVERTED:error');
    expect(result).toContain('nodeLimitWarning');
  });
});
