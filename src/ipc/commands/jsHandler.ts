/**
 * @file jsHandler.ts
 * @description Execute arbitrary JavaScript in the Figma plugin sandbox.
 *
 * The "Bash" equivalent — full access to figma.* API.
 * Code is wrapped in an async function and eval'd in the main thread context.
 * Return values are serialized back to the caller.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { getFnCtor } from '../../utils/sandboxEval';
import { traced } from './pipelineTracer';

const FunctionConstructor = getFnCtor();

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
 * Sync Figma APIs that we silently rewrite to their async equivalents.
 *
 * With manifest `documentAccess: "dynamic-page"`, these sync forms throw
 * at runtime ("Cannot call ... Use ...Async instead."). Only top-level
 * `figma.*` calls where `await asyncVer()` is a drop-in semantic equivalent
 * belong here — NOT node methods like `.findAll` / `.findOne`, whose results
 * are commonly chained (`nodes.forEach`) and would break if silently awaited.
 */
const SYNC_API_REWRITES: Array<{ from: RegExp; to: string }> = [
  { from: /\bfigma\.getNodeById\b(?!Async)/g,                         to: 'await figma.getNodeByIdAsync' },
  { from: /\bfigma\.getStyleById\b(?!Async)/g,                        to: 'await figma.getStyleByIdAsync' },
  { from: /\bfigma\.getLocalPaintStyles\b(?!Async)/g,                 to: 'await figma.getLocalPaintStylesAsync' },
  { from: /\bfigma\.getLocalTextStyles\b(?!Async)/g,                  to: 'await figma.getLocalTextStylesAsync' },
  { from: /\bfigma\.getLocalEffectStyles\b(?!Async)/g,                to: 'await figma.getLocalEffectStylesAsync' },
  { from: /\bfigma\.getLocalGridStyles\b(?!Async)/g,                  to: 'await figma.getLocalGridStylesAsync' },
  { from: /\bfigma\.variables\.getLocalVariableCollections\b(?!Async)/g, to: 'await figma.variables.getLocalVariableCollectionsAsync' },
  { from: /\bfigma\.variables\.getLocalVariables\b(?!Async)/g,        to: 'await figma.variables.getLocalVariablesAsync' },
  { from: /\bfigma\.variables\.getVariableById\b(?!Async)/g,          to: 'await figma.variables.getVariableByIdAsync' },
];

/**
 * Sync node methods that we CANNOT silently rewrite (the result is often
 * chained synchronously). Instead, early-reject with an actionable hint so
 * the LLM can rewrite its own code.
 */
