/**
 * AgentMode is retained only for event telemetry / logging.
 * It is NOT used as a control mechanism — the agent runs autonomously.
 */
export type AgentMode = 'PLANNING' | 'EXECUTION' | 'RECOVERY' | 'VERIFICATION' | 'AUTONOMOUS';

export type AgentRuntimePhase =
  | 'planning'
  | 'execution'
  | 'verification'
  | 'recovery'
  | 'idle';

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
  mode: AgentMode;
  phase: AgentRuntimePhase;
  taskInfo?: AgentRuntimeTaskInfo;
}

export interface AgentRuntimeToolCallEvent extends AgentRuntimeBaseEvent {
  type: 'tool_call';
  iteration: number;
  mode: AgentMode;
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
  mode: AgentMode;
  phase: AgentRuntimePhase;
  toolResult: {
    id: string;
    name: string;
    success: boolean;
    durationMs: number;
    error?: string;
    raw: any;
  };
}

export interface AgentRuntimeContextUsageEvent extends AgentRuntimeBaseEvent {
  type: 'context_usage';
  iteration: number;
  mode: AgentMode;
  phase: AgentRuntimePhase;
  usage: AgentRuntimeContextUsage;
}

export interface AgentRuntimeStatusEvent extends AgentRuntimeBaseEvent {
  type: 'status';
  phase: AgentRuntimePhase;
  mode?: AgentMode;
  iteration?: number;
  maxIterations?: number;
  taskInfo?: AgentRuntimeTaskInfo;
  message: string;
}

export interface AgentRuntimeReasoningDeltaEvent extends AgentRuntimeBaseEvent {
  type: 'reasoning_delta';
  phase: AgentRuntimePhase;
  mode?: AgentMode;
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

export interface AgentRuntimeCompletedEvent extends AgentRuntimeBaseEvent {
  type: 'completed';
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

export interface AgentRuntimeCanceledEvent extends AgentRuntimeBaseEvent {
  type: 'canceled';
  phase: AgentRuntimePhase;
  iteration?: number;
  reason: string;
}

export type AgentRuntimeEvent =
  | AgentRuntimeIterationStartEvent
  | AgentRuntimeToolCallEvent
  | AgentRuntimeToolResultEvent
  | AgentRuntimeContextUsageEvent
  | AgentRuntimeStatusEvent
  | AgentRuntimeReasoningDeltaEvent
  | AgentRuntimeErrorEvent
  | AgentRuntimeCompletedEvent
  | AgentRuntimeRetryEvent
  | AgentRuntimeCanceledEvent;

export type AgentRuntimeEventType =
  | 'iteration_start'
  | 'tool_call'
  | 'tool_result'
  | 'context_usage'
  | 'status'
  | 'reasoning_delta'
  | 'error'
  | 'completed'
  | 'retry'
  | 'canceled';

export function modeToRuntimePhase(mode: AgentMode): AgentRuntimePhase {
  switch (mode) {
    case 'PLANNING':
      return 'planning';
    case 'EXECUTION':
      return 'execution';
    case 'VERIFICATION':
      return 'verification';
    case 'RECOVERY':
      return 'recovery';
    default:
      return 'idle';
  }
}
