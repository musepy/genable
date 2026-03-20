/**
 * @file styleTokens.ts
 * @description Mutable style token registry for semantic rendering.
 *
 * Tokens use mk shorthand (size, weight, fill, corner, p, gap, layout, etc.)
 * The flat ops normalizer handles expansion to Figma API properties.
 *
 * Three-layer override:
 *   1. Defaults (this file)          — permanent
 *   2. Agent runtime mutation (token set) — session-scoped
 *   3. Per-call overrides (render markup) — single call
 */

type TokenProps = Record<string, string | number>;

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_TEXT: Record<string, TokenProps> = {
  h1:           { size: 32, weight: 'Bold',      fill: '#0F172A' },
  h2:           { size: 24, weight: 'SemiBold',  fill: '#0F172A' },
  h3:           { size: 20, weight: 'SemiBold',  fill: '#1E293B' },
  body:         { size: 14, weight: 'Regular',   fill: '#475569' },
  'body-sm':    { size: 12, weight: 'Regular',   fill: '#64748B' },
  caption:      { size: 12, weight: 'Regular',   fill: '#94A3B8' },
  'stat-value': { size: 36, weight: 'Bold',      fill: '#0F172A' },
  'stat-label': { size: 12, weight: 'Medium',    fill: '#64748B', textCase: 'UPPER' },
  overline:     { size: 11, weight: 'SemiBold',  fill: '#94A3B8', textCase: 'UPPER' },
  'chat-title': { size: 16, weight: 'SemiBold',  fill: '#0F172A', w: 'fill' },
  'agent-name': { size: 11, weight: 'SemiBold',  fill: '#6366F1', w: 'fill' },
  'agent-text': { size: 14, weight: 'Regular',   fill: '#1E293B', w: 'fill' },
  'user-name':  { size: 11, weight: 'SemiBold',  fill: '#64748B', w: 'fill' },
  'user-text':  { size: 14, weight: 'Regular',   fill: '#1E293B', w: 'fill' },
  'link-text':  { size: 12, weight: 'Medium',    fill: '#6366F1', w: 'fill' },
};

const DEFAULT_CONTAINER: Record<string, TokenProps> = {
  page:         { layout: 'vertical',   p: 48, gap: 32, w: 'hug', h: 'hug' },
  card:         { layout: 'vertical',   p: 24, gap: 12, corner: 12, fill: '#FFFFFF', w: 'hug', h: 'hug' },
  row:          { layout: 'horizontal', gap: 16, w: 'hug', h: 'hug' },
  column:       { layout: 'vertical',   gap: 16, w: 'hug', h: 'hug' },
  section:      { layout: 'vertical',   gap: 16, w: 'hug', h: 'hug' },
  chip:         { layout: 'horizontal', gap: 4, corner: 100, fill: '#F1F5F9', w: 'hug', h: 'hug' },
  'chat-panel': { layout: 'vertical', p: 24, gap: 12, corner: 16, fill: '#FFFFFF', w: 380, h: 'hug',
                  stroke: '#E2E8F0', strokeW: 1 },
  bubble:       { layout: 'vertical', p: 16, gap: 6, corner: 12, fill: '#EEF2FF', w: 'fill', h: 'hug' },
  'user-bubble':{ layout: 'vertical', p: 12, gap: 4, corner: 12, fill: '#F1F5F9', w: 'fill', h: 'hug' },
  // Design system tokens
  palette:      { layout: 'vertical', gap: 8, w: 320, h: 'hug', p: 24 },
  'type-scale': { layout: 'vertical', gap: 20, w: 'hug', h: 'hug', p: 24 },
  'spacing-scale': { layout: 'vertical', gap: 12, w: 'hug', h: 'hug', p: 24 },
};

// ── Mutable stores ──────────────────────────────────────────────────

const textStore = new Map<string, TokenProps>(
  Object.entries(DEFAULT_TEXT).map(([k, v]) => [k, { ...v }]),
);

const containerStore = new Map<string, TokenProps>(
  Object.entries(DEFAULT_CONTAINER).map(([k, v]) => [k, { ...v }]),
);

// ── Read API (used by render command) ───────────────────────────────

export function isTextToken(token: string): boolean {
  return textStore.has(token);
}

export function isContainerToken(token: string): boolean {
  return containerStore.has(token);
}

export function getTextStyle(token: string): TokenProps | undefined {
  const s = textStore.get(token);
  return s ? { ...s } : undefined;
}

export function getContainerStyle(token: string): TokenProps | undefined {
  const s = containerStore.get(token);
  return s ? { ...s } : undefined;
}

export function listTokens(): { text: string[]; container: string[] } {
  return { text: [...textStore.keys()], container: [...containerStore.keys()] };
}

/** Get all tokens with their values (for token ls). */
export function dumpTokens(filter?: 'text' | 'container'): Record<string, { type: string; props: TokenProps }> {
  const result: Record<string, { type: string; props: TokenProps }> = {};
  if (!filter || filter === 'text') {
    for (const [k, v] of textStore) result[k] = { type: 'text', props: { ...v } };
  }
  if (!filter || filter === 'container') {
    for (const [k, v] of containerStore) result[k] = { type: 'container', props: { ...v } };
  }
  return result;
}

// ── Write API (used by token command) ───────────────────────────────

/**
 * Set or create a token. Merges props with existing values.
 * Auto-detects type for existing tokens. For new tokens, uses explicit type
 * or infers from props (has size/weight/font → text, else container).
 */
export function setToken(
  name: string,
  props: TokenProps,
  explicitType?: 'text' | 'container',
): { type: 'text' | 'container'; created: boolean } {
  // Existing token — update in place
  if (textStore.has(name)) {
    textStore.set(name, { ...textStore.get(name)!, ...props });
    return { type: 'text', created: false };
  }
  if (containerStore.has(name)) {
    containerStore.set(name, { ...containerStore.get(name)!, ...props });
    return { type: 'container', created: false };
  }

  // New token — determine type
  const type = explicitType || inferTokenType(props);
  const store = type === 'text' ? textStore : containerStore;
  store.set(name, { ...props });
  return { type, created: true };
}

/** Remove a custom token. Cannot remove defaults. */
export function removeToken(name: string): boolean {
  if (name in DEFAULT_TEXT || name in DEFAULT_CONTAINER) return false;
  return textStore.delete(name) || containerStore.delete(name);
}

/** Reset all tokens to defaults, removing any custom tokens. */
export function resetTokens(): void {
  textStore.clear();
  for (const [k, v] of Object.entries(DEFAULT_TEXT)) textStore.set(k, { ...v });
  containerStore.clear();
  for (const [k, v] of Object.entries(DEFAULT_CONTAINER)) containerStore.set(k, { ...v });
}

// ── Helpers ─────────────────────────────────────────────────────────

const TEXT_HINT_PROPS = new Set(['size', 'weight', 'font', 'textCase', 'letterSpacing']);

function inferTokenType(props: TokenProps): 'text' | 'container' {
  for (const key of Object.keys(props)) {
    if (TEXT_HINT_PROPS.has(key)) return 'text';
  }
  return 'container';
}
