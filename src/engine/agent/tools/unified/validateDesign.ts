import { ToolDefinition, ToolExecutor } from '../types';
import { validateLayoutConstraints } from '../../../validation/constraintValidator';
import { NodeLayer } from '../../../../schema/layerSchema';

/**
 * Unified validation tool — simplified version of validateLayout.
 */
export const validateDesignDefinition: ToolDefinition = {
  name: 'validate_design',
  category: 'validate',
  dependencies: ['build_design', 'patch_node'],
  description: `Validate a node's layout and design constraints. Checks for sizing conflicts, auto-layout issues, and other structural problems.

Use this after creating or modifying nodes to catch issues early.`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Figma node ID to validate. Will validate the node and its children recursively.'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'parallel',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.'
  }
};

// ── Executor: validateLayout (migrated from validationTools.ts) ──

export const validateLayoutExecutor: ToolExecutor<{
  node: NodeLayer;
  checkTypes?: ('sizing' | 'dependency' | 'autoLayout' | 'semantic')[];
}> = async ({ node, checkTypes }) => {
  try {
    const result = validateLayoutConstraints(node);

    return {
      success: true,
      data: {
        valid: !result.hasErrors,
        errors: result.warnings.filter(w => w.severity === 'error'),
        warnings: result.warnings.filter(w => w.severity !== 'error'),
        summary: result.summary
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message }
    };
  }
};
