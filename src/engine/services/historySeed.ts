import { ChatMessage } from '../../types/chat';
import { LLMMessage } from '../llm-client/providers/types';

const HISTORY_CONTEXT_MAX_MESSAGES = 24;
const HISTORY_CONTEXT_MAX_TOTAL_CHARS = 12_000;
const HISTORY_CONTEXT_MAX_MESSAGE_CHARS = 1_500;

function clampMessageText(text: string): string {
  if (text.length <= HISTORY_CONTEXT_MAX_MESSAGE_CHARS) return text;
  return `${text.slice(0, HISTORY_CONTEXT_MAX_MESSAGE_CHARS)}...`;
}

/**
 * Convert chat UI history into LLM-ready seed messages for cross-turn continuity.
 * Keeps only user/model text and applies tail-first truncation to bound token usage.
 */
export function buildSeedMessagesFromChatHistory(
  history: ChatMessage[],
  currentPrompt: string
): LLMMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const normalizedPrompt = currentPrompt.trim();
  let lastMeaningfulIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const text = (history[i]?.text || '').trim();
    if (text) {
      lastMeaningfulIndex = i;
      break;
    }
  }

  const shouldDropTailPrompt =
    lastMeaningfulIndex >= 0 &&
    history[lastMeaningfulIndex]?.role === 'user' &&
    history[lastMeaningfulIndex]?.text?.trim() === normalizedPrompt;

  const mapped: LLMMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    if (shouldDropTailPrompt && i === lastMeaningfulIndex) continue;

    const msg = history[i];
    const text = (msg?.text || '').trim();
    if (!text) continue;
    if (msg.role !== 'user' && msg.role !== 'model') continue;

    mapped.push({
      id: `seed_${msg.id || i}`,
      role: msg.role,
      content: clampMessageText(text),
    });
  }

  if (mapped.length === 0) return [];

  // Keep newest messages first and stop when hitting limits.
  const reversed = [...mapped].reverse();
  const kept: LLMMessage[] = [];
  let totalChars = 0;
  for (const m of reversed) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const nextChars = totalChars + content.length;
    if (kept.length >= HISTORY_CONTEXT_MAX_MESSAGES) break;
    if (kept.length > 0 && nextChars > HISTORY_CONTEXT_MAX_TOTAL_CHARS) break;
    kept.push(m);
    totalChars = nextChars;
  }

  return kept.reverse();
}
