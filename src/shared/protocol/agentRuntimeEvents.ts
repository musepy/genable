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

/**
 * Structured per-execution log for a single tool call. Mirrors the runtime
 * `ToolLogEntry` in `toolDispatcher.ts` and is shipped on every `tool_log`
 * event so dev-bridge / metrics consumers have a stable schema.
 */
export interface ToolLogEntry {
  callId: string;
  toolName: string;
  /**
   * Tool input — shape varies per tool (declared by each ToolDefinition).
   * Kept as `unknown` here so consumers must narrow before reading.
   */
  args: unknown;
  startedAt: number;
  durationMs: number;
  /** True if this exact call (name + args) was seen before in this run. */
  isDuplicate: boolean;
  /** True if the tool executed but produced no observable change. */
  isNoop: boolean;
  /** Present = failure (ToolResponse convention). Absent = success. */
  error?: string;
  /**
   * Machine-readable discriminator for runtime-synthesized errors (e.g.
   * "CAP_REJECT" from a hook skip). Absent for genuine tool failures.
   */
  code?: string;
}

/**
 * Emitted by HookRunner whenever a hook produces a hint (injectMessage) or
 * terminates tool execution (skip/abort). Lets dev-bridge consumers see
 * hook activity without parsing message streams.
 */
export interface AgentRuntimeTriggerFiredEvent extends AgentRuntimeBaseEvent {
  type: 'trigger_fired';
  hookId: string;
  /** HookEvent name the hook was registered against. */
  event: string;
  /** Hook action that fired the event — undefined for pure injectMessage hints. */
  action?: 'continue' | 'skip' | 'abort';
  /** Optional discriminator code from the hook result (e.g. "CAP_REJECT"). */
  code?: string;
  reason?: string;
  /** True when the hook produced an injectMessage payload. */
  injected: boolean;
}

/**
 * Emitted by ToolDispatcher for every tool call (success, failure, or
 * hook-skipped). Carries the structured ToolLogEntry above for downstream
 * observability — runs alongside the more LLM-shaped `tool_result` event.
 */
export interface AgentRuntimeToolLogEvent extends AgentRuntimeBaseEvent {
  type: 'tool_log';
  iteration: number;
  logEntry: ToolLogEntry;
}

/**
 * Emitted by AgentRuntime when a variable-binding callsite encountered an
 * ambiguous bare-name lookup and silently picked the first match. Phase 1
 * `warn_pick_record` semantics — the binding still happened, but the audit
 * trail surfaces every candidate (including the one the agent likely
 * intended via `_ryow`).
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §5.1.
 */
export interface AgentRuntimeAmbiguousAutopickEvent extends AgentRuntimeBaseEvent {
  type: 'ambiguous_autopick';
  phase: AgentRuntimePhase;
  iteration?: number;
  /** ID the resolver actually bound. */
  picked_variable_id: string;
  /** Variable ID from RyowStore that the agent likely intended. */
  suggested_id?: string;
  /** All matches found by name + type. */
  candidates: Array<{
    variable_id: string;
    name: string;
    collection_id?: string;
    collection_name?: string;
    type?: string;
    mode_coverage?: string[];
    /** "created_this_turn" if the variable was added to RyowStore this turn. */
    source: 'created_this_turn' | 'preexisting';
  }>;
  /** Tool that triggered the resolution (e.g. "set_fill"). */
  tool_name: string;
  /** Node that the binding was applied to, when known. */
  node_id?: string;
  /** The bare-name string the LLM passed (e.g. "Text/Primary"). */
  name_query: string;
}

/**
 * Emitted when a variable binding fails MISSING_MODE_VALUES — the variable's
 * `values_by_mode` is missing one or more modes in the target node's
 * resolved-mode chain. Phase 2 step 4 of the variable resolver redesign:
 * the binding is REJECTED at write time (no Figma mutation occurs) unless
 * the variable is opt-in-fallback.
 *
 * Carries the data needed for rollback metric tracking (§5.4): `phase`
 * indicates which AgentBehaviorConfig.variableResolution setting was active,
 * `tool_name` lets the rollback tracker scope per-tool reverts.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §6, §4.1.d.
 */
