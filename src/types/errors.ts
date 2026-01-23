/**
 * @file errors.ts
 * @description Generation Error Types - Structured error classification for LLM output issues
 * 
 * [INPUT]:  Raw LLM output, parsing results, validation results
 * [OUTPUT]: Typed error objects with actionable details
 * [POS]:    Services layer - used by gemini.ts for error handling
 * 
 * ⚠️ 自指更新规则：一旦我被修改，必须：
 *    1. 更新本注释 of I/O/POS
 *    2. 更新 /src/types/.folder.md
 */

// No imports needed for patterns

// Error Types
// ==========================================


export type GenerationErrorType = 
  | 'TRUNCATED'          // JSON output was cut off mid-stream
  | 'PARSE_ERROR'        // JSON syntax error
  | 'SCHEMA_VIOLATION'   // Zod validation failed
  | 'IRON_LAW_VIOLATION' // Business rule violated
  | 'NETWORK_ERROR'      // API call failed
  | 'UNKNOWN';           // Catch-all

export interface GenerationErrorDetails {
  position?: number;       // Character position for parse errors
  path?: string;           // Schema path for validation errors
  rawPreview?: string;     // Preview of problematic content
  suggestion?: string;     // Actionable fix suggestion
  originalError?: Error;   // Original error for debugging
}

export interface GenerationError {
  type: GenerationErrorType;
  message: string;
  details: GenerationErrorDetails;
}

