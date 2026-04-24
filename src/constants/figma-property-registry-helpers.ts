/**
 * @file figma-property-registry-helpers.ts
 * @description Pure-logic queries over PROPERTY_REGISTRY.
 *
 * Helpers read the Phase 1 schema additions (`writable`, `bindable`, `facet`)
 * and expose facet-based discovery. No Figma API access — registry is static.
 *
 * Facet resolution per entry:
 *   - `entry.facet` if set (e.g. `'variables'` on boundVariables/explicitVariableModes)
 *   - else `entry.role`
 *
 * Special facet names recognised by `getPropsForFacet` / `getFacetKeys`:
 *   - `'visual'`  → union of entries whose resolved facet is in VISUAL_FACETS
 *                   (byte-equivalent to the legacy VISUAL_ROLES filter)
 *   - `'all'`     → every entry, no filter
 *   - otherwise   → exact match against resolved facet
 */
import { PROPERTY_REGISTRY, type PropertyDef } from './figma-property-registry';

/** Facets that represent design-visible properties. Mirrors VISUAL_ROLES. */
const VISUAL_FACETS = new Set(['layout', 'fill', 'stroke', 'effect', 'appearance', 'typography']);

/** Resolved facet for an entry: explicit override wins over role. */
function resolveFacet(entry: PropertyDef): string {
  return entry.facet ?? entry.role;
}

/**
 * Returns the PropertyDef entries that belong to the named facet for a given node type.
 * Preserves registry declaration order. Returns `[]` for unknown node types or facets.
 */
export function getPropsForFacet(nodeType: string, facet: string): PropertyDef[] {
  const registry = PROPERTY_REGISTRY[nodeType];
  if (!registry) return [];

  if (facet === 'all') return registry.slice();

  if (facet === 'visual') {
    return registry.filter((entry) => VISUAL_FACETS.has(resolveFacet(entry)));
  }

  return registry.filter((entry) => resolveFacet(entry) === facet);
}

/** Keys-only convenience over `getPropsForFacet`. */
export function getFacetKeys(nodeType: string, facet: string): Set<string> {
  return new Set(getPropsForFacet(nodeType, facet).map((entry) => entry.key));
}

/** Keys where `entry.writable === true`. Empty set for unknown node types. */
export function getWritableKeys(nodeType: string): Set<string> {
  const registry = PROPERTY_REGISTRY[nodeType];
  if (!registry) return new Set();
  return new Set(registry.filter((entry) => entry.writable === true).map((entry) => entry.key));
}

/**
 * Keys whose `entry.bindable` matches `varType` (or any bindable when `varType` is undefined).
 * Empty set for unknown node types.
 */
export function getBindableKeys(
  nodeType: string,
  varType?: 'FLOAT' | 'BOOLEAN' | 'STRING' | 'COLOR',
): Set<string> {
  const registry = PROPERTY_REGISTRY[nodeType];
  if (!registry) return new Set();
  const match = varType === undefined
    ? (entry: PropertyDef) => entry.bindable !== undefined
    : (entry: PropertyDef) => entry.bindable === varType;
  return new Set(registry.filter(match).map((entry) => entry.key));
}

/** Single lookup by key. Returns `undefined` when either the node type or key is missing. */
export function getPropertyDef(nodeType: string, key: string): PropertyDef | undefined {
  const registry = PROPERTY_REGISTRY[nodeType];
  if (!registry) return undefined;
  return registry.find((entry) => entry.key === key);
}
