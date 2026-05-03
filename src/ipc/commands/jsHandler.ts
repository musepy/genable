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
 * Per-method hints for "X is not a function" errors. The LLM frequently calls
 * sync/async methods on the wrong receiver type — the V8 error "X is not a
 * function" alone doesn't say WHY. We catch the failure post-execution and
 * stitch in receiver type + remediation so the next iteration corrects course
 * instead of retrying blind.
 *
 * Lookup: METHOD_HINTS[methodName][receiverType] || METHOD_HINTS[methodName]['*']
 * Keep this list small — only methods the LLM has actually mis-called in logs.
 */
const METHOD_HINTS: Record<string, Record<string, string>> = {
  findAllAsync: {
    FRAME: 'findAllAsync is only available on Page/Document nodes. For Frame children, use frame.children.filter(predicate) or recurse manually.',
    GROUP: 'findAllAsync is only available on Page/Document nodes. For Group children, use group.children.filter(predicate) or recurse manually.',
    COMPONENT: 'findAllAsync is only available on Page/Document nodes. For Component children, use node.children.filter(predicate) or recurse manually.',
    COMPONENT_SET: 'findAllAsync is only available on Page/Document nodes. For ComponentSet children, use node.children.filter(predicate) or recurse manually.',
    INSTANCE: 'findAllAsync is only available on Page/Document nodes. For Instance children, use node.children.filter(predicate) or recurse manually.',
    SECTION: 'findAllAsync is only available on Page/Document nodes. For Section children, use node.children.filter(predicate) or recurse manually.',
  },
  findOneAsync: {
    FRAME: 'findOneAsync is only available on Page/Document nodes. For Frame descendants, walk node.children manually.',
    GROUP: 'findOneAsync is only available on Page/Document nodes. For Group descendants, walk node.children manually.',
    COMPONENT: 'findOneAsync is only available on Page/Document nodes. For Component descendants, walk node.children manually.',
    INSTANCE: 'findOneAsync is only available on Page/Document nodes. For Instance descendants, walk node.children manually.',
    SECTION: 'findOneAsync is only available on Page/Document nodes. For Section descendants, walk node.children manually.',
  },
  findChildren: {
    '*': 'Use findChildrenAsync (with await) — sync findChildren is unavailable in dynamic-page mode.',
  },
  findAll: {
    '*': 'Use findAllAsync (with await) — sync findAll is unavailable in dynamic-page mode.',
  },
  findOne: {
    '*': 'Use findOneAsync (with await) — sync findOne is unavailable in dynamic-page mode.',
  },
  getPluginData: {
    '*': 'getPluginData requires the node to be in scope. Verify the variable holds a node, not a serialized {id,type,name} object.',
  },
};

/** Try to extract the receiver expression that precedes `.<methodName>(` in source. */
function extractReceiverExpr(source: string, methodName: string): string | null {
  // Escape methodName for regex safety (only word chars expected, but be defensive).
  const safe = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match a simple identifier (or chained property access) immediately before the call.
  // Heuristic — covers the common case `varName.method(...)` and `obj.prop.method(...)`.
  const re = new RegExp(`([A-Za-z_$][\\w$.]*)\\s*\\.\\s*${safe}\\s*\\(`);
  const m = source.match(re);
  return m ? m[1] : null;
}

/**
 * Try to infer the Figma node type held by a given variable name based on a
 * static read of the code. Looks for assignments like:
 *   var card = await figma.getNodeByIdAsync('1:5');
 *   const x = await figma.getNodeByIdAsync('...');
 * If found, resolves the node at runtime and reads `.type`. Returns null if no
 * pattern matched or the resolved value isn't a node.
 */
