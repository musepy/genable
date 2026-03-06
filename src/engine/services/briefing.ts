import { ChatMessage } from '../../types/chat';

interface SelectedNode { id: string; name: string; type: string }

/**
 * Build a workspace briefing string for cross-turn context.
 * Extracts: last exchange text + aggregated idMap + current selection.
 * Returns null on first turn with no selection.
 */
export function buildBriefing(
  history: ChatMessage[],
  selection: SelectedNode[],
): string | null {
  const parts: string[] = [];

  // Last model response (truncated) — for conversational continuity
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'model' && m.text) {
      parts.push(m.text.length > 600 ? m.text.slice(0, 600) + '…' : m.text);
      break;
    }
  }

  // Aggregate idMap from ALL previous create/edit results
  const nodeMap: Record<string, string> = {};
  for (const m of history) {
    if (m.role !== 'model' || !m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      if (tc.name !== 'create' && tc.name !== 'edit') continue;
      const map = tc.result?.data?.idMap;
      if (map && typeof map === 'object') Object.assign(nodeMap, map);
    }
  }
  const entries = Object.entries(nodeMap);
  if (entries.length > 0) {
    const capped = entries.slice(-40).map(([k, v]) => `${k}=${v}`).join(' ');
    parts.push(`[Nodes] ${capped}`);
  }

  // Current selection
  if (selection.length > 0) {
    const sel = selection.slice(0, 10)
      .map(n => `"${n.name}"(${n.type},${n.id})`).join(' ');
    parts.push(`[Selected] ${sel}`);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}
