import { PropertyHandler, Warning } from './types';

/**
 * Fallback handler — direct property assignment with readonly/setter checks.
 * This MUST be the last handler in the registry (catches everything).
 */
export const defaultHandler: PropertyHandler = {
  name: 'default',

  match(key, _value, node) {
    return key in node;
  },

  async apply(node, key, value): Promise<Warning[]> {
    if (!canAssignProperty(node, key)) {
      return [{ code: 'SKIPPED_READONLY', severity: 'warning', message: `Skipped readonly property '${key}'` }];
    }

    try {
      (node as any)[key] = value;
      return [];
    } catch (e: any) {
      const message = e?.message || 'Unknown property set error';
      if (String(message).includes('no setter for property')) {
        return [{ code: 'MISSING_SETTER', severity: 'warning', message: `Skipped property '${key}' due to missing setter` }];
      }
      throw e;
    }
  },
};

/** Walk the prototype chain to detect getter-only/readonly properties. */
function canAssignProperty(node: SceneNode, key: string): boolean {
  let target: any = node;
  while (target) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) {
      return descriptor.writable === true || typeof descriptor.set === 'function';
    }
    target = Object.getPrototypeOf(target);
  }
  return true;
}
