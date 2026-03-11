/**
 * @file executor.ts
 * @description The ActionExecutor processes a sequential list of Typed Actions,
 * applying them directly to the Figma document. It supports transactions, rollbacks,
 * and dependency validation.
 */

import { FigmaAction, ExecutionResult, ActionResult } from './types';
import { ActionValidator } from './validator';
// We need to import the fontLoader utility
import { fontBus } from '../figma-adapter/resources/FontBus'; // Assuming this exists based on progress.md
import { fetchIconSvg } from '../figma-adapter/assets/iconify';
import { parseActionError } from './errorParser';
import { ActionErrorSubCategory } from './errorTypes';
import { normalizeSizing, type SizingMode } from '../utils/LayoutValidator';
import { lowerPaints, lowerEffects, lowerUnitValue } from '../figma/figma-lowering';

/**
 * Module-level component registry — maps component symbols to real Figma node IDs.
 * Persists across ActionExecutor instances and execute() calls so that a component
 * created in one tool call can be instantiated in a later tool call.
 * Call ActionExecutor.clearComponentRegistry() on session reset ("New Design").
 */
const componentRegistry = new Map<string, string>();

export class ActionExecutor {
  private tempIdMap = new Map<string, string>(); // tempId → realFigmaId
  private opStatus = new Map<string, { success: boolean; error?: string }>();
  private rollbackStack: Array<{ tempId: string; nodeId: string }> = [];

  constructor(private readonly options: { onError?: 'skip-dependents' | 'abort' } = {}) {}

  /** Clear the persistent component registry (call on session reset / "New Design") */
  static clearComponentRegistry() {
    componentRegistry.clear();
  }

