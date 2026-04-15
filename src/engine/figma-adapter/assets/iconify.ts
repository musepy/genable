/**
 * @file iconify.ts
 * @description Iconify API service for fetching SVG icons
 *
 * [INPUT]:  Icon name in format "prefix:name" (e.g., "mdi:home")
 * [OUTPUT]: SVG string or null
 * [POS]:    UI Thread - called before rendering
 *
 * Performance:
 *   - Session-level SVG cache (avoids re-fetching the same icon)
 *   - prefetchIcons() for batch parallel fetching before execution
 */

const ICONIFY_API = 'https://api.iconify.design';

/**
 * Supported icon sets
 */
export const ICON_SETS = {
  mdi: 'Material Design Icons',
  lucide: 'Lucide Icons',
  heroicons: 'Heroicons',
  tabler: 'Tabler Icons',
  f7: 'Framework7 Icons (SF Symbols style)',
  hugeicons: 'Hugeicons',
  logos: 'Brand Logos (e.g., logos:google, logos:apple)',
  'heroicons-outline': 'Heroicons Outline',
  'heroicons-solid': 'Heroicons Solid',
} as const;

export type IconPrefix = keyof typeof ICON_SETS;

/**
 * Normalize icon prefix (LLM often outputs singular forms)
 */
const PREFIX_ALIASES: Record<string, string> = {
  logo: 'logos',
  heroicon: 'heroicons',
};

/**
 * Session-level SVG cache — persists across tool calls within one plugin session.
 * Key: normalized "prefix:name", Value: SVG string or null (cache negative results too).
 * Call clearIconCache() on session reset ("New Design").
 */
const svgCache = new Map<string, string | null>();

/** Clear the icon cache (call on session reset / "New Design") */
export function clearIconCache(): void {
  svgCache.clear();
}

/**
 * Normalize icon name for different icon libraries
 * - Converts underscores to dashes (LLM tends to output underscore format)
 * - Maps common Material-style names to Lucide equivalents
 */
function normalizeIconName(prefix: string, name: any): string {
  // Safe casting to string before manipulation
  const nameStr = String(name || '');
  // Convert underscores to dashes (universal normalization)
  let normalized = nameStr.replace(/_/g, '-').toLowerCase().trim();

  // Lucide-specific mappings (Material → Lucide semantic equivalents)
  if (prefix === 'lucide') {
    const LUCIDE_MAPPINGS: Record<string, string> = {
      // Navigation arrows
      'arrow-forward': 'arrow-right',
      'arrow-back': 'arrow-left',
      'chevron-forward': 'chevron-right',
      'chevron-back': 'chevron-left',

      // Menu icons
      'more-vert': 'more-vertical',
      'more-horiz': 'more-horizontal',

      // Star icons (LLM often uses Material naming)
      'stars-filled': 'star',
      'star-filled': 'star',
      'stars': 'star',

      // Action icons
      'add-circle': 'plus-circle',
      'add': 'plus',
      'remove': 'minus',
      'remove-circle': 'minus-circle',

      // Common UI icons
      'close': 'x',
      'check-circle': 'check-circle-2',
      'delete': 'trash-2',
      'edit': 'pencil',
      'settings': 'settings',
      'search': 'search',
      'menu': 'menu',
    };
    normalized = LUCIDE_MAPPINGS[normalized] || normalized;
  }

  return normalized;
}

/**
 * Resolve an icon name to its normalized cache key and URL.
 * Returns null if the format is invalid.
 */
function resolveIcon(iconName: string): { cacheKey: string; url: string } | null {
  const [rawPrefix, name] = iconName.split(':');
  if (!rawPrefix || !name) return null;

  const prefix = PREFIX_ALIASES[rawPrefix] || rawPrefix;
  const normalizedName = normalizeIconName(prefix, name);
  return {
    cacheKey: `${prefix}:${normalizedName}`,
    url: `${ICONIFY_API}/${prefix}/${normalizedName}.svg`,
  };
}

/**
 * Fetch SVG from Iconify API (with session cache).
 * @param iconName Format: "prefix:name" (e.g., "mdi:home", "lucide:settings")
 * @returns SVG string or null if not found
 */
export async function fetchIconSvg(iconName: string): Promise<string | null> {
  const resolved = resolveIcon(iconName);
  if (!resolved) {
    console.warn(`[Iconify] Invalid icon format: ${iconName}. Use "prefix:name" format.`);
    return null;
  }

  const { cacheKey, url } = resolved;

  // Cache hit — return immediately (includes cached nulls for 404s)
  if (svgCache.has(cacheKey)) {
    const cached = svgCache.get(cacheKey)!;
    if (cached) console.log(`[Iconify] Cache hit: ${iconName} (${cached.length} bytes)`);
    else console.log(`[Iconify] Cache hit (not found): ${iconName}`);
    return cached;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Iconify] Icon not found: ${iconName} (${response.status})`);
      svgCache.set(cacheKey, null);
      return null;
    }
    const svg = await response.text();
    console.log(`[Iconify] Fetched ${iconName} (${svg.length} bytes)`);
    svgCache.set(cacheKey, svg);
    return svg;
  } catch (e) {
    console.error(`[Iconify] Failed to fetch ${iconName}:`, e);
    svgCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Prefetch multiple icons in parallel.
 * Call before executing a batch of actions that contain icon creates.
 * Results are stored in the session cache for instant retrieval by fetchIconSvg().
 *
 * @param iconNames Array of icon names in "prefix:name" format
 * @returns Map of iconName → SVG string (or null if not found)
 */
export async function prefetchIcons(iconNames: string[]): Promise<Map<string, string | null>> {
  // Deduplicate and filter out already-cached icons
  const toFetch: Array<{ original: string; cacheKey: string; url: string }> = [];
  const seen = new Set<string>();

  for (const iconName of iconNames) {
    const resolved = resolveIcon(iconName);
    if (!resolved) continue;
    if (seen.has(resolved.cacheKey) || svgCache.has(resolved.cacheKey)) continue;
    seen.add(resolved.cacheKey);
    toFetch.push({ original: iconName, ...resolved });
  }

  if (toFetch.length === 0) return svgCache;

  console.log(`[Iconify] Prefetching ${toFetch.length} icons in parallel...`);
  const start = Date.now();

  const results = await Promise.allSettled(
    toFetch.map(async ({ original, cacheKey, url }) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[Iconify] Icon not found: ${original} (${response.status})`);
          svgCache.set(cacheKey, null);
          return;
        }
        const svg = await response.text();
        svgCache.set(cacheKey, svg);
      } catch (e) {
        console.error(`[Iconify] Failed to fetch ${original}:`, e);
        svgCache.set(cacheKey, null);
      }
    }),
  );

  const elapsed = Date.now() - start;
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[Iconify] Prefetch complete: ${succeeded}/${toFetch.length} in ${elapsed}ms`);

  return svgCache;
}

/**
 * Get icon set prefix suggestions for LLM context
 */
export function getIconSetSuggestions(): string {
  return Object.entries(ICON_SETS)
    .map(([prefix, name]) => `${prefix}: ${name}`)
    .join('\n');
}

/**
 * Validate icon name format
 */
export function isValidIconName(iconName: string): boolean {
  const parts = iconName.split(':');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}
