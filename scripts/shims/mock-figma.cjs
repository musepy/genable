/**
 * Module resolution shim for headless agent runner.
 * Intercepts @create-figma-plugin/utilities imports and redirects to no-op shim.
 *
 * Usage: npx tsx --require ./scripts/shims/mock-figma.cjs scripts/run-agent.ts
 */
const Module = require('module');
const path = require('path');
const origResolve = Module._resolveFilename;

Module._resolveFilename = function(request, parent) {
  if (request === '@create-figma-plugin/utilities') {
    return path.resolve(__dirname, 'figma-utilities-noop.cjs');
  }
  return origResolve.apply(this, arguments);
};
