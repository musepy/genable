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

    // 3. FILL sizing constraints requirements (Parent must be Auto Layout)
    const hasFillHorizontal = props.layoutSizingHorizontal === 'FILL';
    const hasFillVertical = props.layoutSizingVertical === 'FILL';
    
    if (hasFillHorizontal || hasFillVertical) {
      let resolvedParent = parentNode;
      if (action.action === 'updateProps' && targetNode) {
        resolvedParent = targetNode.parent as SceneNode;
      }
      
      if (resolvedParent && (!('layoutMode' in resolvedParent) || resolvedParent.layoutMode === 'NONE')) {
        return { valid: false, error: `'FILL' sizing requires a parent with Auto Layout.` };
      } 
      if (!resolvedParent && action.action !== 'delete' && action.action !== 'move') {
        // Only layout elements inside a layout frame can be FILL
        return { valid: false, error: `'FILL' sizing requires a parent with Auto Layout.` };
      }
    }

    // 4. itemSpacing constraints (requires layoutMode)
    if (props.itemSpacing !== undefined) {
      const targetLayoutMode = action.action === 'updateProps' && targetNode && 'layoutMode' in targetNode 
        ? targetNode.layoutMode 
        : undefined;
      const intendedLayoutMode = props.layoutMode !== undefined ? props.layoutMode : targetLayoutMode;

      if (intendedLayoutMode === 'NONE' || intendedLayoutMode === undefined) { 
        if (action.action === 'createFrame' && props.layoutMode === undefined) {
          return { valid: false, error: `Cannot set 'itemSpacing' on a node without 'layoutMode'.`};
        }
        if (intendedLayoutMode === 'NONE') {
          return { valid: false, error: `Cannot set 'itemSpacing' on a node without 'layoutMode'.`};
        }
      }
    }

    return { valid: true };
  }
}
