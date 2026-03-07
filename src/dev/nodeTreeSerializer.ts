/**
 * @file nodeTreeSerializer.ts
 * @description Serializes Figma node tree to JSON for automation loop verification.
 *
 * Unlike NodeSerializer/XmlSerializer (which prune/map for LLM consumption),
 * this captures RAW Figma API properties with computed layout for Claude Code
 * to analyze build results programmatically.
 *
 * Runs in Figma main thread where `figma.*` API is available.
 */

// ── Types ──

export interface SerializedNode {
  id: string;
  type: string;
  name: string;
  visible: boolean;

  // Local transform
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;

  // Computed absolute bounds (from absoluteBoundingBox)
  absoluteBounds?: { x: number; y: number; width: number; height: number };

  // Opacity
  opacity?: number;

  // Auto-layout (frames only)
  layoutMode?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  layoutPositioning?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  layoutWrap?: string;
  clipsContent?: boolean;

  // Size constraints
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;

  // Fills & strokes (raw Figma Paint objects)
  fills?: any[];
  strokes?: any[];
  strokeWeight?: number;
  strokeAlign?: string;
  cornerRadius?: number | symbol; // symbol = figma.mixed

  // Effects (raw Figma Effect objects)
  effects?: any[];

  // Text properties
  characters?: string;
  fontSize?: number | symbol;
  fontName?: { family: string; style: string } | symbol;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textAutoResize?: string;
  lineHeight?: any;
  letterSpacing?: any;
  textCase?: string | symbol;
  textDecoration?: string | symbol;
  textTruncation?: string;
  maxLines?: number | null;

  // Constraints (for absolute positioning)
  constraints?: { horizontal: string; vertical: string };

  // Children
  children?: SerializedNode[];
}

export interface SerializeOptions {
  /** Max recursion depth. Default: Infinity */
  maxDepth?: number;
  /** Include invisible nodes. Default: false */
  includeHidden?: boolean;
  /** Include computed absolute bounds. Default: true */
  includeAbsoluteBounds?: boolean;
}

// ── Helpers ──

/** Safely read a property, returning undefined if it doesn't exist on the node. */
function safeRead<T>(node: SceneNode, key: string): T | undefined {
  try {
    return (node as any)[key];
  } catch {
    return undefined;
  }
}

/** Check if a value is non-default and worth including. */
function isNonDefault(value: any, defaultValue: any): boolean {
  if (value === undefined || value === null) return false;
  if (value === defaultValue) return false;
  if (typeof value === 'number' && typeof defaultValue === 'number') return value !== defaultValue;
  return true;
}

// ── Properties to extract per node type ──

const FRAME_PROPS = [
  'layoutMode', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'primaryAxisAlignItems', 'counterAxisAlignItems',
  'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'clipsContent', 'layoutWrap',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
] as const;

const CHILD_LAYOUT_PROPS = [
  'layoutPositioning', 'layoutGrow', 'layoutAlign',
] as const;

const STYLE_PROPS = [
  'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'cornerRadius', 'effects',
] as const;

const TEXT_PROPS = [
  'characters', 'fontSize', 'fontName',
  'textAlignHorizontal', 'textAlignVertical', 'textAutoResize',
  'lineHeight', 'letterSpacing', 'textCase', 'textDecoration',
  'textTruncation', 'maxLines',
] as const;

// ── Core serializer ──

