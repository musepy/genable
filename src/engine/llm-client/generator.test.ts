import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateLayoutWithValidation } from './generator';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Mock types and constants that are missing in vitest environment
vi.mock('@google/generative-ai', () => {
    const SchemaType = {
        OBJECT: 'OBJECT',
        STRING: 'STRING',
        NUMBER: 'NUMBER',
        BOOLEAN: 'BOOLEAN',
        ARRAY: 'ARRAY'
    };
    const GoogleGenerativeAI = vi.fn();
    return { GoogleGenerativeAI, SchemaType };
});

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/generative-ai', async (importOriginal) => {
  const actual = await importOriginal();
  const GoogleGenerativeAI = vi.fn();
  GoogleGenerativeAI.prototype.getGenerativeModel = vi.fn().mockReturnValue({
    generateContent: mockGenerateContent,
    startChat: vi.fn().mockReturnValue({
      sendMessage: mockGenerateContent,
    }),
  });
  return { ...actual, GoogleGenerativeAI };
});
vi.mock('../postProcessor', () => ({
  lint: vi.fn().mockReturnValue([]),
  hasErrors: vi.fn().mockReturnValue(false),
  formatWarningsForRetry: vi.fn().mockImplementation(w => 'Formatted Warnings'),
}));
vi.mock('../constraintValidator', () => ({
  validateLayoutConstraints: vi.fn().mockReturnValue({ warnings: [], hasErrors: false }),
  formatConstraintFeedback: vi.fn().mockReturnValue('Constraint Feedback'),
}));
vi.mock('../designSystemNexus', () => ({
  designSystemNexus: {
    getSystem: vi.fn().mockReturnValue({
      manifest: { name: 'shadcn', id: 'shadcn', cornerSmoothing: 0 },
      patterns: { patterns: { COMPONENT_IDENTIFIERS: {} } },
      constraints: { constraints: {} },
      tokens: {},
      heuristics: { heuristics: {} },
      aliases: { aliases: {} }
    })
  }
}));
vi.mock('../../constants/featureFlags', () => ({
  isEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('./schema', () => ({
  generateConstrainedSchema: vi.fn().mockReturnValue({}),
}));

describe('generateLayoutWithValidation - Physical Layer Retry', () => {
  const mockOptions = {
    apiKey: 'test-key',
    modelName: 'gemini-pro',
    systemPrompt: 'sys',
    userPrompt: 'user',
    enableRetry: true,
    maxRetries: 2,
    onProgress: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should trigger statistical retry (fresh roll) when structural violation occurs', async () => {
    // First call: Return an invalid structural FRAME (empty children)
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          type: 'FRAME',
          props: { name: 'Empty Card' },
          children: []
        }),
        functionCalls: () => []
      }
    });

    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          type: 'FRAME',
          props: { name: 'Valid Card' },
          children: [{ type: 'TEXT', props: { content: 'Content' } }]
        }),
        functionCalls: () => []
      }
    });

    const result = await generateLayoutWithValidation(mockOptions);

    expect(result.retryCount).toBe(1);
    expect(result.data.props.name).toBe('Valid Card');
  });

  it('should exhaust max retries and return the last structural violation if it persists', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          type: 'FRAME',
          props: { name: 'Persistent Empty' },
          children: []
        }),
        functionCalls: () => []
      }
    });

    const result = await generateLayoutWithValidation(mockOptions);

    expect(result.retryCount).toBe(2);
    expect(result.hasRemainingErrors).toBe(true);
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });
});
