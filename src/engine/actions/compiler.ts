/**
 * @file compiler.ts
 * @description ActionCompiler converts ParsedLine[] (produced by operationAdapter)
 * into FigmaAction[] that can be fed to ActionExecutor.
 */

import { FigmaAction } from './types';
import { ParsedLine } from './buildDesignTypes';

export type { ParsedLine };

// ---------------------------------------------------------------------------
// Compilation result
// ---------------------------------------------------------------------------

export interface CompiledEntry {
  /** The source ParsedLine that produced this action. */
  line: ParsedLine;
  /** The FigmaAction ready to be executed. */
  action: FigmaAction;
  /** Non-fatal warnings generated during compilation (e.g. sizing defaults injected). */
  warnings?: Array<{ code: string; message: string }>;
}

export interface CompilationError {
  /** The source ParsedLine that failed to compile. */
  line: ParsedLine;
  /** Human-readable reason for the compilation failure. */
  error: string;
}

export interface CompilationResult {
  /** Successfully compiled actions, in the same order as their source lines. */
  actions: CompiledEntry[];
  /** Lines that could not be compiled (parse errors or unsupported constructs). */
  errors: CompilationError[];
}

// ---------------------------------------------------------------------------
// Shape node types supported by 'createShape'
// ---------------------------------------------------------------------------

const SHAPE_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR']);

// ---------------------------------------------------------------------------
// ActionCompiler
// ---------------------------------------------------------------------------

/**
 * Converts ParsedLine[] produced by the parsing pipeline into FigmaAction[]
 * understood by ActionExecutor.
 *
 * Rules applied during compilation:
 *   - `parentRef` that looks like a symbol (no `:` separator and appears in
 *     dependsOn) is forwarded as a tempId reference so ActionExecutor can
 *     resolve it via its internal idMap.
 *   - If no `parentRef` is present and `defaultParentId` is supplied, the
 *     default is used as `parentId` on the resulting action.
 *   - PARSE_ERROR lines are routed to `errors`, not `actions`.
 *   - 'image' is compiled as a grey placeholder frame (v1 implementation).
 */
export class ActionCompiler {
  /**
   * Compile a list of parsed lines into FigmaAction entries.
   *
   * @param lines - Parsed lines from the parsing pipeline.
   * @param defaultParentId - Fallback parentId when a line has no explicit parentRef.
   */
  compile(lines: ParsedLine[], defaultParentId?: string): CompilationResult {
    const actions: CompiledEntry[] = [];
    const errors: CompilationError[] = [];

    for (const line of lines) {
      // ---- PARSE_ERROR lines go straight to errors ----
      if (line.command === 'PARSE_ERROR') {
        errors.push({
          line,
          error: line.props?.message ?? line.raw ?? 'Parse error on line',
        });
        continue;
      }

      const result = this.compileLine(line, defaultParentId);
      if ('error' in result) {
        errors.push(result);
      } else {
        actions.push(result);
      }
    }

    return { actions, errors };
  }

  // ---------------------------------------------------------------------------
  // Private: compile a single line
  // ---------------------------------------------------------------------------

  private compileLine(
    line: ParsedLine,
    defaultParentId?: string,
  ): CompiledEntry | CompilationError {
    const parentId = this.resolveParentId(line, defaultParentId);
    const props = line.props ?? {};
    const dependsOn = line.dependsOn.length > 0 ? line.dependsOn : undefined;

    switch (line.command) {
      case 'create':
        return this.compileCreate(line, parentId, props, dependsOn);

      case 'update':
        return this.compileUpdate(line, props, dependsOn);

      case 'delete':
        return this.compileDelete(line, dependsOn);

      case 'icon':
        return this.compileIcon(line, parentId, props, dependsOn);

      case 'image':
        return this.compileImage(line, parentId, props, dependsOn);

      default:
        return {
          line,
          error: `Unknown command '${line.command}'`,
        };
    }
  }