function serializeNode(
  node: SceneNode,
  options: Required<SerializeOptions>,
  depth: number,
): SerializedNode | null {
  if (!options.includeHidden && !node.visible) return null;

  const result: SerializedNode = {
    id: node.id,
    type: node.type,
    name: node.name,
    visible: node.visible,
    x: Math.round(node.x * 100) / 100,
    y: Math.round(node.y * 100) / 100,
    width: Math.round(node.width * 100) / 100,
    height: Math.round(node.height * 100) / 100,
  };

  // Rotation (skip 0)
  const rotation = safeRead<number>(node, 'rotation');
  if (rotation && rotation !== 0) result.rotation = Math.round(rotation * 100) / 100;

  // Opacity (skip 1)
  const opacity = safeRead<number>(node, 'opacity');
  if (isNonDefault(opacity, 1)) result.opacity = opacity;

  // Absolute bounds (fallback chain matches main.ts pattern)
  if (options.includeAbsoluteBounds) {
    const abb = (node as any).absoluteBoundingBox || (node as any).absoluteRenderBounds;
    if (abb) {
      result.absoluteBounds = {
        x: Math.round(abb.x * 100) / 100,
        y: Math.round(abb.y * 100) / 100,
        width: Math.round(abb.width * 100) / 100,
        height: Math.round(abb.height * 100) / 100,
      };
    }
  }

  // Constraints
  const constraints = safeRead<Constraints>(node, 'constraints');
  if (constraints && (constraints.horizontal !== 'MIN' || constraints.vertical !== 'MIN')) {
    result.constraints = constraints;
  }

  // Frame/auto-layout props
  const isFrameLike = node.type === 'FRAME' || node.type === 'COMPONENT' ||
    node.type === 'COMPONENT_SET' || node.type === 'INSTANCE' || node.type === 'SECTION';

  if (isFrameLike) {
    for (const key of FRAME_PROPS) {
      const value = safeRead(node, key);
      if (value !== undefined && value !== null) {
        (result as any)[key] = value;
      }
    }
  }

  // Child layout props (any node inside auto-layout parent)
  for (const key of CHILD_LAYOUT_PROPS) {
    const value = safeRead(node, key);
    if (value !== undefined && value !== null && value !== 'AUTO' && value !== 'INHERIT' && value !== 0) {
      (result as any)[key] = value;
    }
  }

  // Style props (fills, strokes, cornerRadius, effects)
  for (const key of STYLE_PROPS) {
    const value = safeRead(node, key);
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    // Skip strokeWeight=0, cornerRadius=0
    if (typeof value === 'number' && value === 0) continue;
    (result as any)[key] = value;
  }

  // Text props
  if (node.type === 'TEXT') {
    for (const key of TEXT_PROPS) {
      const value = safeRead(node, key);
      if (value !== undefined && value !== null) {
        (result as any)[key] = value;
      }
    }
  }

  // Children
  if ('children' in node && depth < options.maxDepth) {
    const children: SerializedNode[] = [];
    for (const child of (node as FrameNode).children) {
      const serialized = serializeNode(child, options, depth + 1);
      if (serialized) children.push(serialized);
    }
    if (children.length > 0) result.children = children;
  }

  return result;
}

// ── Public API ──

/**
 * Serialize the current page's children to a JSON-ready array.
 * Call from Figma main thread.
 */
export function serializeCurrentPage(options?: SerializeOptions): {
  pageName: string;
  pageId: string;
  nodes: SerializedNode[];
} {
  const opts: Required<SerializeOptions> = {
    maxDepth: options?.maxDepth ?? Infinity,
    includeHidden: options?.includeHidden ?? false,
    includeAbsoluteBounds: options?.includeAbsoluteBounds ?? true,
  };

  const page = figma.currentPage;
  const nodes: SerializedNode[] = [];

  for (const child of page.children) {
    const serialized = serializeNode(child, opts, 0);
    if (serialized) nodes.push(serialized);
  }

  return {
    pageName: page.name,
    pageId: page.id,
    nodes,
  };
}

/**
 * Serialize a specific node and its subtree.
 * Useful for exporting just the result of a create/edit operation.
 */
export function serializeNode_public(node: SceneNode, options?: SerializeOptions): SerializedNode | null {
  const opts: Required<SerializeOptions> = {
    maxDepth: options?.maxDepth ?? Infinity,
    includeHidden: options?.includeHidden ?? false,
    includeAbsoluteBounds: options?.includeAbsoluteBounds ?? true,
  };

  return serializeNode(node, opts, 0);
}

/**
 * Serialize to JSON string, ready for POST to dev bridge server.
 */
export function serializeToJson(options?: SerializeOptions): string {
  return JSON.stringify(serializeCurrentPage(options), null, 2);
}