export interface AgentRuntimeMissingModeValuesEvent extends AgentRuntimeBaseEvent {
  type: 'missing_mode_values';
  phase: AgentRuntimePhase;
  iteration?: number;
  /** Tool that triggered the binding (e.g. "set_fill", "jsx", "bind_variable"). */
  tool_name: string;
  /** Node ID the binding was attempted on. */
  node_id: string;
  /** Variable ID whose mode coverage was insufficient. */
  variable_id: string;
  /** Modes the variable lacks values for, expressed as mode names. */
  missing_modes: string[];
  /** Current AgentBehaviorConfig.variableResolution at time of failure. */
  resolutionPhase: 'phase1' | 'phase2-mode-coverage' | 'phase2-strict' | 'auto';
  /** Wall-clock ms (Date.now()) at failure point — duplicates `timestamp` for explicit auditing. */
  ts: number;
}

/**
 * Emitted when a Phase 2 strict-mode binding rejects a bare-name string
 * input (e.g. `set_fill({fill: "$Brand/600"})`). Spec §3.2 / §5.3 — strict
 * mode requires structured input (object form). Non-fatal at the runtime
 * level (the tool returns an error envelope), but logged so dashboards
 * can audit how often the LLM still passes bare names after the cutover.
 */
export interface AgentRuntimeBareNameRejectedEvent extends AgentRuntimeBaseEvent {
  type: 'bare_name_rejected';
  phase: AgentRuntimePhase;
  iteration?: number;
  /** Tool that triggered (e.g. "set_fill", "set_stroke"). */
  tool_name: string;
  /** Node the binding targeted. */
  node_id?: string;
  /** The bare-name string the LLM passed (e.g. "$Brand/600"). */
  name_query: string;
  /** Active variableResolution at time of failure — always 'phase2-strict' or 'auto'. */
  resolutionPhase: 'phase1' | 'phase2-mode-coverage' | 'phase2-strict' | 'auto';
}

/**
 * Emitted when a strict-mode binding's `{variable_id}` form fails because
 * the variable was deleted, renamed, or had its values/collection mutated
 * since the assertion was captured. Spec §3.2 / §4.1.c. The `expected_*`
 * fields surface what the agent thought the variable was; `actual_*`
 * surfaces the live state.
 */
export interface AgentRuntimeStaleVariableIdEvent extends AgentRuntimeBaseEvent {
  type: 'stale_variable_id';
  phase: AgentRuntimePhase;
  iteration?: number;
  tool_name: string;
  node_id?: string;
  variable_id: string;
  /** When the failure was a name-mismatch assertion. */
  expected_name?: string;
  /** Live name (when assertion failed on name). */
  actual_name?: string;
  /** When the failure was a fingerprint-mismatch assertion. */
  expected_fingerprint?: string;
  /** Live fingerprint (when assertion failed on fingerprint). */
  actual_fingerprint?: string;
  /** Differentiates "variable deleted" from "variable mutated". */
  reason: 'variable_missing' | 'name_mismatch' | 'fingerprint_mismatch';
  resolutionPhase: 'phase1' | 'phase2-mode-coverage' | 'phase2-strict' | 'auto';
}

/**
 * Emitted when a strict-mode binding's `{collection_id, name, type}` triple
 * matches 2+ variables — hard failure in strict mode (vs Phase 1's
 * AMBIGUOUS_NAME_AUTOPICK soft warning, which still binds the first match).
 * Spec §3.2 / §4.1.b.
 */
export interface AgentRuntimeAmbiguousVariableReferenceEvent extends AgentRuntimeBaseEvent {
  type: 'ambiguous_variable_reference';
  phase: AgentRuntimePhase;
  iteration?: number;
  tool_name: string;
  node_id?: string;
  /** The triple the agent passed. */
  query: { collection_id: string; name: string; type: string };
  /** All matches with full metadata. */
  candidates: Array<{
    variable_id: string;
    name: string;
    collection_id: string;
    collection_name?: string;
    type?: string;
    mode_coverage?: string[];
    source: 'preexisting' | 'created_this_turn';
  }>;
  resolutionPhase: 'phase1' | 'phase2-mode-coverage' | 'phase2-strict' | 'auto';
}

