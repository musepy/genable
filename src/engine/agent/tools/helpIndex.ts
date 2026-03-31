/**
 * @file helpIndex.ts
 * @description Runtime help article search using MiniSearch (BM25 fuzzy search).
 *
 * Provides semantic search over help articles generated from src/prompts/help/*.md.
 * Singleton pattern — initialized on first use.
 */

import MiniSearch from 'minisearch';
import catalog from '../../../generated/help-catalog.json';

// ==========================================
// Legacy tool name sanitizer
// ==========================================

/**
 * Replace deprecated CLI tool names in help content with current tool names.
 * Prevents help articles from teaching the LLM to call tools that no longer exist.
 */
function sanitizeLegacyHelp(text: string): string {
  if (!text) return text;
  return text
    // CLI commands → structured tool equivalents (in prose/examples)
    .replace(/\bmk\s+\//g, '⚠️[use jsx] /')
    .replace(/\bcat\s+\//g, '⚠️[use inspect] /')
    .replace(/\bcat\(/g, '⚠️[use inspect](')
    .replace(/\btree\s+\//g, '⚠️[use inspect] /')
    .replace(/\btree\(/g, '⚠️[use inspect](')
    .replace(/\bls\s+\//g, '⚠️[use inspect] /')
    .replace(/\bls\(/g, '⚠️[use inspect](')
    .replace(/`mk`/g, '`jsx`')
    .replace(/`ls`/g, '`inspect`')
    .replace(/`tree`/g, '`inspect`')
    .replace(/`cat`/g, '`inspect`')
    .replace(/`man`/g, '`knowledge`')
    .replace(/`grep`/g, '`search`')
    .replace(/`sed`/g, '`search (replace mode)`')
    .replace(/\brender\b(?!ing|ed|s)/gi, 'jsx');
}

// ==========================================
// Types
// ==========================================

export interface HelpArticle {
  id: string;
  title: string;
  keywords: string[];
  whenToUse: string;
  content: string;
}

interface HelpCatalog {
  articles: HelpArticle[];
}

// ==========================================
// HelpIndex
// ==========================================

class HelpIndex {
  private articles: HelpArticle[];
  private index: MiniSearch<HelpArticle>;

  constructor() {
    const data = catalog as HelpCatalog;
    // Sanitize legacy tool references in help content at load time
    this.articles = data.articles.map(a => ({
      ...a,
      content: sanitizeLegacyHelp(a.content),
    }));

    this.index = new MiniSearch<HelpArticle>({
      fields: ['id', 'title', 'keywords', 'whenToUse'],
      storeFields: ['id'],
      searchOptions: { fuzzy: 0.2, prefix: true },
    });

    this.index.addAll(this.articles);
  }

  /** Exact match by article id */
  getById(id: string): HelpArticle | null {
    return this.articles.find(a => a.id === id) ?? null;
  }

  /** BM25 fuzzy search across id, title, keywords, whenToUse */
  search(query: string, limit = 2): HelpArticle[] {
    const results = this.index.search(query);
    return results.slice(0, limit).map(result => {
      return this.articles.find(a => a.id === result.id)!;
    }).filter(Boolean);
  }

  /** List all available topics (without full content) */
  listTopics(): { id: string; title: string; whenToUse: string }[] {
    return this.articles.map(a => ({
      id: a.id,
      title: a.title,
      whenToUse: a.whenToUse,
    }));
  }
}

// ==========================================
// Singleton export
// ==========================================

let instance: HelpIndex | null = null;

function getHelpIndex(): HelpIndex {
  if (!instance) {
    instance = new HelpIndex();
  }
  return instance;
}

export const helpIndex = {
  getById: (id: string) => getHelpIndex().getById(id),
  search: (query: string, limit?: number) => getHelpIndex().search(query, limit),
  listTopics: () => getHelpIndex().listTopics(),
};
