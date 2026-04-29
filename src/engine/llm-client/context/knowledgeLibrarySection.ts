/**
 * @file knowledgeLibrarySection.ts
 * @description Renders the KNOWLEDGE LIBRARY menu — one section per reader tool.
 *
 * Each section maps to a dedicated tool: `skill({ name })`, `style({ name })`,
 * `anatomy({ name })`, `guideline({ name })`, `help({ name })`. Names in the
 * menu are the bare value the LLM passes — no `category:` prefix.
 *
 * Two consumers:
 *   - Subtask agents: include the menu inside the static system prompt
 *     (single-turn, KV-cache cost is negligible for short-lived agents).
 *   - Main agent: inject as a per-turn user-meta message close to the user's
 *     first prompt (see agentRuntime.ts). Static system prompt stays lean
 *     and KV-cache-stable.
 *
 * Per-section rendering decision: skill / help / guideline keep a description
 * line because the trigger isn't fully captured in the name. style / anatomy
 * use name-only because the name itself is the trigger ("neon-cyber" already
 * signals the aesthetic; "data-table" already signals the component).
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

interface SectionConfig {
  category: string;
  heading: string;
  showDescription: boolean;
}

const SECTIONS: SectionConfig[] = [
  { category: 'skill',     heading: 'skill ({ name }) — procedural workflows',     showDescription: true  },
  { category: 'help',      heading: 'help ({ name }) — process and usage help',    showDescription: true  },
  { category: 'guideline', heading: 'guideline ({ name }) — page-type templates',  showDescription: true  },
  { category: 'style',     heading: 'style ({ name }) — visual presets',           showDescription: false },
  { category: 'anatomy',   heading: 'anatomy ({ name }) — component blueprints',   showDescription: false },
];

function stripPrefix(id: string): string {
  const colon = id.indexOf(':');
  return colon >= 0 ? id.slice(colon + 1) : id;
}

function renderEntry(entry: KnowledgeEntry, showDescription: boolean): string {
  const bareName = stripPrefix(entry.id);
  if (!showDescription) {
    return `- **${bareName}**`;
  }
  const desc = (entry.description || '').trim().replace(/\s+/g, ' ');
  return `- **${bareName}** — ${desc}`;
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
  lines.push('Each section maps to a dedicated tool. Pass the bare name shown — no prefix.');
  lines.push('');
  lines.push('  `skill({ name: "restyle" })`  `style({ name: "neon-cyber" })`  `anatomy({ name: "data-table" })`');
  lines.push('');
  lines.push('**Selection rule (BLOCKING — scan the `skill` section FIRST before any creation/edit tool):**');
  lines.push('1. **Existing canvas, user is changing/adjusting** (phrasing like "换风格 / 改成 / 整成 / 做成 / 调整 / make it / restyle / redesign / give it Y vibe / it now looks too X" — or any reference to "this/it" pointing at prior work) → call **`skill({ name: "restyle" })`** FIRST. Loading a style and rebuilding wastes 60%+ tokens.');
  lines.push('2. **Fresh design from scratch** ("design a / make a / 做一个 / 设计一个" — empty canvas) → call **`skill({ name: "create-page" })`** FIRST. It detects vague vs specific prompts and decides whether to clarify with the user before building.');
  lines.push('3. Other matching skills (rich-text, design-system, component-set, agent-page) → call when their description matches the task.');
  lines.push('4. **`style`** / **`anatomy`** / **`guideline`** / **`help`** are content references — load when a skill tells you to, or when no skill matches.');
  lines.push('');

  for (const section of SECTIONS) {
    const group = byCategory.get(section.category);
    if (!group || group.length === 0) continue;

    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    lines.push(`### ${section.heading} (${sorted.length})`);
    for (const entry of sorted) {
      lines.push(renderEntry(entry, section.showDescription));
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
 * Main runtime calls `renderKnowledgeMenu()` directly when injecting via
 * `insertBeforeCurrentTurn` so the menu can evolve (incremental diffs,
 * conditional activation) without forcing a static-prompt rebuild.
 */
export const KNOWLEDGE_LIBRARY_SECTION: string = renderKnowledgeMenu();
