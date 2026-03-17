/**
 * @file validator.ts
 * @description Validates Figma Actions prior to execution to ensure safety and structural constraints.
 */

import { FigmaAction } from './types';

export class ActionValidator {
  /** 
   * Dangerous properties that cannot be modified directly via updateProps 
   * or via create* props (if they conflict with Figma readonly properties) 
   */
  private static readonly DENIED_PROPS = new Set([
    'id', 
    'parent', 
    'removed', 
    'type', 
    'children',
    'masterComponent',
    'mainComponent'
  ]);

  /**
   * Validate a single action's properties and intentions before execution.
   * Prevents standard Figma plugin API exceptions (like layout panics).
   * 
   * @param action The action to validate
   * @param targetNode The existing node if this is an update action
   * @param parentNode The resolved parent node, if applicable for the action
   */
  static validate(
    action: FigmaAction, 
    targetNode?: SceneNode | null, 
    parentNode?: SceneNode | null
  ): { valid: boolean; error?: string } {
    
    // 1. Basic property deny-list validation
    if ('props' in action && action.props) {
      for (const key of Object.keys(action.props)) {
        if (this.DENIED_PROPS.has(key)) {
          return { valid: false, error: `Cannot modify denied property: '${key}' in action '${action.action}'` };
        }
      }
    }

    const props = ('props' in action ? action.props : {}) || {};

    // 2. TEXT node layout constraints
    if (action.action === 'createText' || (action.action === 'updateProps' && targetNode?.type === 'TEXT')) {
      const layoutMode = props.layoutMode;
      if (layoutMode && layoutMode !== 'NONE') {
        return { valid: false, error: `TEXT nodes do not support layoutMode '${layoutMode}'. Use layoutMode='NONE'.` };
      }
    }

    // itemSpacing and other auto-layout prerequisites are now validated
    // and auto-fixed in propertyDependencies.ts (single source of truth).

    return { valid: true };
  }
}
