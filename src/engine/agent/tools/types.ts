/**
 * @file types.ts
 * @description Core types for the Agentic Tool Interface Layer.
 * Defines the structure for tool registration and execution results.
 */

/**
 * Metadata for a tool, used for registration and prompt generation.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  errors?: Record<string, string>;
  /**
   * Strategy for executing this tool. 
   * 'parallel': Can be executed concurrently with other parallel tools (no side effects).
   * 'sequential': Must be executed one-by-one (has side effects like creating nodes).
   */
  executionStrategy: 'parallel' | 'sequential';
  /**
   * Category for phase-based tool grouping in prompts.
   * - 'read': Get information from Figma state
   * - 'knowledge': Search design knowledge base
   * - 'plan': ReAct planning tools
   * - 'create': Create new nodes
   * - 'modify': Modify existing nodes
   * - 'validate': Validate designs
   */
  category?: 'read' | 'plan' | 'create' | 'modify' | 'validate' | 'knowledge' | 'control';
  /**
   * Tool names this tool commonly follows (dependency hints for LLM).
   * Example: setNodeLayout typically follows createNode.
   */
  dependencies?: string[];
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: any[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  maxItems?: number;
  required?: string[];
}

/**
 * Standardized response format from a tool execution.
 */
export interface ToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Tool execution context (e.g., current design system ID, session info).
 */
export interface ToolContext {
  designSystemId?: string;
  sessionId?: string;
  userId?: string;
}

/**
 * Type for a tool execution function.
 */
export type ToolExecutor<P = any, R = any> = (
  params: P,
  context?: ToolContext
) => Promise<ToolResponse<R>>;
