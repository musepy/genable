/**
 * @file knowledgeSearch.ts
 * @description Runtime knowledge search using MiniSearch over the unified knowledge index.
 *
 * Provides two operations:
 *   search(query) -> [{id, name, description}]  (lightweight catalog results)
 *   read(id)      -> string                      (full content)
 */

import MiniSearch from 'minisearch';
import knowledgeIndex from '../../../generated/knowledge-index.json';
import knowledgeContent from '../../../generated/knowledge-content.json';

interface KnowledgeEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  keywords?: string[];
  tags?: string[];
}

class KnowledgeSearchService {
  private index: MiniSearch<KnowledgeEntry>;
  private entries: KnowledgeEntry[];
  private content: Record<string, string>;

  constructor() {
    this.entries = knowledgeIndex as KnowledgeEntry[];
    this.content = knowledgeContent as Record<string, string>;

    this.index = new MiniSearch<KnowledgeEntry>({
      fields: ['id', 'name', 'description', 'category', 'keywords', 'tags'],
      storeFields: ['id'],
      searchOptions: { fuzzy: 0.2, prefix: true },
    });

    this.index.addAll(this.entries);
  }

  /**
   * Search knowledge entries by keyword.
   * Returns lightweight results (id, name, description) — no full content.
   */
  search(query: string, limit = 8): Pick<KnowledgeEntry, 'id' | 'name' | 'description'>[] {
    if (!query || !query.trim()) {
      // No query: return all entries grouped by category
      return this.entries.map(e => ({
        id: e.id,
        name: e.name,
        description: e.description,
      }));
    }

    const results = this.index.search(query.trim());
    return results.slice(0, limit).map(r => {
      const entry = this.entries.find(e => e.id === r.id)!;
      return {
        id: entry.id,
        name: entry.name,
        description: entry.description,
      };
    });
  }

  /**
   * Read full content by knowledge entry ID.
   */
  read(id: string): string | null {
    return this.content[id] ?? null;
  }

  /** List all entry IDs for diagnostics. */
  listIds(): string[] {
    return this.entries.map(e => e.id);
  }
}

// Singleton
let instance: KnowledgeSearchService | null = null;

function getInstance(): KnowledgeSearchService {
  if (!instance) {
    instance = new KnowledgeSearchService();
  }
  return instance;
}

export const knowledgeSearch = {
  search: (query: string, limit?: number) => getInstance().search(query, limit),
  read: (id: string) => getInstance().read(id),
  listIds: () => getInstance().listIds(),
};
