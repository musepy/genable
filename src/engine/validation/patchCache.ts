/**
 * @file patchCache.ts
 * @description In-session cache for design patches to ensure idempotency.
 */

export interface PatchFingerprint {
  layout?: string;
  styles?: string;
  properties?: string;
}

class PatchCache {
  private cache = new Map<string, PatchFingerprint>();

  /**
   * Generates a stable fingerprint for a patch object.
   */
  private generateFingerprint(data: any): string {
    if (!data) return '';
    // Sort keys to ensure stable stringification
    return JSON.stringify(data, Object.keys(data).sort());
  }

  /**
   * Checks if a patch should be applied to a node.
   * Updates the cache if it's a new or different patch.
   */
  shouldApply(nodeId: string, type: keyof PatchFingerprint, data: any): boolean {
    if (!data) return false;
    
    const fingerprint = this.generateFingerprint(data);
    const existing = this.cache.get(nodeId) || {};
    
    if (existing[type] === fingerprint) {
      return false; // Skip redundant patch
    }

    // Update cache
    this.cache.set(nodeId, {
      ...existing,
      [type]: fingerprint,
    });
    
    return true;
  }

  /**
   * Clears cache for a specific node (e.g. after deletion or major reset).
   */
  invalidate(nodeId: string): void {
    this.cache.delete(nodeId);
  }

  /**
   * Clears the entire cache (e.g. at the start of a new session).
   */
  clear(): void {
    this.cache.clear();
  }
}

export const patchCache = new PatchCache();
