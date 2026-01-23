/**
 * @file iconify.ts
 * @description Iconify API service for fetching SVG icons
 * 
 * [INPUT]:  Icon name in format "prefix:name" (e.g., "mdi:home")
 * [OUTPUT]: SVG string or null
 * [POS]:    UI Thread - called before rendering
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
  'heroicons-outline': 'Heroicons Outline',
  'heroicons-solid': 'Heroicons Solid',
} as const;

export type IconPrefix = keyof typeof ICON_SETS;

/**
 * Normalize icon name for different icon libraries
 * - Converts underscores to dashes (LLM tends to output underscore format)
 * - Maps common Material-style names to Lucide equivalents
 */
function normalizeIconName(prefix: string, name: string): string {
  // Convert underscores to dashes (universal normalization)
  let normalized = name.replace(/_/g, '-');
  
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
 * Fetch SVG from Iconify API
 * @param iconName Format: "prefix:name" (e.g., "mdi:home", "lucide:settings")
 * @returns SVG string or null if not found
 */
export async function fetchIconSvg(iconName: string): Promise<string | null> {
  // Parse icon name
  const [prefix, name] = iconName.split(':');
  if (!prefix || !name) {
    console.warn(`[Iconify] Invalid icon format: ${iconName}. Use "prefix:name" format.`);
    return null;
  }

  // Apply normalization for LLM output compatibility
  const normalizedName = normalizeIconName(prefix, name);
  if (normalizedName !== name) {
    console.log(`[Iconify] Normalized: ${prefix}:${name} → ${prefix}:${normalizedName}`);
  }

  const url = `${ICONIFY_API}/${prefix}/${normalizedName}.svg`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Iconify] Icon not found: ${iconName} (${response.status})`);
      return null;
    }
    const svg = await response.text();
    console.log(`[Iconify] Fetched ${iconName} (${svg.length} bytes)`);
    return svg;
  } catch (e) {
    console.error(`[Iconify] Failed to fetch ${iconName}:`, e);
    return null;
  }
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
