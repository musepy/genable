import { describe, it, expect } from 'vitest';
import { buildCompressionSummary, capSummary } from '../contextSummarizer';
import type { LLMMessage } from '../../../llm-client/providers/types';

describe('buildCompressionSummary', () => {
  it('returns empty string for no messages', () => {
    expect(buildCompressionSummary([])).toBe('');
  });

  it('summarizes a simple user → model turn', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Make a login page' },
      { id: 'm1', role: 'model', content: 'I created a login page with email and password fields.' },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('User: Make a login page');
    expect(summary).toContain('Agent: I created a login page');
  });

  it('summarizes tool calls with function call parts', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Build a card' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'jsx', args: { xml: '<frame name="Card">...</frame>', parentId: '0:1' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          {
            functionResponse: {
              name: 'jsx',
              response: { data: { idMap: { Card: '100:1', Title: '100:2' } } },
            },
          },
        ],
      },
      { id: 'm2', role: 'model', content: 'Card created successfully.' },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('User: Build a card');
    expect(summary).toContain('jsx(');
    expect(summary).toContain('100:1');
    expect(summary).toContain('100:2');
    expect(summary).toContain('Agent: Card created');
  });

  it('summarizes tool errors', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Edit the button' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'edit', args: { xml: '<frame id="99:1" bg="#F00"/>' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          {
            functionResponse: {
              name: 'edit',
              response: { error: 'NODE_NOT_FOUND: 99:1' },
            },
          },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('FAIL');
    expect(summary).toContain('NODE_NOT_FOUND');
  });

  it('handles multiple turns', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Make a header' },
      { id: 'm1', role: 'model', content: 'Header done.' },
      { id: 'u2', role: 'user', content: 'Add a footer' },
      { id: 'm2', role: 'model', content: 'Footer done.' },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('User: Make a header');
    expect(summary).toContain('Agent: Header done.');
    expect(summary).toContain('User: Add a footer');
    expect(summary).toContain('Agent: Footer done.');
  });

  it('skips system messages and existing summaries', () => {
    const messages: LLMMessage[] = [
      { id: 's1', role: 'system', content: 'You are an agent' },
      { id: 'sum1', role: 'user', content: '[old summary]', summaryOf: ['old1', 'old2'] },
      { id: 'u1', role: 'user', content: 'Do something' },
      { id: 'm1', role: 'model', content: 'Done.' },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).not.toContain('You are an agent');
    expect(summary).not.toContain('[old summary]');
    expect(summary).toContain('User: Do something');
  });

  it('truncates long user requests', () => {
    const longText = 'A'.repeat(200);
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: longText },
      { id: 'm1', role: 'model', content: 'OK' },
    ];
    const summary = buildCompressionSummary(messages);
    // Should be truncated to ~120 chars + ellipsis
    const userLine = summary.split('\n').find(l => l.startsWith('User:'))!;
    expect(userLine.length).toBeLessThan(140);
    expect(userLine).toContain('…');
  });

  it('skips thinking parts in model content', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Design a form' },
      {
        id: 'm1', role: 'model', content: [
          { thought: true, text: 'Let me think about the layout...' },
          { text: 'Here is your form.' },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).not.toContain('Let me think');
    expect(summary).toContain('Agent: Here is your form.');
  });

  it('preserves jsx creation details during compression', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Create a settings panel' },
      {
        id: 'm1',
        role: 'model',
        content: [
          { functionCall: { name: 'jsx', args: { parentId: '200:1', xml: '<frame name="Panel"/>' } } },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        content: [
          {
            functionResponse: {
              name: 'jsx',
              response: {
                data: {
                  idMap: {
                    panel: '100:1',
                    title: '100:2',
                    subtitle: '100:3',
                    toggle: '100:4',
                  },
                },
              },
            },
          },
        ],
      },
    ];

    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('jsx(');
    expect(summary).toContain('parent:200:1');
    expect(summary).toContain('panel=100:1');
    expect(summary).toContain('title=100:2');
  });

  it('uses receipt.edited for edit summaries (lean format)', () => {
    // After noise stripping, edit results only have: idMap, edited, failed, changeSummary
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Adjust the card spacing' },
      {
        id: 'm1',
        role: 'model',
        content: [
          { functionCall: { name: 'edit', args: { xml: '<frame id="1:1" gap="24"/>' } } },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        content: [
          {
            functionResponse: {
              name: 'edit',
              response: {
                data: {
                  edited: 3,
                },
              },
            },
          },
        ],
      },
    ];

    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('edited 3');
  });

  it('summarizes clone_node command with idMap', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Copy a card' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'clone_node', args: { id: '962:1' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { functionResponse: { name: 'clone_node', response: { data: { idMap: { Card: '962:1', Title: '962:5' } } } } },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('Card=962:1');
    expect(summary).toContain('Title=962:5');
  });

  it('summarizes find_nodes command', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Find all buttons' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'find_nodes', args: { query: 'Button' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { functionResponse: { name: 'find_nodes', response: { data: { results: [{ id: '1:1' }, { id: '1:2' }, { id: '1:3' }, { id: '1:4' }, { id: '1:5' }] } } } },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('5 results');
  });

  it('summarizes discover_props command', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Find button properties' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'discover_props', args: { query: 'Button' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { functionResponse: { name: 'discover_props', response: { data: { results: [{ id: '1:1' }, { id: '1:2' }, { id: '1:3' }] } } } },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('3 results');
  });

  it('summarizes replace_props command', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Replace colors' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'replace_props', args: { property: 'fill', value: '#FF0000' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { functionResponse: { name: 'replace_props', response: { data: { replaced: 5 } } } },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('replaced 5');
  });

  it('summarizes delete_node command', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Delete nodes' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'delete_node', args: { id: '1:1' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { functionResponse: { name: 'delete_node', response: { data: { deleted: 3 } } } },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('deleted 3');
  });

  it('preserves PARTIAL_FAILURE error details in summary', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Create a settings panel' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'jsx', args: { xml: '<frame name="Panel">...</frame>' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          {
            functionResponse: {
              name: 'jsx',
              response: {
                error: '3 created, 2 failed',
                data: {
                  created: 3,
                  failed: 2,
                  idMap: { panel: '100:1', title: '100:2' },
                  errors: [
                    { op: 'buttons', error: 'Unknown property: cornerRadii (did you mean cornerRadius?)' },
                    { op: 'footer', error: 'FONT_UNLOADED: Figma Sans not available' },
                  ],
                },
              },
            },
          },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    // Must contain PARTIAL_FAILURE status
    expect(summary).toContain('PARTIAL_FAILURE');
    // Must contain per-op error details (not just "failed 2")
    expect(summary).toContain('buttons');
    expect(summary).toContain('cornerRadii'); // the actual error property name
    expect(summary).toContain('footer');
    expect(summary).toContain('FONT_UNLOADED');
    // Must still contain surviving idMap
    expect(summary).toContain('panel=100:1');
  });

  it('preserves BATCH_TOO_LARGE error in summary', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Create everything' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'jsx', args: { xml: '<frame name="All">...</frame>' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          {
            functionResponse: {
              name: 'jsx',
              response: {
                error: 'batch of 45 operations exceeds the hard limit of 30',
              },
            },
          },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('BATCH_TOO_LARGE');
    expect(summary).toContain('45');
  });

  it('handles already-compressed tool results from turnResultCompressor', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Create a dashboard' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'jsx', args: { xml: '<frame name="Dashboard"/>' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          {
            functionResponse: {
              name: 'jsx',
              response: {
                _compressed: true,
                summary: 'created 5 nodes [Dashboard=100:1, Header=100:2, Sidebar=100:3, Main=100:4, Footer=100:5]',
                idMap: { Dashboard: '100:1', Header: '100:2', Sidebar: '100:3', Main: '100:4', Footer: '100:5' },
              },
            },
          },
        ],
      },
      { id: 'm2', role: 'model', content: 'Dashboard layout created.' },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('created 5 nodes');
    expect(summary).toContain('Dashboard=100:1');
    expect(summary).toContain('Agent: Dashboard layout created.');
  });

  it('handles compressed failed results from turnResultCompressor', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Edit the card' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'edit', args: { xml: '<frame id="99:1"/>' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          {
            functionResponse: {
              name: 'edit',
              response: {
                _compressed: true,
                summary: 'PARTIAL_FAILURE: 2 failed, 1 succeeded',
                error: '2 ops failed',
              },
            },
          },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('FAIL');
    expect(summary).toContain('PARTIAL_FAILURE: 2 failed, 1 succeeded');
  });

  it('summarizes move_node command', () => {
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Move the card' },
      {
        id: 'm1', role: 'model', content: [
          { functionCall: { name: 'move_node', args: { id: '1:1', parentId: '2:1' } } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { functionResponse: { name: 'move_node', response: { data: { name: 'Card' } } } },
        ],
      },
    ];
    const summary = buildCompressionSummary(messages);
    expect(summary).toContain('→ Card');
  });
});

