export type AgentRuntimePhase = 'execution' | 'idle';

export interface AgentRuntimeTaskInfo {
  taskId: string;
  taskTitle: string;
}

export interface AgentRuntimeContextUsage {
  current: number;
  max: number;
  percent: number;
  visibleMessages: number;
  hiddenMessages: number;
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
    displayName?: string;
    group?: string;
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
    displayName?: string;
    group?: string;
    success: boolean;
    durationMs: number;
    error?: string;
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
}

export interface AgentRuntimeTurnEndEvent extends AgentRuntimeBaseEvent {
  type: 'turn_end';
  phase: AgentRuntimePhase;
  iteration: number;
  totalIterations: number;
  summary: string;
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

export interface AgentRuntimeToolApprovalRequestEvent extends AgentRuntimeBaseEvent {
  type: 'tool_approval_request';
  phase: AgentRuntimePhase;
  iteration: number;
  toolCalls: { id: string; name: string; args: any }[];
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
    hidden?: boolean;
    pinned?: boolean;
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
  | AgentRuntimeTurnEndEvent
  | AgentRuntimeRetryEvent
  | AgentRuntimeToolApprovalRequestEvent
  | AgentRuntimeCanceledEvent
  | AgentRuntimeLLMRequestEvent
  | AgentRuntimeLLMResponseEvent
  | AgentRuntimeDebriefEvent;

export type AgentRuntimeEventType =
  | 'iteration_start'
  | 'tool_call'
  | 'tool_result'
  | 'context_usage'
  | 'status'
  | 'reasoning_delta'
  | 'text_delta'
  | 'error'
  | 'turn_end'
  | 'retry'
  | 'tool_approval_request'
  | 'canceled'
  | 'llm_request'
  | 'llm_response'
  | 'debrief';

