/**
 * @file errorUtils.ts
 * @description Error Factory Functions - Logic for creating structured errors
 */

import { GenerationError, GenerationErrorDetails } from '../types/errors';

export function createTruncatedError(rawText: string): GenerationError {
  return {
    type: 'TRUNCATED',
    message: '设计太复杂，输出被截断',
    details: {
      rawPreview: rawText.slice(-80),
      suggestion: '尝试分步生成，如先生成表头再生成行'
    }
  };
}

export function createParseError(error: Error, rawText: string): GenerationError {
  // Extract position from error message like "Unexpected token at position 1234"
  const posMatch = error.message.match(/position\s*(\d+)/i);
  const position = posMatch ? parseInt(posMatch[1], 10) : undefined;
  
  // Get context around error position
  const preview = position !== undefined
    ? rawText.slice(Math.max(0, position - 30), position + 30)
    : rawText.slice(-60);
  
  return {
    type: 'PARSE_ERROR',
    message: `JSON 语法错误${position ? ` (位置 ${position})` : ''}`,
    details: {
      position,
      rawPreview: preview,
      suggestion: '检查引号、逗号、括号是否匹配',
      originalError: error
    }
  };
}

export function createSchemaError(zodError: { issues: Array<{ path: PropertyKey[]; message: string }> }): GenerationError {
  const issue = zodError.issues[0];
  const path = issue.path.map(p => String(p)).join('.');
  
  return {
    type: 'SCHEMA_VIOLATION',
    message: `字段 "${path}" 无效`,
    details: {
      path,
      suggestion: issue.message
    }
  };
}

export function createNetworkError(error: Error): GenerationError {
  return {
    type: 'NETWORK_ERROR',
    message: 'API 请求失败',
    details: {
      suggestion: '检查网络连接和 API Key',
      originalError: error
    }
  };
}

/**
 * Check if output appears to be truncated
 * Supports both JSON and DSL formats
 */
export function isTruncatedOutput(text: string): boolean {
  const trimmed = text.trim();
  
  // Empty or very short output
  if (trimmed.length < 10) return true;
  
  // Detect format
  const isJSON = trimmed.startsWith('{') || trimmed.startsWith('[');
  
  const dslStartRegex = /^(FRAME|TEXT|RECT|ICON|VEC)\b/i;
  const isDSL = dslStartRegex.test(trimmed);
  
  if (isJSON) {
    // JSON format: must end with } or ]
    if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) return true;
    
    // Check for unbalanced brackets (simple heuristic)
    // We only trigger truncation if significantly unbalanced to avoid micro-parsing errors
    const openBraces = (trimmed.match(/{/g) || []).length;
    const closeBraces = (trimmed.match(/}/g) || []).length;
    const openBrackets = (trimmed.match(/\[/g) || []).length;
    const closeBrackets = (trimmed.match(/]/g) || []).length;
    
    if (Math.abs(openBraces - closeBraces) > 1 || Math.abs(openBrackets - closeBrackets) > 1) {
      return true;
    }
  } else if (isDSL) {
    // DSL format: can end with }, ", or alphanumeric/closing chars
    // Valid endings: } (nested), " (text content), alphanumeric (props), ] (dimensions)
    const validDSLEnding = /[}\"\w\])]$/.test(trimmed);
    if (!validDSLEnding) return true;
    
    // Check for unbalanced braces in DSL
    const openBraces = (trimmed.match(/{/g) || []).length;
    const closeBraces = (trimmed.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      return true;
    }
  }
  
  // Unknown format - don't reject, let parser handle it
  return false;
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: GenerationError): string {
  let message = `⚠️ ${error.message}`;
  
  if (error.details.suggestion) {
    message += `\n💡 ${error.details.suggestion}`;
  }
  
  return message;
}