/**
 * Emitted when a strict-mode binding's `{collection_id, name, type}` triple
 * matches no variables. Spec §4.1 (paired with VARIABLE_NOT_FOUND error
 * code). The recommended recovery is `ensure_variable` with the same triple.
 */
export interface AgentRuntimeVariableNotFoundEvent extends AgentRuntimeBaseEvent {
  type: 'variable_not_found';
  phase: AgentRuntimePhase;
  iteration?: number;
  tool_name: string;
  node_id?: string;
  query: { collection_id: string; name: string; type: string };
  resolutionPhase: 'phase1' | 'phase2-mode-coverage' | 'phase2-strict' | 'auto';
}

/**
 * Emitted when MISSING_MODE_VALUES failures attributed as "likely false
 * positives" cross a per-session threshold (currently 3 within one session).
 * Phase 2 step 7 of the variable resolver redesign — surfaces a signal that
 * `agentBehaviorConfig.variableResolution` may need to be flipped to 'phase1'
 * (the rollback escape valve, §5.4 / §7.2).
 *
 * This is OBSERVABILITY ONLY — the runtime DOES NOT auto-flip the setting.
 * Auto-rollback lives in Phase 3 of the rollout. The signal lets dev-bridge
 * dashboards / users see the regression before deciding to revert.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §5.4 / §7.2.
 */
export interface AgentRuntimeRollbackSignalEvent extends AgentRuntimeBaseEvent {
  type: 'rollback_signal';
  phase: AgentRuntimePhase;
  iteration?: number;
  /** Tool that triggered the threshold (e.g. "set_fill", "bind_variable", "jsx"). */
  tool_name: string;
  /** Number of likely-false-positive failures observed for this tool in the current session. */
  false_positive_count: number;
  /** Wall-clock ms (Date.now()) when the threshold was crossed. */
  ts: number;
}

/**
 * Emitted when a hook callback throws. Hook errors are non-fatal — the
 * runner logs the error, emits this event, and continues with the next hook.
 */
export interface AgentRuntimeHookErrorEvent extends AgentRuntimeBaseEvent {
  type: 'hook_error';
  hookId: string;
  /** HookEvent name the failing hook was registered against. */
  event: string;
  /** Stringified error message (Error.message or String(err)). */
  error: string;
}

/**
 * Emitted when total time spent running hooks for a single HookEvent
 * exceeds the slow-hook threshold (currently 100ms). Diagnostic only.
 */
export interface AgentRuntimeHookPerfEvent extends AgentRuntimeBaseEvent {
  type: 'hook_perf';
  /** HookEvent name whose aggregate run was slow. */
  event: string;
  hookCount: number;
  totalMs: number;
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
  | AgentRuntimeBudgetExhaustedEvent
  | AgentRuntimeTriggerFiredEvent
  | AgentRuntimeToolLogEvent
  | AgentRuntimeHookErrorEvent
  | AgentRuntimeHookPerfEvent
  | AgentRuntimeAmbiguousAutopickEvent
  | AgentRuntimeMissingModeValuesEvent
  | AgentRuntimeRollbackSignalEvent
  | AgentRuntimeBareNameRejectedEvent
  | AgentRuntimeStaleVariableIdEvent
  | AgentRuntimeAmbiguousVariableReferenceEvent
  | AgentRuntimeVariableNotFoundEvent;

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
  | 'budget_exhausted'
  | 'trigger_fired'
  | 'tool_log'
  | 'hook_error'
  | 'hook_perf'
  | 'ambiguous_autopick'
  | 'missing_mode_values'
  | 'rollback_signal'
  | 'bare_name_rejected'
  | 'stale_variable_id'
  | 'ambiguous_variable_reference'
  | 'variable_not_found';

