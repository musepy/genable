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
  const actual = await importOriginal() as Record<string, any>;
  const GoogleGenerativeAI = vi.fn();
  GoogleGenerativeAI.prototype.getGenerativeModel = vi.fn().mockReturnValue({
    generateContent: mockGenerateContent,
    startChat: vi.fn().mockReturnValue({
      sendMessage: mockGenerateContent,
      sendMessageStream: vi.fn(),
    }),
  });
  return { ...actual, GoogleGenerativeAI };
});
vi.mock('../layout-engine', () => ({
  lint: vi.fn().mockReturnValue([]),
  hasErrors: vi.fn().mockReturnValue(false),
  formatWarningsForRetry: vi.fn().mockImplementation(w => 'Formatted Warnings'),
}));
vi.mock('../layout-engine/constraintValidator', () => ({
  validateLayoutConstraints: vi.fn().mockReturnValue({ warnings: [], hasErrors: false }),
  formatConstraintFeedback: vi.fn().mockReturnValue('Constraint Feedback'),
}));
vi.mock('../../constants/featureFlags', () => ({
  isEnabled: vi.fn().mockReturnValue(false),
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
    // First call: Return an empty FRAME (allowed by current structural policy)
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

    const result = await generateLayoutWithValidation(mockOptions);

    expect(result.retryCount).toBe(0);
    expect(result.data.props.name).toBe('Empty Card');
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

    expect(result.retryCount).toBe(0);
    expect(result.hasRemainingErrors).toBe(false);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('falls back to non-streaming when streaming fails', async () => {
    const { GoogleGenerativeAI } = await import('@google/generative-ai') as any;
    const model = new GoogleGenerativeAI('key').getGenerativeModel({ model: 'gemini-pro' });
    const chat = model.startChat({});
    (chat.sendMessageStream as any).mockRejectedValueOnce(new Error('Failed to parse stream'));
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          type: 'FRAME',
          props: { name: 'Login' },
          children: []
        }),
        functionCalls: () => []
      }
    });

    const result = await generateLayoutWithValidation({
      ...mockOptions,
      streaming: true
    } as any);

    expect(result.data.props.name).toBe('Login');
  });

  it('parses JSON when response includes trailing text', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => `{"type":"FRAME","props":{"name":"Login"},"children":[]} \n\nTrailing note`,
        functionCalls: () => []
      }
    });

    const result = await generateLayoutWithValidation(mockOptions);

    expect(result.data.props.name).toBe('Login');
  });
});