async function inferReceiverNodeType(source: string, varName: string): Promise<string | null> {
  if (!varName) return null;
  // Strip array/property suffix — we want the base identifier.
  const base = varName.split('.')[0].split('[')[0];
  const safe = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match: <decl>? base = (await)? figma.getNodeByIdAsync('id')
  const re = new RegExp(
    `(?:var|let|const)?\\s*${safe}\\s*=\\s*await\\s+figma\\.getNodeByIdAsync\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)`,
  );
  const m = source.match(re);
  if (!m) return null;
  const id = m[1];
  try {
    const node = await (figma as any).getNodeByIdAsync(id);
    if (node && typeof node === 'object' && typeof node.type === 'string') {
      return node.type as string;
    }
  } catch {
    /* ignore — node may have been deleted */
  }
  return null;
}

/**
 * Build a structured "not a function" diagnostic from a caught exception and
 * the original source. Returns null if the error doesn't match the pattern.
 */
export async function buildNotAFunctionDiagnostic(
  errorMessage: string,
  source: string,
): Promise<{ error: string; data: Record<string, unknown> } | null> {
  // Match V8-style "<expr>.<method> is not a function" — captures the LAST
  // identifier in a property-access chain. Also handles bare "<method> is not
  // a function" (no receiver). We deliberately accept a leading dot since V8
  // emits e.g. "card.findAllAsync is not a function".
  const m = errorMessage.match(/([A-Za-z_$][\w$]*)\s+is not a function/);
  // If the bare phrase appears without an identifier capture, we still surface
  // a generic diagnostic — better than echoing "not a function" alone.
  const looseMatch = /\bis not a function\b/.test(errorMessage);
  if (!m && !looseMatch) return null;

  // Filter out method names that are actually generic noise — "undefined is
  // not a function" carries no useful method. Treat it as the loose case.
  const rawMethod = m ? m[1] : null;
  const method = rawMethod && rawMethod !== 'undefined' && rawMethod !== 'null' ? rawMethod : null;
  let receiverExpr: string | null = null;
  let receiverType: string | null = null;
  if (method) {
    receiverExpr = extractReceiverExpr(source, method);
    if (receiverExpr) {
      receiverType = await inferReceiverNodeType(source, receiverExpr);
    }
  }

  // Look up a hint by [method][type], falling back to [method]['*'].
  let suggestion = '';
  if (method) {
    const byMethod = METHOD_HINTS[method];
    if (byMethod) {
      if (receiverType && byMethod[receiverType]) {
        suggestion = byMethod[receiverType];
      } else if (byMethod['*']) {
        suggestion = byMethod['*'];
      }
    }
  }
  if (!suggestion) {
    suggestion = method
      ? `Method '${method}' does not exist on this receiver. Check the Figma plugin API for the correct method or receiver type.`
      : 'A called value was not a function. Check that the receiver is the type you expect (e.g. await figma.getNodeByIdAsync returns a node, not a serialized object).';
  }

  const where = receiverType
    ? `node of type ${receiverType}`
    : receiverExpr
    ? `'${receiverExpr}'`
    : 'this object';

  const error = method
    ? `Method '${method}' does not exist on ${where}. ${suggestion}`
    : `Call failed: 'is not a function' on ${where}. ${suggestion}`;

  return {
    error,
    data: {
      method,
      receiver_expr: receiverExpr,
      receiver_type: receiverType,
      suggestion,
      original_error: errorMessage,
    },
  };
}

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

    // Enrich "X is not a function" — V8 gives the LLM nothing actionable here
    // ("not a function" alone repeats blind). Only this pattern is enriched;
    // TypeError/ReferenceError/syntax errors flow through unchanged.
    const diag = await buildNotAFunctionDiagnostic(errorMsg, code);
    if (diag) {
      // Append any async errors to original_error trail so we don't lose them.
      if (asyncErrors.length > 0) {
        diag.data.original_error = `${errorMsg}; ${asyncErrors.join('; ')}`;
      }
      return diag;
    }

    const allErrors = [errorMsg, ...asyncErrors];
    return { error: allErrors.join('\n') };
  }
});