const NODE_METHOD_HINTS: Array<{ pattern: RegExp; fix: string }> = [
  { pattern: /\.findAll\b(?!Async)\(/,             fix: '.findAllAsync(' },
  { pattern: /\.findOne\b(?!Async)\(/,             fix: '.findOneAsync(' },
  { pattern: /\.findChildren\b(?!Async)\(/,        fix: '.findChildrenAsync(' },
  { pattern: /\.findAllWithCriteria\b(?!Async)\(/, fix: '.findAllWithCriteriaAsync(' },
  { pattern: /\.setReactions\b(?!Async)\(/,        fix: '.setReactionsAsync(' },
];

/**
 * Patterns that indicate destructive or out-of-scope operations.
 * Fail-fast: reject before execution, not after damage.
 * `hint` is shown to the LLM so it picks the right replacement tool.
 */
const READ_ENUMERATION_HINT = 'Use inspect({node:"/"}) for the page tree, or find_nodes({query:"..."}) to locate nodes by name/type.';
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\.remove\s*\(\s*\)/,         hint: 'Use the delete_node tool to remove nodes (it tracks idMap correctly).' },
  { pattern: /figma\.root/,                 hint: READ_ENUMERATION_HINT },
  { pattern: /figma\.currentPage\.children/, hint: READ_ENUMERATION_HINT },
  { pattern: /\.removeChild/,               hint: 'Use the delete_node tool instead of removing children manually.' },
  { pattern: /\.insertChild/,               hint: 'Use the move_node tool to reparent nodes (it tracks idMap correctly).' },
  { pattern: /figma\.closePlugin/,          hint: 'Plugin lifecycle / UI APIs are restricted in tool sandbox.' },
  { pattern: /figma\.notify/,               hint: 'Plugin lifecycle / UI APIs are restricted in tool sandbox.' },
  { pattern: /\beval\b/,                    hint: 'Nested code execution is not allowed.' },
  { pattern: /\bFunction\b\s*\(/,           hint: 'Nested code execution is not allowed.' },
  { pattern: /\bimport\b\s*\(/,             hint: 'Nested code execution is not allowed.' },
];

export const handleJs = traced('handleJs()', 'jsHandler.ts', async function handleJs(parameters: any): Promise<ToolResponse> {
  const { code } = parameters;

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return {
      error: 'No code provided. Usage: js <expression>',
    };
  }

  // Early-reject sync node methods that cannot be silently rewritten.
  // Emit a specific, actionable hint BEFORE the generic blocked-pattern check.
  for (const { pattern, fix } of NODE_METHOD_HINTS) {
    const m = code.match(pattern);
    if (m) {
      return {
        error: `Sync API "${m[0]}" not available in documentAccess: dynamic-page mode. Use "${fix}" instead (await the result).`,
      };
    }
  }

  for (const { pattern, hint } of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return {
        error: `Blocked: '${pattern.source}' is not allowed in js command. ${hint}`,
      };
    }
  }

  // Capture async Figma API validation errors (e.g. set_effects missing fields)
  // These fire as unhandled promise rejections AFTER the property setter returns.
  // Figma main thread has no `self`/`window` — use globalThis.onunhandledrejection.
  const asyncErrors: string[] = [];
  const prevHandler = (globalThis as any).onunhandledrejection;
  (globalThis as any).onunhandledrejection = (event: any) => {
    const msg = event?.reason?.message ?? String(event?.reason);
    const firstLine = msg.split('\n')[0].slice(0, 200);
    asyncErrors.push(firstLine);
    if (event?.preventDefault) event.preventDefault();
  };

  try {
    // Figma sandbox blocks eval(). Use FunctionConstructor() instead.
    // Pit-of-success: auto-rewrite common safe sync→async mappings (top-level
    // figma.* only, where `await asyncVer()` is a drop-in equivalent). Node
    // methods (.findAll, .findOne, etc.) are early-rejected above with an
    // actionable hint — NOT silently rewritten, because their results are
    // commonly chained synchronously.
    let asyncCode = code;
    for (const { from, to } of SYNC_API_REWRITES) {
      asyncCode = asyncCode.replace(from, to);
    }
    const hasReturn = /\breturn\b/.test(asyncCode);
    const hasArrow = /=>/.test(asyncCode);

    let result: unknown;
    if (hasReturn || hasArrow) {
      const body = hasReturn ? asyncCode : `return ${asyncCode}`;
      const fn = FunctionConstructor('figma', `return (async function() { ${body} })()`);
      result = await fn(figma);
    } else {
      try {
        const fn = FunctionConstructor('figma', `return (async function() { return (${asyncCode}); })()`);
        result = await fn(figma);
      } catch {
        const fn = FunctionConstructor('figma', `return (async function() { ${asyncCode} })()`);
        result = await fn(figma);
      }
    }

    // Flush microtask queue so Figma validation errors surface
    await new Promise(r => setTimeout(r, 0));

    (globalThis as any).onunhandledrejection = prevHandler;

    if (asyncErrors.length > 0) {
      return { error: asyncErrors.join('; ') };
    }

    return { data: serializeValue(result) };
  } catch (e: any) {
    (globalThis as any).onunhandledrejection = prevHandler;
    const errorMsg = e?.message ?? String(e);
    const allErrors = [errorMsg, ...asyncErrors];
    return { error: allErrors.join('\n') };
  }
});
