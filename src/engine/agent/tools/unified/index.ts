/**
 * @file unified/index.ts
 * @description Barrel export for unified tool definitions.
 *
 * LLM-facing API: first-class tools, all structured JSON, verb_noun naming.
 */

import { jsxDefinition } from './jsx';
import { inspectDefinition } from './inspect';
import { describeDefinition } from './describe';
import { editDefinition } from './edit';
import { findNodesDefinition, discoverPropsDefinition, replacePropsDefinition } from './searchTool';
import { deleteNodeDefinition, moveNodeDefinition, cloneNodeDefinition } from './structureTool';
import { knowledgeDefinition } from './knowledgeTool';
import { listVariablesDefinition, createCollectionDefinition, createVariableDefinition, setVariableValueDefinition, bindVariableDefinition, setVariableModeDefinition } from './varTool';
import { createComponentDefinition, combineComponentsDefinition, addComponentPropDefinition, listComponentPropsDefinition, createInstanceDefinition } from './compTool';
import { jsToolDefinition } from './jsTool';
import { setTextDefinition, setFillDefinition, setStrokeDefinition, setLayoutDefinition } from './setterTools';
import { getSelectionDefinition } from './selectionTool';
import { getScreenshotDefinition } from './screenshotTool';
import { askUserDefinition } from './askUser';
import { subtaskDefinition } from './subtask';
import { ToolDefinition } from '../types';

/**
 * Primary tool set for LLM function calling.
 * All tools use structured JSON parameters with verb_noun naming.
 */
export const unifiedTools: ToolDefinition[] = [
  // Core CRUD
  jsxDefinition,
  inspectDefinition,
  describeDefinition,
  editDefinition,
  // Search
  findNodesDefinition,
  discoverPropsDefinition,
  replacePropsDefinition,
  // Structure
  deleteNodeDefinition,
  moveNodeDefinition,
  cloneNodeDefinition,
  // Knowledge
  knowledgeDefinition,
  // Variables
  listVariablesDefinition,
  createCollectionDefinition,
  createVariableDefinition,
  setVariableValueDefinition,
  bindVariableDefinition,
  setVariableModeDefinition,
  // Components
  createComponentDefinition,
  combineComponentsDefinition,
  addComponentPropDefinition,
  listComponentPropsDefinition,
  createInstanceDefinition,
  // Setters (focused, single-intent)
  setTextDefinition,
  setFillDefinition,
  setStrokeDefinition,
  setLayoutDefinition,
  // Selection (opt-in, not auto-injected)
  getSelectionDefinition,
  // Visual verification
  getScreenshotDefinition,
  // User interaction
  askUserDefinition,
  // Delegation
  subtaskDefinition,
  // Escape hatch
  jsToolDefinition,
];

/** All tool names — used for allowedToolNames in dispatcher. */
export const TOOL_NAMES = unifiedTools.map(t => t.name);

/** Find closest tool name using Levenshtein distance. */
export function findClosestTool(input: string): string | null {
  const lower = input.toLowerCase();
  let best: string | null = null;
  let bestDist = lower.length <= 3 ? 2 : 4;

  for (const name of TOOL_NAMES) {
    const d = levenshtein(lower, name);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
    if (name.startsWith(lower) && lower.length >= 2) {
      return name;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}