describe('capSummary', () => {
  it('returns unchanged if under limit', () => {
    const summary = 'User: Hello\nAgent: Hi';
    expect(capSummary(summary, 100)).toBe(summary);
  });

  it('drops oldest turns when over limit', () => {
    const summary = 'User: First request\n  → jsx → ok\nAgent: Done first\nUser: Second request\n  → find_nodes → ok\nAgent: Done second';
    const capped = capSummary(summary, 60);
    expect(capped).toContain('[Earlier history truncated]');
    expect(capped).toContain('User: Second request');
    expect(capped).not.toContain('User: First request');
  });

  it('keeps last turn even if exceeds limit', () => {
    const summary = 'User: A very long single turn that exceeds the limit by itself';
    const capped = capSummary(summary, 10);
    expect(capped).toContain('[Earlier history truncated]');
    expect(capped).toContain('User: A very long');
  });

  it('drops success-only turns before error turns (error-priority)', () => {
    const summary = [
      'User: First (success)',
      '  → jsx → created [a=1:1, b=1:2]',
      'User: Second (failed)',
      '  → jsx → PARTIAL_FAILURE: 3 created, 2 failed',
      'User: Third (success)',
      '  → jsx → created [c=2:1, d=2:2]',
    ].join('\n');
    // Set limit small enough that one turn must be dropped
    const capped = capSummary(summary, summary.length - 20);
    // Should drop a success turn, not the error turn
    expect(capped).toContain('PARTIAL_FAILURE');
    expect(capped).toContain('[Earlier history truncated]');
  });
});
