export type AgentRuntimePhase = 'execution' | 'idle';

export interface AgentRuntimeTaskInfo {
  taskId: string;
  taskTitle: string;
}

export interface ContextLayerMessagePreview {
  id: string;
  role: string;
  chars: number;
  /** First N chars of text content, or "[tool_call] name(...)" / "[tool_result] name(...)" */
  preview: string;
}

export interface ContextLayerInfo {
  chars: number;
  msgs: number;
  messages?: ContextLayerMessagePreview[];
}

export interface ContextLayerBreakdown {
  systemPrompt: ContextLayerInfo;
  summary: ContextLayerInfo;
  conversationHistory: ContextLayerInfo;
  turnMessages: ContextLayerInfo;
}

export interface AgentRuntimeContextUsage {
  current: number;
  max: number;
  percent: number;
  visibleMessages: number;
  hiddenMessages: number;
  layers?: ContextLayerBreakdown;
}

export interface AgentRuntimeBaseEvent {
  type: AgentRuntimeEventType;
  runId: string;
  sequence: number;
  timestamp: number;
}

export interface AgentRuntimeIterationStartEvent extends AgentRuntimeBaseEvent {
  type: 'iteration_start';
  iteration: number;
  maxIterations: number;

  phase: AgentRuntimePhase;
  taskInfo?: AgentRuntimeTaskInfo;
}

export interface AgentRuntimeToolCallEvent extends AgentRuntimeBaseEvent {
  type: 'tool_call';
  iteration: number;

  phase: AgentRuntimePhase;
  toolCall: {
    id: string;
    name: string;
    args: any;
  };
}

export interface AgentRuntimeToolResultEvent extends AgentRuntimeBaseEvent {
  type: 'tool_result';
  iteration: number;

  phase: AgentRuntimePhase;
  toolResult: {
    id: string;
    name: string;
    durationMs: number;
    /** Present = failure (ToolResponse convention). Absent = success. */
    error?: string;
    /**
     * Machine-readable discriminator for runtime-synthesized errors
     * (e.g. "CAP_REJECT" from a cap-style hook skip). Absent for genuine
     * tool failures. See `triggers/toolPlanTriggers.ts`.
     */
    code?: string;
    raw: any;
  };
}

export interface AgentRuntimeContextUsageEvent extends AgentRuntimeBaseEvent {
  type: 'context_usage';
  iteration: number;

  phase: AgentRuntimePhase;
  usage: AgentRuntimeContextUsage;
}

export interface AgentRuntimeStatusEvent extends AgentRuntimeBaseEvent {
  type: 'status';
  phase: AgentRuntimePhase;

  iteration?: number;
  maxIterations?: number;
  taskInfo?: AgentRuntimeTaskInfo;
  message: string;
}

export interface AgentRuntimeReasoningDeltaEvent extends AgentRuntimeBaseEvent {
  type: 'reasoning_delta';
  phase: AgentRuntimePhase;

  iteration?: number;
  text: string;
}

/** Incremental text chunk from the LLM's text output (not reasoning). */
export interface AgentRuntimeTextDeltaEvent extends AgentRuntimeBaseEvent {
  type: 'text_delta';
  phase: AgentRuntimePhase;

  iteration?: number;
  text: string;
}

export interface AgentRuntimeErrorEvent extends AgentRuntimeBaseEvent {
  type: 'error';
  phase: AgentRuntimePhase;
  iteration?: number;
  message: string;
  code?: string;
  /** ProviderErrorCategory or 'unknown' for non-provider exceptions. */
  category?: 'transport' | 'protocol' | 'api' | 'content' | 'unknown';
  provider?: string;
  /** Raw error.message before friendly translation. */
  originalMessage?: string;
  userActionable?: boolean;
  /** Truncated stack for diagnosis (dev-only). */
  stack?: string;
}

/**
 * Emitted at the start of a new agent run (turn). Pairs with `turn_end` for
 * external tooling that needs explicit turn boundaries — `iteration_start`
 * fires per LLM call, not per turn.
 */
export interface AgentRuntimeTurnStartEvent extends AgentRuntimeBaseEvent {
  type: 'turn_start';
  phase: 'execution';
  /** 1-based, monotonically increasing per AgentRuntime instance. */
  turnNumber: number;
  /** First ~200 chars of the user prompt for this turn. */
  promptPreview?: string;
}

/**
 * Emitted when a run terminates abnormally (error, max iterations, hook abort,
 * provider exhaustion). Distinct from `canceled` (user-initiated cancel) and
 * from `error` (lower-level error notification). Carries enough context for
 * post-hoc diagnosis.
 */
export interface AgentRuntimeAbortEvent extends AgentRuntimeBaseEvent {
  type: 'abort';
  phase: AgentRuntimePhase;
  reason: string;
  category: 'network' | 'provider_error' | 'hook_abort' | 'budget' | 'max_iterations' | 'unknown';
  iteration?: number;
  toolCallsExecuted?: number;
  durationMs?: number;
}

/**
 * Emitted at the LLM-generation chokepoint when a provider call fails after
 * retry exhaustion (or fails non-retryably). Categorizes by ProviderError
 * subclass so dashboards can distinguish transport / api / content failures.
 */
