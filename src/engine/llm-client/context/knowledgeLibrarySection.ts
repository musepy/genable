/**
 * @file knowledgeLibrarySection.ts
 * @description Renders the KNOWLEDGE LIBRARY menu from knowledge-index.json.
 *
 * Two consumers:
 *   - Subtask agents: include the menu inside the static system prompt
 *     (single-turn, KV-cache cost is negligible for short-lived agents).
 *   - Main agent: inject as a per-turn user-meta message close to the user's
 *     first prompt (see agentRuntime.ts). Static system prompt stays lean
 *     and KV-cache-stable.
 *
 * Tiered budget — categories carry different signal density:
 *   - skill / help: procedural SOPs / process guidance — full description
 *   - guideline:    product-type layout templates — full description
 *   - style:        token sets for a named aesthetic — name + brief mood
 *   - anatomy:      structural references — name + brief role
 *   - reference:    lookup tables — name + brief topic
 *
 * Why tiering: with ~95 entries × uniform 150-char descriptions = ~2.4K tokens
 * of attention all on the same level. Procedural skills get drowned by
 * topic-similar style entries. Tiering lets the high-signal categories
 * keep their full hint while lookup-style content compresses to name + topic.
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

// Rendering order — procedural first so the model sees workflow guidance
// before content libraries.
const CATEGORY_ORDER: Array<{ key: string; label: string }> = [
  { key: 'skill', label: 'Skills (procedural workflows)' },
  { key: 'help', label: 'How-to Help (process guidance)' },
  { key: 'guideline', label: 'Design Guidelines (product-type templates)' },
  { key: 'style', label: 'Style Guides (visual token sets)' },
  { key: 'anatomy', label: 'Component Anatomy (structural references)' },
  { key: 'reference', label: 'Reference Tables' },
];

interface TierConfig {
  /** Max chars for the description after truncation. */
  maxDesc: number;
  /** When true, fall back to the entry's `name` if `description` is short or missing. */
  preferNameOnly: boolean;
}

const TIER_CONFIG: Record<string, TierConfig> = {
  skill:     { maxDesc: 200, preferNameOnly: false },
  help:      { maxDesc: 200, preferNameOnly: false },
  guideline: { maxDesc: 150, preferNameOnly: false },
  style:     { maxDesc: 60,  preferNameOnly: true  },
  anatomy:   { maxDesc: 60,  preferNameOnly: true  },
  reference: { maxDesc: 60,  preferNameOnly: true  },
};

const DEFAULT_TIER: TierConfig = { maxDesc: 100, preferNameOnly: false };

function truncate(text: string, max: number): string {
  const clean = (text || '').trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + '…';
}

function renderEntryLine(entry: KnowledgeEntry): string {
  const tier = TIER_CONFIG[entry.category] || DEFAULT_TIER;
  const rawDesc = (entry.description || '').trim();

  if (tier.preferNameOnly) {
    // Brief: prefer the human name over the long description; fall back to
    // a truncated description only if name is empty.
    const head = entry.name || truncate(rawDesc, tier.maxDesc);
    return `- **${entry.id}** — ${head}`;
  }

  const desc = truncate(rawDesc, tier.maxDesc);
  return `- **${entry.id}** — ${desc}`;
}

/** Build the rendered KNOWLEDGE LIBRARY menu. Pure — call multiple times safely. */
export function renderKnowledgeMenu(): string {
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
    'Curated entries available via `knowledge({action:"read", id:"<id>"})`. The menu lists ids + hints — full content loads on read.',
  );
  lines.push('');
  lines.push(
    '**Selection rule (REQUIRED before loading any entry):**',
  );
  lines.push(
    '1. If the user is changing/adjusting an EXISTING design on canvas (any phrasing — "换风格 / 改成 / 整成 / 做成 / 调整 / make it / restyle / redesign / give it Y vibe / it now looks too X" — or any reference to "this/it" pointing at prior work), READ a **skill:** entry FIRST. The skill tells you the workflow (e.g. inspect→edit vs rebuild). Loading a style: directly and rebuilding wastes 60%+ tokens.',
  );
  lines.push(
    '2. For a fresh design (no prior canvas state to preserve), load a **style:** entry first for the visual token system, then create.',
  );
  lines.push(
    '3. **anatomy:** / **guideline:** entries can be loaded any time as supplementary references.',
  );
  lines.push('');

  for (const { key, label } of CATEGORY_ORDER) {
    const group = byCategory.get(key);
    if (!group || group.length === 0) continue;

    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    lines.push(`### ${label} (${sorted.length})`);
    for (const entry of sorted) {
      lines.push(renderEntryLine(entry));
    }
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/**
 * Backward-compat constant for callers that haven't migrated to per-turn
 * injection (subtask agents). Rendered once at module load.
 *
 * Main runtime should call `renderKnowledgeMenu()` directly when injecting
 * via `insertBeforeCurrentTurn` so the menu can evolve (incremental diffs,
 * conditional activation) without forcing a static-prompt rebuild.
 */
export const KNOWLEDGE_LIBRARY_SECTION: string = renderKnowledgeMenu();
