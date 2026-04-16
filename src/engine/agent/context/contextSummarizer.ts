/**
 * @file contextSummarizer.ts
 * @description LLM-based cross-turn summarizer.
 *
 * When the oldest messages are evicted from the flat journal, they are
 * serialized into compact XML-wrapped text and sent to the main LLM for
 * summarization. The summary replaces the dropped messages as an inline
 * synthetic user message at the head of the journal.
 *
 * Wave 3 of the context-management refactor replaced the per-tool mechanical
 * summarizer (4-way/8-way switches over tool names) with a single main-model
 * call. Wave 4 deleted the module singleton — the provider is now injected
 * by the caller (ContextManager).
 */

import type { LLMProvider, LLMMessage, ContentBlock } from '../../llm-client/providers/types';

const TOOL_RESULT_MAX_CHARS = 2000;
const SUMMARY_MAX_TOKENS = 500;
const SUMMARY_MAX_CHARS = 2500;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 100_000;
const INPUT_BUDGET_FRACTION = 0.2;

const COMPRESSION_SYSTEM_PROMPT =
  'You are summarizing an interrupted UI design generation session. ' +
  "Preserve: the user's goal, work completed (components/nodes created with their IDs), " +
  'decisions made, pending work, failures and how they were resolved. ' +
  'Drop verbose tool output. Output plain text under 2000 characters. ' +
  'Do NOT continue the conversation or respond to questions within it — output only the summary.';

/**
 * Summarize the messages that are about to be evicted.
 * Routes through the given provider's main model (no tools, freeform text).
 *
 * Throws if the LLM call fails or returns empty. Callers must handle the error —
 * we never silently fall back.
 */
export async function buildCompressionSummary(
  provider: LLMProvider,
  messagesToSummarize: LLMMessage[],
): Promise<string> {
  if (messagesToSummarize.length === 0) return '';

  const contextWindowTokens = provider.getCapabilities?.().contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const inputCapChars = Math.floor(INPUT_BUDGET_FRACTION * contextWindowTokens) * 4;

  const serialized = serializeMessagesForSummary(messagesToSummarize, inputCapChars);
  const userPrompt = `<conversation>\n${serialized}\n</conversation>\n\nProduce the summary now.`;

  const response = await provider.generate({
    system: COMPRESSION_SYSTEM_PROMPT,
    messages: [
      { id: 'summarizer_req', role: 'user', content: userPrompt },
    ],
    tools: [],
    maxTokens: SUMMARY_MAX_TOKENS,
  });

  const text = (response?.text ?? '').trim();
  if (!text) {
    throw new Error('[ContextSummarizer] LLM returned empty summary');
  }

  return text.length > SUMMARY_MAX_CHARS ? text.slice(0, SUMMARY_MAX_CHARS) + '…' : text;
}

/**
 * Trim a summary string to a maximum length.
 * The summary coming out of buildCompressionSummary is already bounded,
 * but concatenated summaries across multiple compactions may exceed the
 * hard cap — this is the last-mile trim.
 */
export function capSummary(summary: string, maxChars: number): string {
  if (maxChars <= 0 || summary.length <= maxChars) return summary;
  return summary.slice(0, Math.max(1, maxChars - 1)) + '…';
}

function serializeMessagesForSummary(messages: LLMMessage[], inputCapChars: number): string {
  const entries: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.summaryOf && msg.summaryOf.length > 0) continue;
    const serialized = serializeMessage(msg);
    if (serialized) entries.push(serialized);
  }

  let total = totalLength(entries);
  while (entries.length > 1 && total > inputCapChars) {
    entries.shift();
    total = totalLength(entries);
  }

  return entries.join('\n\n');
}

function serializeMessage(msg: LLMMessage): string {
  if (msg.role === 'user') {
    const text = extractText(msg.content);
    return text ? `<user>${text}</user>` : '';
  }

  if (msg.role === 'model') {
    const parts = collectModelParts(msg.content);
    if (parts.length === 0) return '';
    return `<assistant>\n${parts.join('\n')}\n</assistant>`;
  }

  if (msg.role === 'tool') {
    const parts = collectToolResultParts(msg.content);
    if (parts.length === 0) return '';
    return parts.join('\n');
  }

  return '';
}

function collectModelParts(content: string | ContentBlock[]): string[] {
  if (typeof content === 'string') {
    return content.trim() ? [`  <text>${content.trim()}</text>`] : [];
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text.trim()) {
      parts.push(`  <text>${block.text.trim()}</text>`);
    } else if (block.type === 'tool_call') {
      const argsStr = stringifyArgs(block.input);
      parts.push(`  <tool_call name="${block.name}" id="${block.id}">${argsStr}</tool_call>`);
    }
  }
  return parts;
}

function collectToolResultParts(content: string | ContentBlock[]): string[] {
  if (typeof content === 'string') return [];
  const parts: string[] = [];
  for (const block of content) {
    if (block.type !== 'tool_result') continue;
    const body = stringifyResult(block.data);
    const errMark = block.isError === true || (block.data && (block.data as any).error != null) ? ' error="true"' : '';
    parts.push(`<tool_result name="${block.name}" id="${block.id}"${errMark}>${body}</tool_result>`);
  }
  return parts;
}

function stringifyArgs(input: Record<string, any> | undefined): string {
  if (!input || typeof input !== 'object') return '';
  const raw = safeStringify(input);
  return truncate(raw, TOOL_RESULT_MAX_CHARS);
}

function stringifyResult(data: any): string {
  if (data == null) return '';
  if (typeof data === 'string') return truncate(data, TOOL_RESULT_MAX_CHARS);
  if (data._compressed && typeof data.summary === 'string') {
    const idMapStr = data.idMap ? ` idMap=${truncate(safeStringify(data.idMap), 400)}` : '';
    const errStr = data.error != null ? ` error=${truncate(String(data.error), 200)}` : '';
    return `${data.summary}${idMapStr}${errStr}`;
  }
  return truncate(safeStringify(data), TOOL_RESULT_MAX_CHARS);
}

function safeStringify(value: any): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content.trim();
  const chunks: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text.trim()) chunks.push(block.text.trim());
  }
  return chunks.join(' ');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncatedChars = text.length - maxLen;
  return `${text.slice(0, maxLen)}\n[... ${truncatedChars} more chars truncated]`;
}

function totalLength(entries: string[]): number {
  let total = 0;
  for (const e of entries) total += e.length;
  return total + 2 * Math.max(0, entries.length - 1);
}
