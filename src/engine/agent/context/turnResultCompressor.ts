/**
 * @file turnResultCompressor.ts
 * @description Intra-turn tool result compression.
 *
 * After the LLM has consumed a tool result and made its next decision,
 * the full result is redundant — the model's response already captures
 * the key interpretation. Replace verbose results with compact summaries
 * while preserving node IDs (needed for subsequent operations) and
 * error details (needed for cross-iteration learning).
 *
 * Called at the start of each iteration, before assemblePrompt().
 * Only compresses tool results that the LLM has already seen (all except the latest).
 *
 * Timeline:
 *   Iteration 0: [user] → LLM → [model_0, tool_0]
 *   Iteration 1: LLM sees tool_0 → [model_1, tool_1]
 *   Iteration 2: compress tool_0 (consumed), keep tool_1 (fresh) → LLM sees tool_1
 */

import { LLMMessage, ContentBlock } from '../../llm-client/providers/types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress all tool result messages in turnMessages except the most recent one.
 * Mutates messages in-place for zero-copy efficiency.
 *
 * Safe to call every iteration — skips already-compressed results and is a
 * no-op when there are fewer than 2 tool result messages.
 *
 * @returns Number of tool result messages compressed in this call.
 */
export function compressConsumedToolResults(turnMessages: LLMMessage[]): number {
  // Find all tool result message indices
  const toolMsgIndices: number[] = [];
  for (let i = 0; i < turnMessages.length; i++) {
    if (turnMessages[i].role === 'tool') {
      toolMsgIndices.push(i);
    }
  }

  // Need at least 2 tool results — keep the latest uncompressed
  if (toolMsgIndices.length < 2) return 0;

  let compressed = 0;
  // Compress all except the last tool result message
  for (let k = 0; k < toolMsgIndices.length - 1; k++) {
    if (compressToolMessage(turnMessages[toolMsgIndices[k]])) {
      compressed++;
    }
  }
  return compressed;
}

// ---------------------------------------------------------------------------
// Internal: compress a single tool result message
// ---------------------------------------------------------------------------

/**
 * Replace verbose tool_result data with a compact summary.
 * Returns true if any block was actually compressed (false if all were already compressed).
 */
function compressToolMessage(msg: LLMMessage): boolean {
  if (typeof msg.content === 'string') return false;
  if (!Array.isArray(msg.content)) return false;

  let didCompress = false;

  for (let i = 0; i < msg.content.length; i++) {
    const block = (msg.content as ContentBlock[])[i];
    if (block.type !== 'tool_result') continue;

    const resp = block.data;
    if (!resp || resp._compressed) continue;

    const name = block.name;
    const compactResponse = buildCompactResponse(name, resp);

    // Mutate in place — replace the data object
    (msg.content as ContentBlock[])[i] = {
      type: 'tool_result',
      id: block.id,
      name: block.name,
      data: compactResponse,
      thoughtSignature: block.thoughtSignature,
    };
    didCompress = true;
  }

  return didCompress;
}

// ---------------------------------------------------------------------------
// Build compact response — preserves IDs and errors, drops verbose content
// ---------------------------------------------------------------------------

interface CompactResponse {
  _compressed: true;
  summary: string;
  idMap?: Record<string, string>;
  id?: string;
  name?: string;
  children?: any[];
  error?: string;
}

function buildCompactResponse(toolName: string, resp: any): CompactResponse {
  const ok = !resp.error;
  const summary = ok
    ? summarizeSuccess(toolName, resp)
    : summarizeFailure(toolName, resp);

  const compact: CompactResponse = {
    _compressed: true,
    summary,
  };

  // Preserve idMap — LLM needs node IDs for subsequent operations
  if (resp.idMap && typeof resp.idMap === 'object' && Object.keys(resp.idMap).length > 0) {
    compact.idMap = resp.idMap;
  }

  // Preserve node identity (jsx spreads {id, name, type, children} to top level)
  if (resp.id) {
    compact.id = resp.id;
    if (resp.name) compact.name = resp.name;
    if (resp.children) compact.children = resp.children;
  }

  // Preserve error — cross-iteration learning
  if (!ok) {
    compact.error = resp.error;
  }

  return compact;
}

// ---------------------------------------------------------------------------
// Summarizers — adapted from contextSummarizer patterns
// ---------------------------------------------------------------------------

function summarizeSuccess(toolName: string, resp: any): string {
  // After presentForLLM flattening, data fields are at top level (resp.X, not resp.data.X)

  // Creation — preserve idMap (LLM needs IDs for subsequent operations)
  if (toolName === 'jsx') {
    if (resp.id) {
      const childCount = Array.isArray(resp.children) ? resp.children.length : 0;
      return `created ${resp.created || '?'} nodes, root: ${resp.name || resp.type}#${resp.id} (${childCount} children)`;
    }
    return summarizeIdMap(resp.idMap) || 'created ok';
  }

  // Edit — show count + change summary
  if (toolName === 'edit') {
    const edited = resp.edited ?? resp.editedCount;
    const changeSummary = resp.changeSummary;
    if (changeSummary && typeof changeSummary === 'string') {
      return `edited ${edited ?? '?'}: ${changeSummary.slice(0, 120)}`;
    }
    return edited ? `edited ${edited} nodes` : 'edited ok';
  }

  // Read tools — show content size
  if (toolName === 'inspect' || toolName === 'describe') {
    const content = resp.tree ?? resp.listing;
    if (typeof content === 'string') return `${content.split('\n').length} lines`;
    return 'ok';
  }

  // Search — show match count
  if (toolName === 'find_nodes' || toolName === 'discover_props') {
    if (Array.isArray(resp.results)) return `${resp.results.length} matches`;
    return 'ok';
  }
  if (toolName === 'replace_props') {
    return resp.replaced != null ? `replaced ${resp.replaced}` : 'ok';
  }

  // Structure
  if (toolName === 'clone_node') {
    return summarizeIdMap(resp.idMap) || 'cloned ok';
  }
  if (toolName === 'delete_node') {
    return resp.deleted ? `deleted ${resp.deleted}` : 'ok';
  }
  if (toolName === 'move_node') {
    return resp.name ? `moved → ${resp.name}` : 'ok';
  }

  // Generic fallback — most setter/variable/component tools return small results
  return 'ok';
}

function summarizeIdMap(idMap: any): string {
  if (!idMap || typeof idMap !== 'object') return '';
  const entries = Object.entries(idMap);
  if (entries.length === 0) return '';
  const sample = entries.slice(0, 8).map(([k, v]) => `${k}=${v}`);
  const suffix = entries.length > 8 ? ` +${entries.length - 8} more` : '';
  return `created ${entries.length} nodes [${sample.join(', ')}${suffix}]`;
}

function summarizeFailure(_toolName: string, resp: any): string {
  // After flattening, error is a string (not {code, message})
  const errorMsg = String(resp.error || '');

  // Detect partial failure (errors array present alongside error)
  if (resp.errors && Array.isArray(resp.errors)) {
    const errorCount = resp.errors.length;
    const successCount = resp.idMap ? Object.keys(resp.idMap).length : 0;
    return `PARTIAL: ${errorCount} failed, ${successCount} succeeded`;
  }

  return `FAIL: ${errorMsg.slice(0, 100)}`;
}
