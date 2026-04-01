/**
 * @file jsHandler.ts
 * @description Execute arbitrary JavaScript in the Figma plugin sandbox.
 *
 * The "Bash" equivalent — full access to figma.* API.
 * Code is wrapped in an async function and eval'd in the main thread context.
 * Return values are serialized back to the caller.
 *
 * ## Error Memory System
 * Automatically learns from Figma API mistakes:
 * - Error → auto-saved to clientStorage with the offending code snippet
 * - Success after error → pairs the fix with the last error
 * - Before each execution → loads past error/fix pairs as context in the response
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { getFnCtor } from '../../utils/sandboxEval';
import { traced } from './pipelineTracer';

const FunctionConstructor = getFnCtor();

// ── Error Memory ──

const JS_MEMORY_KEY = 'js_api_lessons';
const JS_MEMORY_VERSION_KEY = 'js_api_lessons_version';
/** Bump this to clear stale lessons after major tool refactors. */
const JS_MEMORY_VERSION = 2;
const MAX_LESSONS = 20;

interface JsLesson {
  error: string;
  errorCodeSnippet: string;  // code that caused the error (truncated)
  fixCodeSnippet?: string;   // code that succeeded after the error
  timestamp: number;
}

async function loadLessons(): Promise<JsLesson[]> {
  try {
    // Clear stale lessons from old tool versions
    const version = await figma.clientStorage.getAsync(JS_MEMORY_VERSION_KEY);
    if (version !== JS_MEMORY_VERSION) {
      await figma.clientStorage.setAsync(JS_MEMORY_KEY, []);
      await figma.clientStorage.setAsync(JS_MEMORY_VERSION_KEY, JS_MEMORY_VERSION);
      return [];
    }
    const raw = await figma.clientStorage.getAsync(JS_MEMORY_KEY);
    if (raw && Array.isArray(raw)) return raw as JsLesson[];
  } catch { /* ignore */ }
  return [];
}

async function saveLessons(lessons: JsLesson[]): Promise<void> {
  try {
    // Keep only the most recent lessons
    const trimmed = lessons.slice(-MAX_LESSONS);
    await figma.clientStorage.setAsync(JS_MEMORY_KEY, trimmed);
  } catch (e) {
    console.warn('[jsHandler] Failed to save lessons:', e);
  }
}

/** Format lessons into a readable string for the agent. */
function formatLessonsForAgent(lessons: JsLesson[]): string {
  if (lessons.length === 0) return '';
  const lines = ['[JS API Lessons — learned from past errors]'];
  for (const l of lessons) {
    if (l.fixCodeSnippet) {
      lines.push(`✗ ERROR: ${l.error}`);
      lines.push(`  BAD:  ${l.errorCodeSnippet}`);
      lines.push(`  GOOD: ${l.fixCodeSnippet}`);
    } else {
      lines.push(`✗ UNRESOLVED: ${l.error}`);
      lines.push(`  BAD:  ${l.errorCodeSnippet}`);
    }
  }
  return lines.join('\n');
}

/** Extract a short code snippet relevant to the error. */
function extractSnippet(code: string, errorMsg: string, maxLen = 200): string {
  // 1. Try to find the property name from the error message
  //    e.g. "in set_effects: ..." → search for ".effects ="
  const propMatch = errorMsg.match(/in set_(\w+):|Property "(\w+)"/);
  if (propMatch) {
    const prop = propMatch[1] || propMatch[2];
    const regex = new RegExp(`\\.${prop}\\s*=`);
    const match = regex.exec(code);
    if (match) {
      const start = Math.max(0, match.index - 10);
      // Find the end of the statement (next semicolon or closing bracket)
      let end = code.indexOf(';', match.index);
      if (end === -1) end = code.indexOf('\n', match.index + 50);
      if (end === -1) end = match.index + maxLen;
      end = Math.min(end + 1, match.index + maxLen);
      return code.slice(start, end).replace(/\n/g, ' ').trim();
    }
  }

  // 2. Try line number from error (e.g. "at <input>:37:61")
  const lineMatch = errorMsg.match(/<input>:(\d+)/);
  if (lineMatch) {
    const lineNum = parseInt(lineMatch[1]) - 1; // 0-indexed
    const lines = code.split('\n');
    if (lineNum >= 0 && lineNum < lines.length) {
      const contextStart = Math.max(0, lineNum - 1);
      const contextEnd = Math.min(lines.length, lineNum + 2);
      return lines.slice(contextStart, contextEnd).join(' ').trim().slice(0, maxLen);
    }
  }

  // 3. Fallback: first N chars (but skip function declarations/boilerplate)
  const meaningful = code.replace(/^(async\s+)?function\s+\w+\([^)]*\)\s*\{/, '').trim();
  return meaningful.slice(0, maxLen).replace(/\n/g, ' ').trim();
}

// ── Serialization ──

/**
 * Serialize a Figma node (or any value) into a JSON-safe representation.
 * Figma nodes are circular — we extract useful properties only.
 */
function serializeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  // Figma node — extract key properties
  if (typeof value === 'object' && 'id' in value && 'type' in value && 'name' in value) {
    const node = value as SceneNode;
    const result: Record<string, unknown> = {
      id: node.id,
      type: node.type,
      name: node.name,
    };
    if ('width' in node) result.width = (node as any).width;
    if ('height' in node) result.height = (node as any).height;
    if ('x' in node) result.x = (node as any).x;
    if ('y' in node) result.y = (node as any).y;
    if ('children' in node && depth < 1) {
      result.childCount = (node as any).children.length;
    }
    return result;
  }

  // Array — serialize each element
  if (Array.isArray(value)) {
    // Cap at 100 items to avoid huge payloads
    const capped = value.slice(0, 100);
    const result = capped.map(v => serializeValue(v, depth + 1));
    if (value.length > 100) {
      result.push(`... and ${value.length - 100} more items`);
    }
    return result;
  }

  // Plain object — serialize recursively (1 level deep for safety)
  if (typeof value === 'object' && depth < 3) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = serializeValue(v, depth + 1);
    }
    return result;
  }

  // Fallback
  return String(value);
}

/**
 * Patterns that indicate destructive or out-of-scope operations.
 * Fail-fast: reject before execution, not after damage.
 */
const BLOCKED_PATTERNS = [
  /\.remove\s*\(\s*\)/,                  // bulk deletion (use rm command instead)
  /figma\.root/,                          // root access — can traverse entire document
  /figma\.currentPage\.children/,         // page-level bulk access
  /\.removeChild/,                        // child removal
  /\.insertChild/,                        // structure mutation (use mv command instead)
  /figma\.closePlugin/,                   // plugin lifecycle
  /figma\.notify/,                        // UI injection
  /\beval\b/,                             // nested eval
  /\bFunction\b\s*\(/,                    // nested Function constructor
  /\bimport\b\s*\(/,                      // dynamic import
];

export const handleJs = traced('handleJs()', 'jsHandler.ts', async function handleJs(parameters: any): Promise<ToolResponse> {
  const { code } = parameters;

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return {
      error: 'No code provided. Usage: js <expression>',
    };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return {
        error: `Blocked: '${pattern.source}' is not allowed in js command. Use the dedicated tool commands (rm, mv, mk) instead.`,
      };
    }
  }

  // Load past lessons to include in response
  const lessons = await loadLessons();
  const lessonsText = formatLessonsForAgent(lessons);

  // Capture async Figma API validation errors (e.g. set_effects missing fields)
  // These fire as unhandled promise rejections AFTER the property setter returns.
  // Figma main thread has no `self`/`window` — use globalThis.onunhandledrejection.
  const asyncErrors: string[] = [];
  const prevHandler = (globalThis as any).onunhandledrejection;
  (globalThis as any).onunhandledrejection = (event: any) => {
    const msg = event?.reason?.message ?? String(event?.reason);
    // Extract first meaningful line (skip verbose stack traces)
    const firstLine = msg.split('\n')[0].slice(0, 200);
    asyncErrors.push(firstLine);
    if (event?.preventDefault) event.preventDefault();
  };

  try {
    // Figma sandbox blocks eval(). Use FunctionConstructor() instead.
    const hasReturn = /\breturn\b/.test(code);
    const hasArrow = /=>/.test(code);

    let result: unknown;
    if (hasReturn || hasArrow) {
      const body = hasReturn ? code : `return ${code}`;
      const fn = FunctionConstructor('figma', `return (async function() { ${body} })()`);
      result = await fn(figma);
    } else {
      try {
        const fn = FunctionConstructor('figma', `return (async function() { return (${code}); })()`);
        result = await fn(figma);
      } catch {
        const fn = FunctionConstructor('figma', `return (async function() { ${code} })()`);
        result = await fn(figma);
      }
    }

    // Flush microtask queue so Figma validation errors surface
    await new Promise(r => setTimeout(r, 0));

    (globalThis as any).onunhandledrejection = prevHandler;

    const serialized = serializeValue(result);

    if (asyncErrors.length > 0) {
      // ── ERROR: auto-save to memory ──
      const errorMsg = asyncErrors.join('; ');
      const snippet = extractSnippet(code, errorMsg);
      lessons.push({ error: errorMsg, errorCodeSnippet: snippet, timestamp: Date.now() });
      await saveLessons(lessons);

      const stderrParts = [`[Figma API errors]\n${asyncErrors.join('\n')}`];
      if (lessonsText) stderrParts.unshift(lessonsText);

      const response: ToolResponse = {
        error: errorMsg,
      };
      (response as any)._stderr = stderrParts.join('\n\n');
      return response;
    }

    // ── SUCCESS: if there's an unresolved error, pair it with this fix ──
    const lastUnresolved = lessons.length > 0 ? lessons[lessons.length - 1] : null;
    if (lastUnresolved && !lastUnresolved.fixCodeSnippet) {
      lastUnresolved.fixCodeSnippet = extractSnippet(code, lastUnresolved.error);
      await saveLessons(lessons);
    }

    const response: ToolResponse = { data: serialized };
    // Always include lessons as context so agent learns
    if (lessonsText) {
      (response as any)._stderr = lessonsText;
    }
    return response;
  } catch (e: any) {
    (globalThis as any).onunhandledrejection = prevHandler;

    // ── SYNC ERROR: also save to memory ──
    const errorMsg = e?.message ?? String(e);
    const snippet = extractSnippet(code, errorMsg);
    lessons.push({ error: errorMsg, errorCodeSnippet: snippet, timestamp: Date.now() });
    await saveLessons(lessons);

    const allErrors = [errorMsg, ...asyncErrors];
    const stderrParts = [`[Execution error]\n${allErrors.join('\n')}`];
    if (lessonsText) stderrParts.unshift(lessonsText);

    return {
      error: allErrors.join('\n'),
      _stderr: stderrParts.join('\n\n'),
    } as any;
  }
});