  // ---------------------------------------------------------------------------
  // Private: command-specific compilers
  // ---------------------------------------------------------------------------

  private compileCreate(
    line: ParsedLine,
    parentId: string | undefined,
    props: Record<string, any>,
    dependsOn: string[] | undefined,
  ): CompiledEntry | CompilationError {
    const nodeType = (line.nodeType ?? 'FRAME').toUpperCase();
    const hasParent = !!parentId;

    if (nodeType === 'TEXT') {
      const action: FigmaAction = {
        action: 'createText',
        tempId: line.symbol,
        parentId,
        props: { characters: '', ...props },
        dependsOn,
      };
      return { line, action };
    }

    if (SHAPE_TYPES.has(nodeType)) {
      const { props: enhanced, warnings } = this.applySizingDefaults(props, hasParent, false);
      const action: FigmaAction = {
        action: 'createShape',
        shapeType: nodeType as 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'VECTOR',
        tempId: line.symbol,
        parentId,
        props: enhanced,
        dependsOn,
      };
      return { line, action, warnings: warnings.length > 0 ? warnings : undefined };
    }

    // Default: FRAME (covers FRAME and any unknown node types)
    const { props: enhanced, warnings } = this.applySizingDefaults(props, hasParent, true);
    const action: FigmaAction = {
      action: 'createFrame',
      tempId: line.symbol,
      parentId,
      props: enhanced,
      dependsOn,
    };
    return { line, action, warnings: warnings.length > 0 ? warnings : undefined };
  }

  // ---------------------------------------------------------------------------
  // Private: smart sizing defaults
  // ---------------------------------------------------------------------------

  /**
   * Inject sensible sizing defaults to prevent Figma's 100×100px fallback.
   * Returns both the enhanced props and warnings describing what was injected,
   * so the agent can see exactly which defaults were applied.
   *
   * Rules:
   * - Root frames (no parent): width defaults to 360px when not specified.
   * - Frames with layoutMode: layoutSizingVertical defaults to "HUG" when
   *   neither explicit height nor layoutSizingVertical is provided.
   * - Child frames/shapes (has parent): layoutSizingHorizontal defaults to
   *   "FILL" when neither explicit width nor layoutSizingHorizontal is set.
   */
  private applySizingDefaults(
    props: Record<string, any>,
    hasParent: boolean,
    isFrame: boolean,
  ): { props: Record<string, any>; warnings: Array<{ code: string; message: string }> } {
    const p = { ...props };
    const warnings: Array<{ code: string; message: string }> = [];

    if (isFrame) {
      // Root frame: ensure reasonable width (avoid 100px default)
      if (!hasParent && p.width === undefined && p.layoutSizingHorizontal !== 'FILL') {
        p.width = 360;
        warnings.push({ code: 'SIZING_DEFAULT', message: 'width defaulted to 360px (root frame without explicit width). Set width explicitly to control this.' });
      }

      // Frame with layoutMode: default to HUG height so it wraps content
      if (p.layoutMode && p.height === undefined && p.layoutSizingVertical === undefined) {
        p.layoutSizingVertical = 'HUG';
        warnings.push({ code: 'SIZING_DEFAULT', message: 'layoutSizingVertical defaulted to "HUG" (auto-layout frame without explicit height). Set height or layoutSizingVertical explicitly.' });
      }

      // Child frame: default to FILL width (stretch to parent)
      if (hasParent && p.width === undefined && p.layoutSizingHorizontal === undefined) {
        p.layoutSizingHorizontal = 'FILL';
        warnings.push({ code: 'SIZING_DEFAULT', message: 'layoutSizingHorizontal defaulted to "FILL" (child frame without explicit width). Set width or layoutSizingHorizontal explicitly.' });
      }
    }

    // Child shapes (RECTANGLE, etc.): default to FILL width
    if (!isFrame && hasParent && p.width === undefined && p.layoutSizingHorizontal === undefined) {
      p.layoutSizingHorizontal = 'FILL';
      warnings.push({ code: 'SIZING_DEFAULT', message: 'layoutSizingHorizontal defaulted to "FILL" (child shape without explicit width).' });
    }

    return { props: p, warnings };
  }

