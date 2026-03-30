/**
 * @file sandboxEval.ts
 * @description Shared Function constructor for Figma plugin sandbox.
 *
 * Figma sandbox blocks eval() but allows new Function().
 * esbuild renames `Function` identifiers AND constant-folds string concat.
 * Solution: array join at runtime — esbuild can't fold ['Func','tion'].join('').
 */

/** Get the Function constructor in a way that survives esbuild minification. */
export function getFnCtor(): typeof Function {
  const parts = ['Func', 'tion'];
  return (globalThis as any)[parts.join('')];
}