export interface AgentRuntimeProviderErrorEvent extends AgentRuntimeBaseEvent {
  type: 'provider_error';
  phase: 'execution';
  iteration: number;
  llmCallId: string;
  providerName: string;
  category: 'transport' | 'protocol' | 'api' | 'content';
  /** Constructor name (e.g. ConnectTimeoutError, APIError). */
  errorClass: string;
  message: string;
  userActionable?: boolean;
  /** Present when err is APIError. */
  httpStatus?: number;
}

export interface AgentRuntimeTurnEndEvent extends AgentRuntimeBaseEvent {
  type: 'turn_end';
  phase: AgentRuntimePhase;
  iteration: number;
  totalIterations: number;
  summary: string;
  /** True when the LLM returned no text and no tool calls after retries. */
  emptyResponse?: boolean;
}

export interface AgentRuntimeRetryEvent extends AgentRuntimeBaseEvent {
  type: 'retry';
  phase: AgentRuntimePhase;
  iteration?: number;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorCategory: string;
  errorMessage: string;
}

export interface AgentRuntimeAskUserQuestionEvent extends AgentRuntimeBaseEvent {
  type: 'ask_user_question';
  phase: AgentRuntimePhase;
  iteration: number;
  questions: Array<{
    question: string;
    header?: string;
    options: { label: string; description?: string }[];
    multiSelect?: boolean;
  }>;
}

/** Response shape from UI back to runtime when the user submits / answers. */
export interface AskUserResponse {
  /** One entry per question (in order). string = single-select label, string[] = multi-select labels. */
  answers?: Array<string | string[]>;
  /** Free-form text typed in chat — overrides the structured form. Authoritative when present. */
  freeText?: string;
}

export interface AgentRuntimeCanceledEvent extends AgentRuntimeBaseEvent {
  type: 'canceled';
  phase: AgentRuntimePhase;
  iteration?: number;
  reason: string;
}

/** Emitted before an LLM generation call. */
export interface AgentRuntimeLLMRequestEvent extends AgentRuntimeBaseEvent {
  type: 'llm_request';
  llmCallId: string;
  iteration: number;

  phase: AgentRuntimePhase;
  messages: {
    id: string;
    role: string;
    contentLength: number;
  }[];
  messageCount: number;
  toolNames: string[];
  config: {
    maxOutputTokens: number;
    thinkingLevel: string;
    toolMode: string;
  };
  /** Provider-agnostic KV cache diagnostics based on prefix stability. */
  cache?: {
    /** Messages whose content is identical to the previous request (cacheable prefix). */
    cacheableMessages: number;
    totalMessages: number;
    /** Estimated cacheable tokens (~chars/4). */
    cacheableTokensEstimate: number;
  };
}

/** Emitted after a difficult run to collect agent feedback on tools. */
export interface AgentRuntimeDebriefEvent extends AgentRuntimeBaseEvent {
  type: 'debrief';
  phase: AgentRuntimePhase;
  exitReason: 'completed' | 'max_iterations' | 'abort' | 'error';
  totalIterations: number;
  errorCount: number;
  loopsDetected: boolean;
  debrief: string;
  structured?: {
    confusingTools: string[];
    hardParts: string[];
    suggestions: string[];
  };
}

/** Emitted when the agent exhausts its iteration budget without a natural turn end. */
export interface AgentRuntimeBudgetExhaustedEvent extends AgentRuntimeBaseEvent {
  type: 'budget_exhausted';
  phase: AgentRuntimePhase;
  iteration: number;
  maxIterations: number;
}

/** Emitted after an LLM generation call completes or fails. */
export interface AgentRuntimeLLMResponseEvent extends AgentRuntimeBaseEvent {
  type: 'llm_response';
  llmCallId: string;
  iteration: number;

  phase: AgentRuntimePhase;
  durationMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  };
  responseShape: {
    textLength: number;
    thoughtsLength: number;
    toolCallCount: number;
    toolCallNames: string[];
  };
  success: boolean;
  /** Present on failed responses — surfaces the provider error detail for diagnostics. */
  errorMessage?: string;
}

export type AgentRuntimeEvent =
  | AgentRuntimeIterationStartEvent
  | AgentRuntimeToolCallEvent
  | AgentRuntimeToolResultEvent
  | AgentRuntimeContextUsageEvent
  | AgentRuntimeStatusEvent
  | AgentRuntimeReasoningDeltaEvent
  | AgentRuntimeTextDeltaEvent
  | AgentRuntimeErrorEvent
  | AgentRuntimeTurnStartEvent
  | AgentRuntimeTurnEndEvent
  | AgentRuntimeAbortEvent
  | AgentRuntimeProviderErrorEvent
  | AgentRuntimeRetryEvent
  | AgentRuntimeAskUserQuestionEvent
  | AgentRuntimeCanceledEvent
  | AgentRuntimeLLMRequestEvent
  | AgentRuntimeLLMResponseEvent
  | AgentRuntimeDebriefEvent
  | AgentRuntimeBudgetExhaustedEvent;

export type AgentRuntimeEventType =
  | 'iteration_start'
  | 'tool_call'
  | 'tool_result'
  | 'context_usage'
  | 'status'
  | 'reasoning_delta'
  | 'text_delta'
  | 'error'
  | 'turn_start'
  | 'turn_end'
  | 'abort'
  | 'provider_error'
  | 'retry'
  | 'ask_user_question'
  | 'canceled'
  | 'llm_request'
  | 'llm_response'
  | 'debrief'
  | 'budget_exhausted';