  private compileUpdate(
    line: ParsedLine,
    props: Record<string, any>,
    dependsOn: string[] | undefined,
  ): CompiledEntry | CompilationError {
    if (!line.targetRef) {
      return { line, error: "update command missing 'targetRef'" };
    }
    const nodeId = this.resolveRef(line.targetRef, line.dependsOn);
    const action: FigmaAction = {
      action: 'updateProps',
      nodeId,
      props,
      dependsOn,
    };
    return { line, action };
  }

  private compileDelete(
    line: ParsedLine,
    dependsOn: string[] | undefined,
  ): CompiledEntry | CompilationError {
    if (!line.targetRef) {
      return { line, error: "delete command missing 'targetRef'" };
    }
    const nodeId = this.resolveRef(line.targetRef, line.dependsOn);
    const action: FigmaAction = {
      action: 'delete',
      nodeId,
      dependsOn,
    };
    return { line, action };
  }

  private compileIcon(
    line: ParsedLine,
    parentId: string | undefined,
    props: Record<string, any>,
    dependsOn: string[] | undefined,
  ): CompiledEntry | CompilationError {
    const { iconName, ...rest } = props;
    const action: FigmaAction = {
      action: 'createIcon',
      tempId: line.symbol,
      parentId,
      props: { iconName, ...rest },
      dependsOn,
    };
    return { line, action };
  }

  /**
   * v1: compile an 'image' line as a grey placeholder frame.
   * A future version could call a real image-fetch action once it exists.
   */
  private compileImage(
    line: ParsedLine,
    parentId: string | undefined,
    props: Record<string, any>,
    dependsOn: string[] | undefined,
  ): CompiledEntry | CompilationError {
    const { placeholder, width, height, ...rest } = props;
    const dimensionProps: Record<string, any> = {};
    if (width !== undefined) dimensionProps.width = width;
    if (height !== undefined) dimensionProps.height = height;

    const action: FigmaAction = {
      action: 'createFrame',
      tempId: line.symbol,
      parentId,
      props: {
        name: placeholder ?? 'Image Placeholder',
        fills: ['#E0E0E0'],
        ...dimensionProps,
        ...rest,
      },
      dependsOn,
    };
    return { line, action };
  }

  // ---------------------------------------------------------------------------
  // Private: reference resolution helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a `parentRef` to a `parentId` string for use in the action.
   *
   * A ref that looks like a symbol (appears in the line's `dependsOn` list and
   * does not contain a `:` which Figma uses in real node IDs) is passed through
   * as-is so that ActionExecutor can resolve it via its `tempIdMap`.
   *
   * Falls back to `defaultParentId` when no `parentRef` is set on the line.
   */
  private resolveParentId(
    line: ParsedLine,
    defaultParentId?: string,
  ): string | undefined {
    if (!line.parentRef) return defaultParentId;
    return this.resolveRef(line.parentRef, line.dependsOn);
  }

  /**
   * Determine whether a ref string points to a previously-bound symbol (tempId)
   * or to a real Figma node ID.
   *
   * A ref is treated as a symbol (tempId) when:
   *   1. It does NOT contain `:` (Figma real IDs use the format "NNN:MMM").
   *   2. It IS listed in the `dependsOn` array of the current line.
   *
   * In either case the raw string is returned unchanged — ActionExecutor resolves
   * tempIds from its own `tempIdMap` at execution time.
   */
  private resolveRef(ref: string, dependsOn: string[]): string {
    const looksLikeSymbol = !ref.includes(':') && dependsOn.includes(ref);
    // For tempId references, ActionExecutor handles the lookup internally.
    // We just forward the string as-is.
    if (looksLikeSymbol) {
      return ref; // tempId reference — ActionExecutor will map it
    }
    return ref; // Real Figma ID — ActionExecutor uses it directly
  }
}
