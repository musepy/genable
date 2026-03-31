/**
 * @file unified/index.ts
 * @description Barrel export for unified tool definitions.
 *
 * LLM-facing API: 9 first-class tools, all structured JSON, no CLI parsing.
 * - jsx, inspect, edit — core CRUD (unchanged)
 * - search, structure, knowledge — promoted from `run` CLI
 * - var, comp — design system tools, promoted from `run` CLI
 * - js — escape hatch, promoted from `run` CLI
 */

import { jsxDefinition } from './jsx';
import { inspectDefinition } from './inspect';
import { editDefinition } from './edit';
import { searchDefinition } from './searchTool';
import { structureDefinition } from './structureTool';
import { knowledgeDefinition } from './knowledgeTool';
import { varToolDefinition } from './varTool';
import { compToolDefinition } from './compTool';
import { jsToolDefinition } from './jsTool';
import { ToolDefinition } from '../types';

/**
 * Primary tool set for LLM function calling.
 * All tools use structured JSON parameters with simple types.
 */
export const unifiedTools: ToolDefinition[] = [
  jsxDefinition,
  inspectDefinition,
  editDefinition,
  searchDefinition,
  structureDefinition,
  knowledgeDefinition,
  varToolDefinition,
  compToolDefinition,
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
