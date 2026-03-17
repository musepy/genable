/**
 * @file jsHandler.ts
 * @description Execute arbitrary JavaScript in the Figma plugin sandbox.
 *
 * The "Bash" equivalent — full access to figma.* API.
 * Code is wrapped in an async function and eval'd in the main thread context.
 * Return values are serialized back to the caller.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';

// Preserve Function constructor through esbuild.
// Figma sandbox blocks eval() but allows new Function().
// esbuild: renames `Function` identifiers AND constant-folds string concat.
// Solution: array join at runtime — esbuild can't fold ['Func','tion'].join('').
function getFnCtor(): typeof Function {
  const parts = ['Func', 'tion'];
  return (globalThis as any)[parts.join('')];
}
const FunctionConstructor = getFnCtor();

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

export async function handleJs(parameters: any): Promise<ToolResponse> {
  const { code } = parameters;

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return {
      success: false,
      error: { code: 'EMPTY_CODE', message: 'No code provided. Usage: js <expression>' },
    };
  }

  try {
    // Figma sandbox blocks eval(). Use FunctionConstructor() instead.
    // Strategy: try expression form first, fall back to statement form.
    // Arrow functions (=>) inside expression wrapping cause parse errors,
    // so detect them and go straight to statement form.
    const hasReturn = /\breturn\b/.test(code);
    const hasArrow = /=>/.test(code);

    let result: unknown;
    if (hasReturn || hasArrow) {
      // Statement form: code must use explicit return
      // For arrow functions without return, wrap as: return <code>
      const body = hasReturn ? code : `return ${code}`;
      const fn = FunctionConstructor('figma', `return (async function() { ${body} })()`);
      result = await fn(figma);
    } else {
      // Expression form: auto-return the expression value
      try {
        const fn = FunctionConstructor('figma', `return (async function() { return (${code}); })()`);
        result = await fn(figma);
      } catch {
        // Fall back to statement form (multi-statement code without return)
        const fn = FunctionConstructor('figma', `return (async function() { ${code} })()`);
        result = await fn(figma);
      }
    }

    // Serialize the result to JSON-safe format
    const serialized = serializeValue(result);

    return { success: true, data: serialized };
  } catch (e: any) {
    return {
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: e?.message ?? String(e),
        details: e?.stack?.split('\n').slice(0, 3).join('\n'),
      },
    };
  }
}