  /**
   * Main execution entry point. 
   * Topologically sorts actions based on dependsOn, then executes.
   */
  async execute(actions: FigmaAction[]): Promise<ExecutionResult> {
    this.tempIdMap.clear();
    this.opStatus.clear();
    this.rollbackStack = [];
    
    const results: ActionResult[] = [];
    const globalOnError = this.options.onError || 'skip-dependents';
    let aborted = false;

    // 1. Collect all tempIds within this batch
    const currentBatchTempIds = new Set<string>();
    for (const action of actions) {
      if (action.tempId) currentBatchTempIds.add(action.tempId);
    }

    // 2. Sort actions topologically based on dependsOn to ensure dependencies run first
    const sortedActions = this.topologicalSort(actions);

    // 2. Execute sequentially
    for (const action of sortedActions) {
      if (aborted) {
         results.push({ action, success: false, error: 'Aborted due to prior failure', skipped: true });
         continue;
      }

      // Check dependencies
      if (action.dependsOn && action.dependsOn.length > 0) {
        let missingDep: string | undefined;
        for (const dep of action.dependsOn) {
          if (currentBatchTempIds.has(dep)) {
            const status = this.opStatus.get(dep);
            if (!status || !status.success) {
              missingDep = dep;
              break;
            }
          } else {
            // It might be a real pre-existing Figma node ID. Validate it.
            try {
              const realNode = await figma.getNodeByIdAsync(dep);
              if (!realNode) {
                missingDep = dep;
                break;
              }
            } catch (e) {
              missingDep = dep;
              break;
            }
          }
        }

        if (missingDep) {
          const actionOnError = action.onError || globalOnError;
          results.push({ action, success: false, error: `Dependency '${missingDep}' failed or was not executed.`, skipped: actionOnError === 'skip-dependents' });
          this.opStatus.set(action.tempId || action.action, { success: false });
          if (actionOnError === 'abort') {
            aborted = true;
          }
          continue;
        }
      }

      // Execute action
      let result = await this.executeOne(action);
      let retryCount = 0;
      let retryTried = false;
      let subCategory = ActionErrorSubCategory.UNKNOWN;
      const retryWarnings: Array<{ code: string; severity: 'warning'; message: string }> = [];

      while (!result.success && retryCount < 2) {
        const rawError = result.error || 'Unknown error';
        subCategory = parseActionError(rawError);
        
        if (subCategory !== ActionErrorSubCategory.UNKNOWN && action.action !== 'delete') {
          retryTried = true;
          retryCount++;
          console.warn(`[ActionExecutor] Auto-fixing and retrying action ${action.action} (attempt ${retryCount}) due to ${subCategory}`);
          
          const props = (action as any).props;
          if (props) {
            if (subCategory === ActionErrorSubCategory.NODE_TYPE_CONSTRAINT) {
              // Cannot auto-fix node type mismatch — break to avoid infinite retry
              break;
            } else if (subCategory === ActionErrorSubCategory.FONT_UNLOADED) {
              props.fontFamily = 'Inter';
              props.fontWeight = 'Regular';
            } else if (subCategory === ActionErrorSubCategory.PAINT_INVALID) {
              delete props.fills;
              delete props.strokes;
            } else if (subCategory === ActionErrorSubCategory.EFFECT_INVALID) {
              delete props.effects;
            } else if (subCategory === ActionErrorSubCategory.PROPERTY_INVALID) {
              // Remove NaN/undefined values that commonly trigger this
              for (const [k, v] of Object.entries(props)) {
                if (v === undefined || (typeof v === 'number' && isNaN(v))) {
                  delete props[k];
                }
              }
            }
          }
          result = await this.executeOne(action);
        } else {
          break; // Unrecoverable or unknown error
        }
      }

      if (retryWarnings.length > 0) {
        result.warnings = [...(result.warnings || []), ...retryWarnings];
      }

      if (!result.success) {
        // Attach extra context for logging/reporting
        (result as ActionResult).errorContext = {
          subCategory: subCategory !== ActionErrorSubCategory.UNKNOWN ? subCategory : parseActionError(result.error || ''),
          rawMessage: result.error || 'Unknown error',
          failedNodeId: (action as any).nodeId || action.tempId || action.action,
          retryTried,
          canRetryLocally: false
        };
      }

      results.push({ action, ...result });

      if (action.tempId) {
         this.opStatus.set(action.tempId, { success: result.success, error: result.error });
         if (result.success && result.nodeId) {
            this.tempIdMap.set(action.tempId, result.nodeId);
            if (action.action !== 'delete') {
              this.rollbackStack.push({ tempId: action.tempId, nodeId: result.nodeId });
            }
         }
      }

      // Handle failure policy
      if (!result.success) {
        const actionOnError = action.onError || globalOnError;
        if (actionOnError === 'abort') {
          aborted = true;
        }
      }
    }

    // 4. Rollback on failure if anything failed and we shouldn't keep partials
    // Only trigger global rollback if globalOnError === 'abort'.
    // For 'skip-dependents', we keep other successfully executed nodes.
    const hasFailures = results.some(r => !r.success && !r.skipped);
    const rollbackSummary = await this.rollbackIfNeeded(hasFailures, globalOnError);

    return {
      success: !hasFailures,
      results,
      idMap: Object.fromEntries(this.tempIdMap),
      rollback: rollbackSummary
    };
  }

