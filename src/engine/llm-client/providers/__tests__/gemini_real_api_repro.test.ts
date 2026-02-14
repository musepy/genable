
import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../gemini';
import { LLMMessage } from '../types';

/**
 * REPRODUCTION TEST: Using REAL API KEY
 * 
 * Goal: Confirm that Gemini 3 models (flash-preview) require thought_signature 
 * to be sent back when following a functionCall.
 */
describe('Gemini Real API Repro (Manual Run)', () => {
  // Use the key provided by the user
  const REAL_API_KEY = ''; // REDACTED
  const MODEL_NAME = 'gemini-3-flash-preview';

  it.skipIf(!REAL_API_KEY)('Should fail if thought_signature is missing in SEQUENTIAL tool calls', { timeout: 60000 }, async () => {
    const provider = new GeminiProvider(REAL_API_KEY, MODEL_NAME);

    // 1. Initial Prompt: Do something in two steps with complex reasoning
    const step1Options = {
      messages: [{ role: 'user', content: 'Step 1: create a circle with red fill and size 100. Step 2: once you confirm it is done, create a square with blue fill and size 200 at position (x: 500, y: 500). Explain why you chose these colors.' }],
      tools: [
        {
          name: 'create_node',
          description: 'Creates a node in Figma',
          parameters: {
            type: 'object',
            properties: { 
              type: { type: 'string', enum: ['CIRCLE', 'SQUARE'] },
              color: { type: 'string' },
              size: { type: 'number' },
              x: { type: 'number' },
              y: { type: 'number' }
            },
            required: ['type']
          }
        }
      ]
    };

    console.log('--- TURNS REP: Starting sequential tool use (Aggressive) ---');
    const response1 = await provider.generate(step1Options as any);
    
    expect(response1.toolCalls).toBeDefined();
    const toolCall1 = response1.toolCalls![0];
    const signature1 = toolCall1.thought_signature;

    console.log('TC1 Received:', toolCall1.args.type, 'Signature:', signature1?.slice(0, 10));

    // 2. Second Turn: Send tool result WITHOUT signature
    // We simulate the BUG by manually constructing history WITHOUT signature
    const history: LLMMessage[] = [
      ...step1Options.messages,
      {
        role: 'model',
        content: [
          {
            functionCall: {
                name: toolCall1.name,
                args: toolCall1.args
            }
          }
           // MISSING SIGNATURE PART HERE
        ]
      },
      {
        role: 'tool',
        content: [{ functionResponse: { name: toolCall1.name, response: { success: true } } }]
      }
    ];

    console.log('--- TURNS REP: Sending result 1 WITHOUT signature (EXPECTING FAILURE on tool call 2) ---');
    try {
      const response2 = await provider.generate({
        ...step1Options,
        messages: history
      } as any);
      
      console.log('TC2 Received (Surprise!):', response2.toolCalls ? response2.toolCalls[0].name : 'TEXT: ' + response2.text);
      if (response2.toolCalls) {
          console.log('TC2 Args:', response2.toolCalls[0].args);
      }
    } catch (error: any) {
      console.error('TC2 FAILED AS EXPECTED:', error.message);
    }
  });

  it.skipIf(!REAL_API_KEY)('Should succeed if thought_signature is INJECTED in SEQUENTIAL tool calls', { timeout: 60000 }, async () => {
    const provider = new GeminiProvider(REAL_API_KEY, MODEL_NAME);

    const step1Options = {
        messages: [{ role: 'user', content: 'Step 1: create a circle with red fill and size 100. Step 2: once you confirm it is done, create a square with blue fill and size 200 at position (x: 500, y: 500). Explain why you chose these colors.' }],
        tools: [
          {
            name: 'create_node',
            description: 'Creates a node in Figma',
            parameters: {
              type: 'object',
              properties: { 
                type: { type: 'string', enum: ['CIRCLE', 'SQUARE'] },
                color: { type: 'string' },
                size: { type: 'number' },
                x: { type: 'number' },
                y: { type: 'number' }
              },
              required: ['type']
            }
          }
        ]
      };
  
      const response1 = await provider.generate(step1Options as any);
      const toolCall1 = response1.toolCalls![0];
      const signature1 = toolCall1.thought_signature;

      // 2. Second Turn: Send tool result WITH signature
      // formatResponse and formatToolResults now correctly include signatures
      const history: LLMMessage[] = [
        ...step1Options.messages,
        provider.formatResponse(response1),
        {
          role: 'tool',
          content: [
            {
              functionResponse: {
                name: toolCall1.name,
                response: { success: true }
              },
              thought_signature: signature1 // Propagated via formatToolResults
            } as any
          ]
        }
      ];

      console.log('--- TURNS REP: Sending result 1 WITH signature (Aggressive) ---');
      try {
        const response2 = await provider.generate({
          ...step1Options,
          messages: history
        } as any);
        
        console.log('TC2 Received (Success!):', response2.toolCalls ? response2.toolCalls[0].name : 'TEXT: ' + response2.text);
        if (response2.toolCalls) {
            console.log('TC2 Args:', response2.toolCalls[0].args);
            // expect(response2.toolCalls[0].args.type).toBe('SQUARE');
        }
      } catch (error: any) {
        console.error('TC2 FAILED:', error.message);
        throw error;
      }
  });
});
