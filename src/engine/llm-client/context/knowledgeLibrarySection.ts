/**
 * @file knowledgeLibrarySection.ts
 * @description Renders the full KNOWLEDGE LIBRARY menu from knowledge-index.json
 * as a single static markdown string for injection into the system prompt.
 *
 * Why this exists:
 *   LLMs rarely discover knowledge via blind keyword search (knowledge.search).
 *   Showing the entire menu (id + description) in system context lets the model
 *   pick entries by id directly via knowledge.read — mirroring how Claude Code
 *   exposes its skill list in the system reminder.
 *
 * The rendering runs ONCE at module load (import time) and is cached as a module
 * constant — this keeps the static system prompt fully static and KV-cache friendly.
 */
import knowledgeIndex from '../../../generated/knowledge-index.json';

interface KnowledgeEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  keywords?: string[];
  tags?: string[];
}

// Rendering order — category -> human label (affects section ordering in output).
// Styles come first because they have the highest "decide up front" value for
// fresh designs; anatomy/guidelines are referenced during construction.
const CATEGORY_ORDER: Array<{ key: string; label: string }> = [
  { key: 'style', label: 'Style Guides' },
  { key: 'anatomy', label: 'Component Anatomy' },
  { key: 'guideline', label: 'Design Guidelines' },
  { key: 'help', label: 'How-to Help' },
  { key: 'skill', label: 'Skills' },
  { key: 'reference', label: 'Reference Tables' },
];

// Keep descriptions short so the section stays within budget. ~150 char cap
// still fits the essential "use when" hint for most entries.
const MAX_DESC_LEN = 150;

function truncate(text: string, max: number): string {
  const clean = (text || '').trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + '…';
}

function renderLibrarySection(): string {
  const entries = knowledgeIndex as KnowledgeEntry[];
  const byCategory = new Map<string, KnowledgeEntry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) || [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  const lines: string[] = [];
  lines.push('## KNOWLEDGE LIBRARY');
  lines.push('');
  lines.push(
    'You have access to a curated knowledge library. The full menu is listed below. When an entry matches your task, load it with `knowledge("<id>")` before acting — the entry carries the detail the menu line only hints at, and the static prompt stays lean by holding the detail there instead of here. For fresh designs, load at least one style entry before creating nodes so visual decisions have a source of truth.',
  );
  lines.push('');

  for (const { key, label } of CATEGORY_ORDER) {
    const group = byCategory.get(key);
    if (!group || group.length === 0) continue;

    // Stable alphabetical ordering by id within each category
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));

    lines.push(`### ${label} (${sorted.length})`);
    for (const entry of sorted) {
      const desc = truncate(entry.description || entry.name || '', MAX_DESC_LEN);
      lines.push(`- **${entry.id}** — ${desc}`);
    }
    lines.push('');
  }

  // Trim trailing blank line
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** Prebuilt KNOWLEDGE LIBRARY section — rendered once at module load. */
export const KNOWLEDGE_LIBRARY_SECTION: string = renderLibrarySection();