  private async executeOne(action: FigmaAction): Promise<Omit<ActionResult, 'action'>> {
    try {
      const parentNode = await this.resolveParent(action.parentId);

      // Pre-validation
      let targetNode: SceneNode | null = null;
      if (action.action === 'updateProps' || action.action === 'delete' || action.action === 'move') {
        const resolvedTargetId = this.resolveId(action.nodeId);
        targetNode = (await figma.getNodeByIdAsync(resolvedTargetId)) as SceneNode;
        if (!targetNode) {
          return { success: false, error: `Node ${action.nodeId} not found` };
        }
      }

      const validation = ActionValidator.validate(action, targetNode, parentNode);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Pre-execution: normalize sizing props to prevent Figma API exceptions
      const props = (action as any).props;
      if (props) {
        const sizingWarnings = this.normalizeSizingInProps(props, targetNode, parentNode);
        if (sizingWarnings.length > 0) {
          console.warn(`[ActionExecutor] Sizing normalized for ${action.action}:`, sizingWarnings.map(w => w.message));
        }
      }

      // Root node centering for newly created elements
      if (!parentNode && ['createFrame', 'createText', 'createShape', 'createIcon', 'createComponent', 'createInstance'].includes(action.action)) {
        (action as any).props = this.centerNodeInViewport((action as any).props, action.action);
      }

      switch (action.action) {
        case 'createFrame': {
          if (action.upsertExisting) {
            const existingFrame = this.findExistingChild(parentNode, action.props.name, 'FRAME');
            if (existingFrame) {
              const warnings = await this.applyProps(existingFrame, action.props);
              return { success: true, nodeId: existingFrame.id, warnings: warnings.length ? warnings : undefined };
            }
          }

          const frame = figma.createFrame();
          // Figma injects a default white fill on new frames — clear it so
          // "no fill specified" truly means no fill (least-surprise principle).
          frame.fills = [];
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(frame);
          }
          try {
            const warnings = await this.applyProps(frame, action.props);
            return { success: true, nodeId: frame.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            frame.remove();
            throw e;
          }
        }

        case 'createText': {
          if (action.upsertExisting) {
            const existingText = this.findExistingChild(parentNode, action.props.name, 'TEXT');
            if (existingText) {
              const warnings = await this.applyTextProps(existingText as TextNode, action.props);
              return { success: true, nodeId: existingText.id, warnings: warnings.length ? warnings : undefined };
            }
          }

          const text = figma.createText();
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(text);
          }
          try {
            const warnings = await this.applyTextProps(text, action.props);
            return { success: true, nodeId: text.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            text.remove();
            throw e;
          }
        }

        case 'createShape': {
          const shapeTypeMap: Record<string, string> = {
            RECTANGLE: 'RECTANGLE',
            ELLIPSE: 'ELLIPSE',
            LINE: 'LINE',
            VECTOR: 'VECTOR',
          };
          if (action.upsertExisting) {
            const existingShape = this.findExistingChild(
              parentNode, action.props.name, shapeTypeMap[action.shapeType] || 'RECTANGLE'
            );
            if (existingShape) {
              const warnings = await this.applyProps(existingShape, action.props);
              return { success: true, nodeId: existingShape.id, warnings: warnings.length ? warnings : undefined };
            }
          }

          let shape: RectangleNode | EllipseNode | LineNode | VectorNode;
          if (action.shapeType === 'ELLIPSE') shape = figma.createEllipse();
          else if (action.shapeType === 'LINE') shape = figma.createLine();
          else if (action.shapeType === 'VECTOR') shape = figma.createVector();
          else shape = figma.createRectangle();

          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(shape);
          }
          try {
            const warnings = await this.applyProps(shape, action.props);
            return { success: true, nodeId: shape.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            shape.remove();
            throw e;
          }
        }

        case 'createIcon': {
           if (action.upsertExisting) {
             const existingIcon = this.findExistingChild(parentNode, action.props.name, 'FRAME');
             if (existingIcon) {
               const warnings = await this.applyProps(existingIcon, action.props);
               return { success: true, nodeId: existingIcon.id, warnings: warnings.length ? warnings : undefined };
             }
           }

           let svgData = action.props.svgData;
           if (!svgData && action.props.iconName) {
             svgData = await fetchIconSvg(action.props.iconName) || undefined;
           }
           const iconParam = svgData || `<svg width="${action.props.width || 24}" height="${action.props.height || 24}"></svg>`;
           const iconNode = figma.createNodeFromSvg(iconParam);
           if (parentNode && 'appendChild' in parentNode) {
             parentNode.appendChild(iconNode);
           }
           try {
             // Rescale SVG proportionally to fit target size (preserves aspect ratio)
             const targetW = action.props.width || 24;
             const targetH = action.props.height || 24;
             const origW = iconNode.width;
             const origH = iconNode.height;
             if (origW > 0 && origH > 0) {
               const scale = Math.min(targetW / origW, targetH / origH);
               iconNode.rescale(scale);
             }

             // Extract vector-specific props — these should penetrate to vector children, not the outer SVG frame
             const iconFills = action.props.fills;
             const iconStrokes = action.props.strokes;
             const iconStrokeWeight = action.props.strokeWeight;
             const propsForFrame = { ...action.props };
             delete propsForFrame.fills;
             delete propsForFrame.strokes;
             delete propsForFrame.strokeWeight;
             delete propsForFrame.width;
             delete propsForFrame.height;

             const warnings = await this.applyProps(iconNode, propsForFrame);

             // Tint vector children: only recolor properties that already have values.
             // Fill-based icons (mdi): fills exist → recolor fills. Stroke-based (lucide/tabler): strokes exist → recolor strokes.
             // Brand logos: LLM should omit fills to preserve original colors (enforced via prompt).
             if (iconFills || iconStrokes || iconStrokeWeight !== undefined) {
               const tintColor = iconFills ? lowerPaints(iconFills) : undefined;
               const explicitStrokes = iconStrokes ? lowerPaints(iconStrokes) : undefined;
               for (const child of iconNode.findAll()) {
                 if ('fills' in child && 'strokes' in child) {
                   const childFills = (child as any).fills as readonly Paint[];
                   const childStrokes = (child as any).strokes as readonly Paint[];

                   if (explicitStrokes) {
                     (child as any).strokes = explicitStrokes;
                   } else if (tintColor && Array.isArray(childStrokes) && childStrokes.length > 0) {
                     (child as any).strokes = tintColor;
                   }

                   if (tintColor && Array.isArray(childFills) && childFills.length > 0) {
                     (child as any).fills = tintColor;
                   }
                 }
                 if (iconStrokeWeight !== undefined && 'strokeWeight' in child) {
                   (child as any).strokeWeight = iconStrokeWeight;
                 }
               }
             }

             return { success: true, nodeId: iconNode.id, warnings: warnings.length ? warnings : undefined };
           } catch (e: any) {
             iconNode.remove();
             throw e;
           }
        }

        case 'createComponent': {
          const comp = figma.createComponent();
          comp.fills = [];
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(comp);
          }
          try {
            const warnings = await this.applyProps(comp, action.props);
            // Register component symbol for cross-batch instance resolution
            if (action.tempId) {
              componentRegistry.set(action.tempId, comp.id);
            }
            return { success: true, nodeId: comp.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            comp.remove();
            throw e;
          }
        }

        case 'createInstance': {
          const master = await this.resolveComponent(action.source.componentKey, action.source.nodeId);
          if (!master) {
            return { success: false, error: 'Component source not found' };
          }
          const instance = master.createInstance();
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(instance);
          }
          let warnings: any[] = [];
          if (action.props) {
            try {
              warnings = await this.applyProps(instance, action.props);
            } catch (e: any) {
              instance.remove();
              throw e;
            }
          }
          // Apply overrides: find children by name and apply props
          if (action.overrides) {
            for (const [childName, overrideProps] of Object.entries(action.overrides)) {
              const child = instance.findOne(n => n.name === childName);
              if (child) {
                try {
                  if (child.type === 'TEXT') {
                    const w = await this.applyTextProps(child as TextNode, overrideProps);
                    if (w.length) warnings.push(...w);
                  } else {
                    const w = await this.applyProps(child, overrideProps);
                    if (w.length) warnings.push(...w);
                  }
                } catch (e: any) {
                  warnings.push({ code: 'OVERRIDE_FAILED', severity: 'warning', message: `Override for '${childName}' failed: ${e.message}` });
                }
              }
            }
          }
          return { success: true, nodeId: instance.id, warnings: warnings.length ? warnings : undefined };
        }

        case 'swapInstance': {
          if (!targetNode || targetNode.type !== 'INSTANCE') {
             return { success: false, error: `Target node ${action.nodeId} is not an INSTANCE` };
          }
          const newMaster = await this.resolveComponent(action.newComponentKey, action.newComponentNodeId);
          if (!newMaster) {
            return { success: false, error: 'New component source not found' };
          }
          // figma plugin API swap components:
          targetNode.swapComponent(newMaster);
          return { success: true, nodeId: targetNode.id };
        }

        case 'updateProps': {
          if (!targetNode) return { success: false, error: 'Node not found' };
          const warnings = targetNode.type === 'TEXT'
            ? await this.applyTextProps(targetNode as TextNode, action.props)
            : await this.applyProps(targetNode, action.props);
          return { success: true, nodeId: targetNode.id, warnings: warnings.length ? warnings : undefined };
        }

        case 'delete': {
          if (!targetNode) return { success: false, error: 'Node not found' };
          if (!targetNode.removed) {
            targetNode.remove();
          }
          return { success: true, nodeId: targetNode.id };
        }

        case 'move': {
          if (!targetNode) return { success: false, error: 'Node not found' };
          if (!parentNode || !('insertChild' in parentNode)) {
             return { success: false, error: 'Invalid parent node for move' };
          }
          if (action.index !== undefined) {
             parentNode.insertChild(action.index, targetNode);
          } else {
             parentNode.appendChild(targetNode);
          }
          return { success: true, nodeId: targetNode.id };
        }

        default:
          return { success: false, error: `Unknown action type: ${(action as any).action}` };
      }
    } catch (e: any) {
      return { success: false, error: e.message || 'Unknown error' };
    }
  }

  // --- Helpers ---

  private centerNodeInViewport(props: Record<string, any> | undefined, actionType: string): Record<string, any> {
    const p = props || {};
    if (p.x === undefined && p.y === undefined) {
      const defaultWidth = actionType === 'createText' ? 0 : 100;
      const defaultHeight = actionType === 'createText' ? 0 : 100;
      const w = p.width !== undefined ? p.width : defaultWidth;
      const h = p.height !== undefined ? p.height : defaultHeight;

      if (typeof figma !== 'undefined' && figma.viewport) {
        // Find rightmost edge of existing top-level nodes to avoid overlap
        const topChildren = figma.currentPage.children;
        let maxRight = -Infinity;
        for (const child of topChildren) {
          if ('x' in child && 'width' in child) {
            const right = child.x + child.width;
            if (right > maxRight) maxRight = right;
          }
        }

        const GAP = 100; // spacing between designs
        if (maxRight > -Infinity) {
          // Place to the right of all existing content
          p.x = Math.round(maxRight + GAP);
          p.y = Math.round(figma.viewport.center.y - h / 2);
        } else {
          // Empty canvas: center in viewport
          p.x = Math.round(figma.viewport.center.x - w / 2);
          p.y = Math.round(figma.viewport.center.y - h / 2);
        }
      }
    }
    return p;
  }

  /**
   * Pre-execution: normalize sizing props (HUG/FILL/FIXED) based on layout context.
   * Prevents Figma API exceptions like "HUG can only be set on auto-layout frames".
   */
  private normalizeSizingInProps(
    props: Record<string, any>,
    targetNode: SceneNode | null,
    parentNode: SceneNode | null,
  ): Array<{ code: string; severity: 'warning'; message: string }> {
    if (props.layoutSizingHorizontal === undefined && props.layoutSizingVertical === undefined) {
      return [];
    }

    const warnings: Array<{ code: string; severity: 'warning'; message: string }> = [];

    const nodeLayoutMode = props.layoutMode ?? (targetNode as any)?.layoutMode;
    const hasAutoLayout = nodeLayoutMode === 'HORIZONTAL' || nodeLayoutMode === 'VERTICAL';
    const parentLayoutMode =
      parentNode && 'layoutMode' in (parentNode as any)
        ? (parentNode as any).layoutMode
        : undefined;
    const parentHasAutoLayout = parentLayoutMode === 'HORIZONTAL' || parentLayoutMode === 'VERTICAL';
    const isRoot = !parentNode || (parentNode as any).type === 'PAGE';

    const toSizingMode = (v: unknown): SizingMode =>
      (v === 'HUG' || v === 'FILL' || v === 'FIXED') ? v : 'FIXED';

    const currentH = toSizingMode(
      props.layoutSizingHorizontal ?? (targetNode as any)?.layoutSizingHorizontal
    );
    const currentV = toSizingMode(
      props.layoutSizingVertical ?? (targetNode as any)?.layoutSizingVertical
    );

    const { h, v } = normalizeSizing(currentH, currentV, {
      hasAutoLayout,
      parentHasAutoLayout,
      isRoot,
    });

    if (props.layoutSizingHorizontal !== undefined) props.layoutSizingHorizontal = h;
    if (props.layoutSizingVertical !== undefined) props.layoutSizingVertical = v;

    if (h === 'FIXED' && currentH !== 'FIXED' && props.width === undefined) {
      const fallbackWidth = Math.max(
        1,
        Math.round(
          (targetNode as any)?.width ??
            ((parentNode as any)?.type !== 'PAGE' ? (parentNode as any)?.width : undefined) ??
            (isRoot ? 360 : 200)
        )
      );
      props.width = fallbackWidth;
      warnings.push({
        code: 'SIZING_NORMALIZED',
        severity: 'warning',
        message: `layoutSizingHorizontal ${currentH}→FIXED; width defaulted to ${fallbackWidth}px.`,
      });
    }

    if (v === 'FIXED' && currentV !== 'FIXED' && props.height === undefined) {
      const fallbackHeight = Math.max(
        1,
        Math.round(
          (targetNode as any)?.height ??
            ((parentNode as any)?.type !== 'PAGE' ? (parentNode as any)?.height : undefined) ??
            (isRoot ? 240 : 120)
        )
      );
      props.height = fallbackHeight;
      warnings.push({
        code: 'SIZING_NORMALIZED',
        severity: 'warning',
        message: `layoutSizingVertical ${currentV}→FIXED; height defaulted to ${fallbackHeight}px.`,
      });
    }

    return warnings;
  }

  /**
   * Upsert helper: find an existing child node matching name + type under parent.
   * Called only when action.upsertExisting=true.
   * Only matches when `name` is explicitly provided — unnamed nodes are always created fresh.
   */
  private findExistingChild(
    parent: SceneNode | null,
    name: string | undefined,
    expectedType: string,
  ): SceneNode | null {
    if (!parent || !name || !('children' in parent)) return null;
    const children = (parent as any).children as readonly SceneNode[];
    return children.find(
      (c: SceneNode) => c.name === name && c.type === expectedType
    ) ?? null;
  }

  private resolveId(idOrTempId: string): string {
    return this.tempIdMap.get(idOrTempId) || idOrTempId;
  }

  private async resolveParent(parentId?: string): Promise<SceneNode | null> {
    if (!parentId || parentId === 'root') return null; // root or unspecified is conceptually null (handled by caller context if needed, but usually current selection or page active)
    const realId = this.resolveId(parentId);
    // asynchronously get node
    const node = await figma.getNodeByIdAsync(realId);
    return node as SceneNode | null;
  }

  private async resolveComponent(key?: string, nodeId?: string): Promise<ComponentNode | null> {
    if (key) {
      try {
        const comp = await figma.importComponentByKeyAsync(key);
        if (comp) return comp;
      } catch (e) {
        console.warn('Import component key failed', e);
      }
    }
    if (nodeId) {
      // Resolution chain: tempIdMap (current batch) → componentRegistry (cross-batch) → raw ID
      const resolvedId = this.resolveId(nodeId);
      const finalId = resolvedId !== nodeId ? resolvedId : (componentRegistry.get(nodeId) || nodeId);
      const node = await figma.getNodeByIdAsync(finalId);
      if (node && node.type === 'COMPONENT') return node as ComponentNode;
      if (node && node.type === 'COMPONENT_SET') return (node as ComponentSetNode).defaultVariant as ComponentNode;
    }
    return null;
  }

  /**
   * Property application priority — Figma API requires certain properties to be set
   * before others (e.g., layoutMode before layoutSizing*, font before characters).
   * Lower number = applied first.
   */
  private static readonly PROP_ORDER: Record<string, number> = {
    // Layout mode must be first — sizing/spacing depend on it
    layoutMode: 0,
    layoutWrap: 1,
    // Sizing depends on layoutMode
    layoutSizingHorizontal: 2,
    layoutSizingVertical: 2,
    // Spacing — auto-layout only
    itemSpacing: 3,
    counterAxisSpacing: 3,
    paddingTop: 3,
    paddingRight: 3,
    paddingBottom: 3,
    paddingLeft: 3,
    // Child positioning
    primaryAxisAlignItems: 4,
    counterAxisAlignItems: 4,
    layoutGrow: 4,
    layoutAlign: 4,
    layoutPositioning: 4,
    clipsContent: 4,
    // Dimensions
    width: 5,
    height: 5,
    minWidth: 5,
    minHeight: 5,
    maxWidth: 5,
    maxHeight: 5,
    // Font must load before characters
    fontName: 6,
    fontSize: 6,
    fontWeight: 6,
    // Text content last among text props
    characters: 7,
  };

  private static sortPropsByDependency(entries: [string, any][]): [string, any][] {
    const defaultOrder = 5;
    return entries.sort(([a], [b]) => {
      const orderA = ActionExecutor.PROP_ORDER[a] ?? defaultOrder;
      const orderB = ActionExecutor.PROP_ORDER[b] ?? defaultOrder;
      return orderA - orderB;
    });
  }

  private async applyProps(node: SceneNode, props: Record<string, any>): Promise<any[]> {
    const warnings: any[] = [];
    const normalizedProps: Record<string, any> = { ...props };

    // 1. Padding expansion (avoid mutating the caller object)
    if (normalizedProps.padding !== undefined) {
      normalizedProps.paddingTop = normalizedProps.padding;
      normalizedProps.paddingRight = normalizedProps.padding;
      normalizedProps.paddingBottom = normalizedProps.padding;
      normalizedProps.paddingLeft = normalizedProps.padding;
      delete normalizedProps.padding;
    }

    // 2. Sort properties by dependency order to avoid Figma API errors
    //    (e.g., layoutMode must be set before layoutSizingVertical)
    const sortedEntries = ActionExecutor.sortPropsByDependency(Object.entries(normalizedProps));

    // 3. Format conversions + apply (using figma-lowering for complex types)
    for (const [key, value] of sortedEntries) {
      if (key === 'fills' && Array.isArray(value)) {
        try {
          (node as any).fills = lowerPaints(value);
        } catch (e: any) {
          console.warn(`[ActionExecutor] Failed to apply fills on node ${node.id}: ${e.message}`);
          warnings.push({ code: 'PAINT_INVALID', severity: 'warning', message: `Failed to apply fills: ${e.message}` });
        }
      } else if (key === 'strokes' && Array.isArray(value)) {
        try {
          (node as any).strokes = lowerPaints(value);
        } catch (e: any) {
          console.warn(`[ActionExecutor] Failed to apply strokes on node ${node.id}: ${e.message}`);
          warnings.push({ code: 'PAINT_INVALID', severity: 'warning', message: `Failed to apply strokes: ${e.message}` });
        }
      } else if (key === 'effects' && Array.isArray(value)) {
        try {
          (node as any).effects = lowerEffects(value);
        } catch (e: any) {
          console.warn(`[ActionExecutor] Failed to apply effects on node ${node.id}: ${e.message}`);
          warnings.push({ code: 'EFFECT_INVALID', severity: 'warning', message: `Failed to apply effects: ${e.message}` });
        }
      } else if ((key === 'letterSpacing' || key === 'lineHeight') && (typeof value === 'number' || typeof value === 'string' || (typeof value === 'object' && value !== null && 'unit' in value))) {
        try {
          (node as any)[key] = lowerUnitValue(value);
        } catch (e: any) {
          console.warn(`[ActionExecutor] Failed to apply ${key} on node ${node.id}: ${e.message}`);
          warnings.push({ code: 'PROP_NORMALIZE_FAILED', severity: 'warning', message: `Failed to apply ${key}: ${e.message}` });
        }
      } else if ((key === 'width' || key === 'height') && 'resize' in node) {
        try {
          (node as any).resize(
            key === 'width' ? value : node.width,
            key === 'height' ? value : node.height
          );
        } catch (e: any) {
          console.warn(`[ActionExecutor] Failed to resize node ${node.id}: ${e.message}`);
          warnings.push({ code: 'RESIZE_FAILED', severity: 'warning', message: `Failed to resize: ${e.message}` });
        }
      } else if (key in node) {
        if (!this.canAssignProperty(node, key)) {
          console.warn(`[ActionExecutor] Skipping readonly property '${key}' on node ${node.id} (${node.type})`);
          warnings.push({ code: 'SKIPPED_READONLY', severity: 'warning', message: `Skipped readonly property '${key}'` });
          continue;
        }

        try {
          (node as any)[key] = value;
        } catch (e: any) {
          const message = e?.message || 'Unknown property set error';
          if (String(message).includes('no setter for property')) {
            console.warn(`[ActionExecutor] Skipping property '${key}' due to missing setter on node ${node.id} (${node.type})`);
            warnings.push({ code: 'MISSING_SETTER', severity: 'warning', message: `Skipped property '${key}' due to missing setter` });
            continue;
          }
          throw e;
        }
      } else {
        console.warn(`[ActionExecutor] Unsupported property '${key}' on node ${node.id} (${node.type})`);
        warnings.push({
          code: 'UNSUPPORTED_PROP',
          severity: 'warning',
          message: `Skipped unsupported property '${key}' on ${node.type} node`,
        });
      }
    }
    return warnings;
  }

  private canAssignProperty(node: SceneNode, key: string): boolean {
    // Walk the prototype chain to detect getter-only/readonly properties.
    let target: any = node;
    while (target) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor) {
        return descriptor.writable === true || typeof descriptor.set === 'function';
      }
      target = Object.getPrototypeOf(target);
    }
    // If we cannot resolve a descriptor, keep previous behavior and attempt assignment.
    return true;
  }

  private async applyTextProps(node: TextNode, props: Record<string, any>): Promise<any[]> {
    const warnings: any[] = [];
    // Handle font resolution before setting characters
    const family = props.fontFamily || 'Inter';
    const style = props.fontWeight || 'Regular';
    
    // Default font loading
    const { success, loadedStyle } = await fontBus.getOrLoad(family, style);
    if (!success && loadedStyle !== style) {
       warnings.push({
           code: 'FONT_FALLBACK',
           severity: 'warning',
           requested: { family, style },
           applied: { family, style: loadedStyle },
           message: `Font not found, applied fallback: ${loadedStyle}`
       });
    }
    
    node.fontName = { family, style: loadedStyle };

    if (props.characters !== undefined) {
       node.characters = props.characters;
    }

    const otherProps = { ...props };
    delete otherProps.fontFamily;
    delete otherProps.fontWeight;
    delete otherProps.characters;

    const propWarnings = await this.applyProps(node, otherProps);
    if (propWarnings.length > 0) warnings.push(...propWarnings);
    return warnings;
  }

  // --- Transactions ---

  private async rollbackIfNeeded(hasFailures: boolean, globalOnError: string) {
    const summary = {
      attempted: 0,
      removed: 0,
      failed: [] as Array<{ opId: string; nodeId: string; reason: string }>
    };

    if (!hasFailures || globalOnError !== 'abort') {
      return summary;
    }

    summary.attempted = this.rollbackStack.length;

    for (const ref of [...this.rollbackStack].reverse()) {
      try {
        const node = await figma.getNodeByIdAsync(ref.nodeId) as SceneNode | null;
        if (node && !node.removed) {
          node.remove();
          summary.removed++;
        }
      } catch (e: any) {
        summary.failed.push({
          opId: ref.tempId,
          nodeId: ref.nodeId,
          reason: e?.message || 'Unknown rollback error'
        });
      }
    }

    return summary;
  }

  private topologicalSort(actions: FigmaAction[]): FigmaAction[] {
    // Actions without tempId (e.g. updateProps) have no dependency graph —
    // topological sort is meaningless for them. Pass through in order.
    const hasDeps = actions.some(a => a.tempId);
    if (!hasDeps) return actions;

    const sorted: FigmaAction[] = [];
    const visited = new Set<string>();
    const processing = new Set<string>();

    const actionMap = new Map<string, FigmaAction>();
    for (const action of actions) {
      if (action.tempId) {
        actionMap.set(action.tempId, action);
      }
    }

    const visit = (action: FigmaAction) => {
      const id = action.tempId;
      if (!id) {
        // No tempId = no dependency tracking. Just push in encounter order.
        sorted.push(action);
        return;
      }
      if (visited.has(id)) return;
      if (processing.has(id)) {
        console.warn('Circular dependency detected in batch operations');
        return;
      }

      processing.add(id);

      if (action.dependsOn) {
        for (const dep of action.dependsOn) {
          const depAction = actionMap.get(dep);
          if (depAction) visit(depAction);
        }
      }

      processing.delete(id);
      visited.add(id);
      sorted.push(action);
    };

    for (const action of actions) {
      visit(action);
    }

    return sorted;
  }
}
