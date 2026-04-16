/**
 * @file turnResultCompressor.ts
 * @description Intra-turn tool result compression.
 *
 * After the LLM has consumed a tool result and made its next decision,
 * the full result is redundant — the model's response already captures
 * the key interpretation. Replace verbose results with compact stubs
 * while preserving structural facts (node IDs, errors) that the model
 * cannot re-derive on its own.
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
  const toolMsgIndices: number[] = [];
  for (let i = 0; i < turnMessages.length; i++) {
    if (turnMessages[i].role === 'tool') {
      toolMsgIndices.push(i);
    }
  }

  if (toolMsgIndices.length < 2) return 0;

  let compressed = 0;
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

function compressToolMessage(msg: LLMMessage): boolean {
  if (typeof msg.content === 'string') return false;
  if (!Array.isArray(msg.content)) return false;

  let didCompress = false;

  for (let i = 0; i < msg.content.length; i++) {
    const block = (msg.content as ContentBlock[])[i];
    if (block.type !== 'tool_result') continue;

    const resp = block.data;
    if (!resp || resp._compressed) continue;

    const compactResponse = buildCompactResponse(block.name, resp);
    const hasError = resp.error != null;

    (msg.content as ContentBlock[])[i] = {
      type: 'tool_result',
      id: block.id,
      name: block.name,
      data: compactResponse,
      isError: hasError || undefined,
      thoughtSignature: block.thoughtSignature,
    };
    didCompress = true;
  }

  return didCompress;
}

// ---------------------------------------------------------------------------
// Build compact response — preserves IDs and errors, discards everything else
// ---------------------------------------------------------------------------

interface CompactResponse {
  _compressed: true;
  stub?: string;
  idMap?: Record<string, string>;
  id?: string;
  name?: string;
  error?: string;
  errors?: unknown;
}

function buildCompactResponse(toolName: string, resp: any): CompactResponse {
  const compact: CompactResponse = { _compressed: true };

  if (resp.idMap && typeof resp.idMap === 'object' && Object.keys(resp.idMap).length > 0) {
    compact.idMap = resp.idMap;
  }

  if (resp.id) {
    compact.id = resp.id;
    if (resp.name) compact.name = resp.name;
  }

  if (resp.error != null) {
    compact.error = String(resp.error);
    // Preserve per-op errors array for partial-failure diagnostics.
    if (Array.isArray(resp.errors)) compact.errors = resp.errors;
  }

  // If no structural fact survives, leave an identifiable marker so logs
  // remain greppable and the LLM sees a clear "this was pruned" signal.
  if (compact.idMap === undefined && compact.id === undefined && compact.error === undefined) {
    compact.stub = `[old tool result: ${toolName}]`;
  }

  return compact;
}
