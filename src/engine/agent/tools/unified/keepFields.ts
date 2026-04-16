/**
 * Keep only the listed fields; skip fields that are null/undefined/empty array/empty object.
 * Shared helper for tools that present as a lean whitelist.
 */
export function keepFields(data: any, keepList: readonly string[]): any {
  const kept: any = {};
  for (const field of keepList) {
    const v = data[field];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    kept[field] = v;
  }
  return kept;
}
