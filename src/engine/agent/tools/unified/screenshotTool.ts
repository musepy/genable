/**
 * @file screenshotTool.ts
 * @description Standalone `get_screenshot` tool — capture a PNG of a node.
 *
 * Split out of `inspect` so visual verification is a first-class affordance.
 * Use after style changes to visually verify rather than reading properties back.
 */

import type { ToolDefinition } from '../types';

export const getScreenshotDefinition: ToolDefinition = {
  name: 'get_screenshot',
  executionStrategy: 'sequential',
  mutates: false,
  description: `Capture a PNG screenshot of a node.

Use after style changes to visually verify the result instead of reading properties back.
Returns base64 PNG data embedded in the response.

Parameters:
  node: Node ID from jsx/inspect results (e.g. "100:5"). Page root ("/") is not supported.
  scale: Export scale 0.5–2 (default 1). Higher = larger file.
  padding: Reserved for future use — currently ignored.

Examples:
  get_screenshot({node: "100:5"})              → PNG at 1x
  get_screenshot({node: "100:5", scale: 2})    → PNG at 2x (sharper)`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ID (e.g. "100:5"). Page root "/" is not supported.' },
      scale: { type: 'number', description: 'Export scale 0.5–2 (default 1).' },
      padding: { type: 'number', description: 'Reserved for future use.' },
    },
    required: ['node'],
  },
};
