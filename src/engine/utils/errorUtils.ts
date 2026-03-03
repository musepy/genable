/**
 * @file errorUtils.ts
 * @description Utilities for translating technical Figma errors into design-centric semantic descriptions.
 */

export interface SemanticError {
  category: 'Logical Dependency' | 'ID Persistence' | 'Type Hallucination' | 'Invisible Render' | 'Generic';
  message: string;
  suggestion: string;
}

const ERROR_MAP: Record<string, SemanticError> = {
  'PARENT_NOT_FOUND': {
    category: 'Logical Dependency',
    message: 'Attempted to create a child node before its parent container exists.',
    suggestion: 'Please ensure the parent node is created and its ID is received before adding children.'
  },
  'NODE_NOT_FOUND': {
    category: 'ID Persistence',
    message: 'The target node ID is no longer valid or does not exist.',
    suggestion: 'The design hierarchy might have changed. Use read_node({ mode: "selection" }) to refresh current IDs.'
  },
  'INVALID_NODE_TYPE': {
    category: 'Type Hallucination',
    message: 'The requested node type is not supported in this tool.',
    suggestion: 'Please use supported types: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE.'
  },
  'INVALID_SIZING': {
    category: 'Logical Dependency',
    message: 'HUG sizing requires an Auto Layout context.',
    suggestion: 'Set layoutMode to VERTICAL or HORIZONTAL in the same call to enable Auto Layout.'
  },
  'LOOP_DETECTED': {
    category: 'Generic',
    message: 'The agent is repeating the same actions or summaries without making progress.',
    suggestion: 'Please try a different strategy or break the task into smaller sub-tasks.'
  }
};

/**
 * Maps a technical error code or message to a semantic design error.
 */
export function mapToSemanticError(code: string, originalMessage?: string): SemanticError {
  const mapped = ERROR_MAP[code];
  if (mapped) return mapped;

  // Heuristic for invisible render (zero size)
  if (originalMessage?.includes('size is 0') || originalMessage?.includes('zero dimension')) {
    return {
      category: 'Invisible Render',
      message: 'The node was created but has zero dimensions, making it invisible on the canvas.',
      suggestion: 'Please provide explicit width/height or enable Auto Layout with HUG sizing.'
    };
  }

  return {
    category: 'Generic',
    message: originalMessage || 'An unknown tool error occurred.',
    suggestion: 'Check the tool parameters and try a different approach.'
  };
}

/**
 * Formats a semantic error for LLM consumption.
 */
export function formatSemanticError(error: SemanticError): string {
  return `[${error.category}] ${error.message} Suggestion: ${error.suggestion}`;
}
