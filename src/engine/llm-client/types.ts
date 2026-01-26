/**
 * @file types.ts
 * @description Shared types for Gemini service
 */

import { NodeLayer } from '../../schema/layerSchema';
import { LintWarning } from '../layout-engine/types';
import { ThinkingLevel } from './config';

/**
 * Extended types for experimental Gemini features (Thinking)
 */
export interface ThinkingConfig {
  thinkingLevel?: ThinkingLevel;
}

export interface SafeGenerationConfig {
  maxOutputTokens?: number;
  thinkingConfig?: ThinkingConfig;
}

export interface ThinkingContent {
  thoughts?: string[];
}

export interface SafeCandidate {
  content?: ThinkingContent;
}

/**
 * Options for generateLayout function
 */
export interface GenerateLayoutOptions {
  apiKey: string;
  modelName: string;
  systemPrompt: string;
  userPrompt: string;
  history?: { role: 'user' | 'model'; text: string }[];
  onProgress?: (step: string) => void;
  /** Streaming callbacks for real-time thinking display */
  onThinking?: (thought: string) => void;
  /** Callback for real-time node ingestion during streaming */
  onStreamNode?: (node: any) => void;
  /** Legacy/Unified callback for state updates */
  onStateChange?: (state: GenerationState) => void;
  /** Whether to enable streaming mode */
  streaming?: boolean;
  /** Thinking level for Gemini 3.0+ models (minimal/low/high) */
  thinkingLevel?: ThinkingLevel;
  /** [P0] Constrained response schema for token validation */
  responseSchema?: Record<string, any>;
  /** Design system ID for tool execution context */
  designSystemId?: string;
}

/**
 * [PLAYBOOK Phase 2.2] Extended options for Self-Correction Loop
 */
export interface GenerateLayoutWithRetryOptions extends GenerateLayoutOptions {
  /** Enable self-correction loop (default: true) */
  enableRetry?: boolean;
  /** Maximum retry attempts (default: 1) */
  maxRetries?: number;
  /** Design system for lint validation (default: 'shadcn') */
  designSystemId?: string;
  /** Callback when retry is triggered */
  onRetry?: (warnings: LintWarning[], attempt: number) => void;
}

/**
 * [PLAYBOOK Phase 2.2] Result type for generateLayoutWithRetry
 */
export interface GenerateLayoutWithRetryResult {
  data: NodeLayer;
  rawText: string;
  /** Number of retry attempts made (0 = first attempt succeeded) */
  retryCount: number;
  /** Final lint warnings (after all retries) */
  finalWarnings: LintWarning[];
  /** Whether errors remained after all retries */
  hasRemainingErrors: boolean;
}

/**
 * Generation phases for state tracking
 */
export enum GenerationPhase {
  IDLE = 'IDLE',
  UNDERSTANDING = 'UNDERSTANDING',
  PREPARING = 'PREPARING',
  GENERATING = 'GENERATING',
  PARSING = 'PARSING',
  RENDERING = 'RENDERING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

/**
 * Encapsulated generation state
 */
export interface GenerationState {
  sessionId: string;
  phase: GenerationPhase;
  progress?: string;
  thoughts?: string;
  count?: number; // character or node count
  error?: string;
}
