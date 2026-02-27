/**
 * @file validationTools.ts
 * @description Validation-related tools for the Agent.
 */

import { validateLayoutConstraints } from '../../validation/constraintValidator';
import { NodeLayer } from '../../../schema/layerSchema';
import { ToolDefinition, ToolExecutor } from './types';

// ==========================================
// 1. validateLayout Tool
// ==========================================

export const validateLayoutDefinition: ToolDefinition = {
  name: 'validateLayout',
  category: 'validate',
  dependencies: ['createNode', 'setNodeLayout'],
  description: 'Apply formal Figma layout constraints (Auto Layout rules, sizing mutual exclusion) to a node tree and return detailed lint feedback.',
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'object',
        description: 'The NodeLayer tree (DSL) to validate.'
      },
      checkTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['sizing', 'dependency', 'autoLayout', 'semantic'],
          description: 'Type of check to perform'
        },
        description: 'Specific validation checks to run.'
      }
    },
    required: ['node']
  },
  executionStrategy: 'parallel'
};

export const validateLayout: ToolExecutor<{
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
