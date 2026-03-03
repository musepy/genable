import { ToolDefinition } from '../types';

/**
 * capture_screenshot — Export a node as an image for visual verification.
 * Runs in Main thread via IPC (exportAsync). The base64 image is returned
 * in `data.__image` and extracted by ToolDispatcher into an inlineData part.
 */
export const captureScreenshotDefinition: ToolDefinition = {
  name: 'capture_screenshot',
  category: 'validate',
  display: { displayName: 'Capture Screenshot', group: 'inspect' },
  dependencies: ['build_design', 'patch_node'],
  description: `Capture a screenshot of a Figma node for visual verification.

Returns the rendered image so you can visually inspect the design. Use this after building or patching nodes to verify the visual result matches your intent.`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Figma node ID to capture.'
      },
      scale: {
        type: 'number',
        description: 'Export scale factor (default 1, max 2). Use 1 for quick checks, 2 for detail.',
        minimum: 0.5,
        maximum: 2,
      },
      format: {
        type: 'string',
        description: 'Image format: "jpg" (smaller, faster) or "png" (lossless).',
        enum: ['jpg', 'png'],
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'parallel',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.',
    'INVALID_NODE_TYPE': 'The nodeId refers to a non-scene node (e.g. Page or Document).',
    'EXPORT_FAILED': 'Node export failed (invisible node, zero size, or unsupported type).',
  }
};
