import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the problematic dependency that accesses figma global
vi.mock('@create-figma-plugin/utilities', () => ({
  on: vi.fn(),
  emit: vi.fn()
}));

// Stub figma global for safety
vi.stubGlobal('figma', {
  getNodeById: vi.fn(),
  currentPage: { selection: [] }
});

import { AgentOrchestrator } from '../../engine/services/AgentOrchestrator';
import { AgentRuntime } from '../../engine/agent/agentRuntime';

// Mock AgentRuntime
vi.mock('../../engine/agent/agentRuntime', () => ({
  AgentRuntime: vi.fn().mockImplementation(function() {
    return {
      run: vi.fn().mockResolvedValue('Design complete.')
    };
  }),
  AgentRuntimeCanceledError: class AgentRuntimeCanceledError extends Error {}
}));

// Mock SettingsService
vi.mock('../../engine/services/SettingsService', () => ({
  settingsService: {
    loadSettings: vi.fn().mockResolvedValue({
      apiKey: 'test-key',
      apiKeys: {},
      modelName: 'gemini-pro',
      providerName: 'gemini',
      telemetryEndpoint: 'http://test.loc/telemetry'
    })
  }
}));

// Mock TelemetryService
vi.mock('../../engine/services/TelemetryService', () => ({
  TelemetryService: {
    configure: vi.fn(),
    logLLMCall: vi.fn()
  }
}));

// Mock GeminiProvider
vi.mock('../../engine/llm-client/providers/gemini', () => ({
  GeminiProvider: vi.fn().mockImplementation(function() {
    return {
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Instructions')
    };
  })
}));

// Mock static system prompt builder
vi.mock('../../engine/llm-client/context/system', () => ({
  buildStaticSystemPrompt: vi.fn().mockReturnValue('Static System Prompt')
}));

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  const mockOptions = {
    apiKey: 'test-key',
    modelName: 'gemini-pro',
    thinkingLevel: 'high' as const,
    onStatusChange: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new AgentOrchestrator(mockOptions);
  });

  it('should initialize AgentRuntime and call run', async () => {
    const prompt = 'Create a login form';
    const pluginData = { selectionStyles: {}, analyzedPattern: null };
    
    await orchestrator.generate(prompt, pluginData, []);

    expect(AgentRuntime).toHaveBeenCalled();
    const agentInstance = (AgentRuntime as any).mock.results[0].value;
    expect(agentInstance.run).toHaveBeenCalledWith(prompt);
    expect(mockOptions.onComplete).toHaveBeenCalledWith({}, 'Design complete.');
  });

  it('should handle errors during generation', async () => {
    const prompt = 'Create a login form';
    const pluginData = { selectionStyles: {}, analyzedPattern: null };
    
    // Setup the mock to throw for this specific call
    const mockRun = vi.fn().mockRejectedValue(new Error('Agent Failed'));
    (AgentRuntime as any).mockImplementationOnce(function() {
      return { run: mockRun };
    });

    await orchestrator.generate(prompt, pluginData, []);

    expect(mockOptions.onError).toHaveBeenCalledWith('Agent Failed');
  });
});
