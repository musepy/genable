/**
 * @file config.ts
 * @description Centralized configuration constants for Gemini service
 */

import { getActivePerformance } from './performance';

// Reactive Performance Snapshot
const activePerformance = getActivePerformance();

/**
 * Log levels for structured logging
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

/**
 * Core Gemini API configuration
 */
export const GEMINI_CONFIG = {
  /** [Logging] Current log level */
  LOG_LEVEL: LogLevel.INFO,
  /** Maximum output tokens for generation (Sourced from Performance Engine) */
  MAX_OUTPUT_TOKENS: activePerformance.maxOutputTokens,
  
  /** Response format for structured output */
  RESPONSE_MIME_TYPE: 'application/json',
  
  /** Maximum recursion depth for nested nodes */
  MAX_DEPTH: 15,
  
  /** Base delay for exponential backoff (ms) */
  RETRY_BASE_DELAY_MS: 1000,
  
  /** Default retry attempts for self-correction loop */
  DEFAULT_MAX_RETRIES: 1,

  /** [UX] Request timeout in milliseconds (Unified fact derived from Tokens + Thinking) */
  REQUEST_TIMEOUT_MS: activePerformance.timeoutMs,

  /** [UX] Heartbeat interval for non-streaming feedback (3s) */
  HEARTBEAT_INTERVAL_MS: 3000,
} as const;

/**
 * Model version detection patterns
 */
export const MODEL_PATTERNS = {
  /** Allow 1.5, 2.0, 2.5, 3.0+ and experimental versions */
  VERSION: /(?:1[.-]5|2[.-]0|2[.-]5|3[.-]?\d*|exp-3)/i,
  /** Allow Pro, Flash and Flash-Lite variants */
  VARIANT: /(?:pro|flash|lite)/i,
  EXCLUDED_KEYWORDS: [
    'tts', 'embedding', 'nano',
    'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug'
  ],
} as const;

/**
 * Thinking level configuration for Gemini 3.0+ models
 */
export type ThinkingLevel = 'minimal' | 'low' | 'high';

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = activePerformance.thinkingLevel;

/**
 * OpenRouter API configuration
 */
export const OPENROUTER_CONFIG = {
  BASE_URL: 'https://openrouter.ai/api/v1',
  DEFAULT_MODEL: 'anthropic/claude-3.5-sonnet',
  SITE_URL: 'https://github.com/muse40007-stack/genable-figma-plugin',
  SITE_NAME: 'Genable Figma Plugin',
} as const;
