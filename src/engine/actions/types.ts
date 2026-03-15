/**
 * @file types.ts
 * @description Typed Action definitions for the new Figma translation layer.
 * 
 * Replaces the heavily abstracted hierarchical DSL with a sequence of atomic
 * actions that closely map to raw Figma API operations.
 */

export type FigmaAction =
  | CreateFrameAction
  | CreateTextAction
  | CreateShapeAction
  | CreateIconAction
  | CreateComponentAction
  | CreateComponentSetAction
  | CreateInstanceAction
  | SwapInstanceAction
  | CloneNodeAction
  | UpdatePropsAction
  | DeleteNodeAction
  | MoveNodeAction;

export interface ActionBase {
  /** Unique action identifier / type */
  action: string;
  
  /** 
   * Temporary ID for tracking within a batch. 
   * Other actions in the same batch can reference this via `parentId` or `nodeId` or `dependsOn`.
   */
  tempId?: string;
  
  /** 
   * Reference to parent node (real Figma node ID or a predecessor's tempId).
   * If omitted, defaults to the current page root or container execution context.
   */
  parentId?: string;
  
  /** Array of tempId or nodeId that must succeed before this action can run. */
  dependsOn?: string[];
  
  /** Override the batch-level onError strategy for this specific action. */
  onError?: 'skip-dependents' | 'abort';

  /**
   * Opt-in upsert behavior for create actions.
   * Default is false to avoid accidental sibling overwrite when multiple nodes
   * share the same semantic name (e.g. repeated "Link" text items).
   */
  upsertExisting?: boolean;
}

export interface CreateFrameAction extends ActionBase {
  action: 'createFrame';
  props: {
    name?: string;
    layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
    itemSpacing?: number;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    /** Convenience prop: Executor expands this to top/right/bottom/left */
    padding?: number;
    layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
    layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
    width?: number;
    height?: number;
    /** Hex strings; Executor converts to `SolidPaint[]` */
    fills?: string[];
    strokes?: string[];
    strokeWeight?: number;
    cornerRadius?: number;
    opacity?: number;
    effects?: Effect[];
    [key: string]: any; // Allow other properties for flexibility
  };
}

export interface CreateTextAction extends ActionBase {
  action: 'createText';
  props: {
    characters: string;
    fontSize?: number;
    /** Convenience prop: Executor merges with fontWeight -> { family, style } and handles fontLoading */
    fontFamily?: string;
    /** Convenience prop */
    fontWeight?: string;
    fills?: string[];
    textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
    lineHeight?: number | { value: number; unit: 'PIXELS' | 'PERCENT' };
    letterSpacing?: number | { value: number; unit: 'PIXELS' | 'PERCENT' };
    [key: string]: any;
  };
}

export interface CreateShapeAction extends ActionBase {
  action: 'createShape';
  shapeType: 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'VECTOR';
  props: {
    name?: string;
    width?: number;
    height?: number;
    fills?: string[];
    strokes?: string[];
    strokeWeight?: number;
    cornerRadius?: number; // Valid for RECTANGLE
    opacity?: number;
    [key: string]: any;
  };
}

export interface CreateIconAction extends ActionBase {
  action: 'createIcon';
  props: {
    name?: string;
    iconName?: string;
    svgData?: string;
    width?: number;
    height?: number;
    fills?: string[];
    [key: string]: any;
  };
}

export interface CreateComponentAction extends ActionBase {
  action: 'createComponent';
  props: {
    name?: string;
    [key: string]: any;
  };
}

export interface CreateComponentSetAction extends ActionBase {
  action: 'createComponentSet';
  /** tempIds or real IDs of component children to combine */
  componentIds: string[];
  props: {
    name?: string;
    [key: string]: any;
  };
}

export interface CreateInstanceAction extends ActionBase {
  action: 'createInstance';
  source: {
    componentKey?: string;
    nodeId?: string;
    /** Variant selector string (e.g. 'Size=Large') for ComponentSet targets */
    variant?: string;
  };
  props?: {
    name?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    [key: string]: any;
  };
  /** Child name → props to override on the instance. Phase 1: text overrides only. */
  overrides?: Record<string, Record<string, any>>;
}

export interface SwapInstanceAction extends ActionBase {
  action: 'swapInstance';
  nodeId: string; // The instance node ID or tempId to swap
  newComponentKey?: string;
  newComponentNodeId?: string;
}

export interface CloneNodeAction extends ActionBase {
  action: 'cloneNode';
  /** Source node to clone: tempId, componentRegistry key, or real Figma ID */
  sourceId: string;
  /** Props to override on the cloned root node */
  props?: Record<string, any>;
  /** Child name → props to override on children of the clone (e.g. text fill) */
  overrides?: Record<string, Record<string, any>>;
}

export interface UpdatePropsAction extends ActionBase {
  action: 'updateProps';
  nodeId: string; // Real figma ID or tempId
  props: Record<string, any>; // Arbitrary props. ActionValidator will filter out denied keys.
}

export interface DeleteNodeAction extends ActionBase {
  action: 'delete';
  nodeId: string; // Real figma ID or tempId
}

export interface MoveNodeAction extends ActionBase {
  action: 'move';
  nodeId: string;   // Real figma ID or tempId
  parentId: string; // New parent ID or tempId
  index?: number;   // Position in parent's children array
}

// ==========================================
// Execution Results
// ==========================================

export interface ActionResult {
  action: FigmaAction;
  success: boolean;
  nodeId?: string;
  error?: string;
  skipped?: boolean;
  warnings?: Array<{ code: string; severity: string; message: string; [k: string]: any }>;
  errorContext?: import('./errorTypes').ActionErrorContext;
  /** Per-property diff for updateProps — shows what changed vs what was already at target. */
  diffs?: Array<{ key: string; changed: boolean; before?: any; after?: any }>;
}

export interface ExecutionResult {
  success: boolean;
  results: ActionResult[];
  idMap: Record<string, string>;
  rollback: {
    attempted: number;
    removed: number;
    failed: Array<{ opId: string; nodeId: string; reason: string }>;
  };
}
