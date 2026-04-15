export function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any> | null | undefined): T {
  // 1. Guard against non-object target or missing source
  if (!target || typeof target !== 'object' || Array.isArray(target)) return (source as T) || target;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  
  const result: any = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      // 2. Recursively merge objects
      if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue) &&
          targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
        result[key] = deepMerge(targetValue, sourceValue);
      } else {
        // 3. Replacements for everything else
        result[key] = sourceValue;
      }
    }
  }

  return result as T;
}
