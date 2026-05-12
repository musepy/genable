/**
 * @file extract-figma-props.ts
 * @description Build-time script — parses @figma/plugin-typings to extract
 *              every property per node type, with semantic role classification.
 *
 * Roles:
 *   structural — identity/hierarchy (id, type, name, children, parent)
 *   visual     — design properties (fills, opacity, cornerRadius, ...)
 *   computed   — readonly derived values (absoluteTransform, fillGeometry, ...)
 *   relational — cross-node references (mainComponent, overrides, ...)
 *   internal   — not design-relevant (reactions, guides, devStatus, ...)
 *   deprecated — old API (horizontalPadding, backgrounds, ...)
 *   style      — style IDs (fillStyleId, strokeStyleId, ...)
 *
 * Usage:  npx tsx tools/extract-figma-props.ts
 * Output: src/constants/figma-property-registry.ts (Section 1 only — hand-maintained sections preserved)
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(__dirname, '..');
const TYPINGS_PATH = path.join(ROOT, 'node_modules/@figma/plugin-typings/plugin-api.d.ts');
const OUTPUT_PATH = path.join(ROOT, 'src/constants/figma-property-registry.ts');

// Node types we care about (Figma type string → interface name in d.ts)
const TARGET_NODES: Record<string, string> = {
  FRAME: 'FrameNode',
  TEXT: 'TextNode',
  RECTANGLE: 'RectangleNode',
  ELLIPSE: 'EllipseNode',
  LINE: 'LineNode',
  VECTOR: 'VectorNode',
  STAR: 'StarNode',
  POLYGON: 'PolygonNode',
  COMPONENT: 'ComponentNode',
  COMPONENT_SET: 'ComponentSetNode',
  INSTANCE: 'InstanceNode',
  GROUP: 'GroupNode',
  SECTION: 'SectionNode',
  BOOLEAN_OPERATION: 'BooleanOperationNode',
};

// ── Roles — aligned with Figma's Design panel groups ──
//
// Always visible (design core):
//   layout     — Position & Size + Auto Layout (x, y, w, h, layoutMode, gap, padding, align, wrap...)
//   fill       — Fill section (fills)
//   stroke     — Stroke section (strokes, strokeWeight, cornerRadius, dashPattern...)
//   effect     — Effects section (effects)
//   appearance — Appearance section (opacity, blendMode, clipsContent, visible)
//   typography — Typography section (fontSize, fontWeight, lineHeight... — TEXT nodes only)
//
// On-demand:
//   style      — Style references (fillStyleId, textStyleId...)
//   component  — Component info (componentProperties, variants, mainComponent...)
//
// Never visible:
//   prototype  — Prototype/interaction (reactions, overflowDirection...)
//   devresource — Dev resources (annotations, devStatus, description...)
//   computed   — Readonly derived (absoluteTransform, fillGeometry...)
//   deprecated — Old API (horizontalPadding, backgrounds...)
//   structural — Identity/hierarchy (id, type, name, parent, children — handled separately)

type Role =
  | 'layout' | 'fill' | 'stroke' | 'effect' | 'appearance' | 'typography'
  | 'style' | 'component'
  | 'prototype' | 'devresource' | 'computed' | 'deprecated' | 'structural';

// ── Bindable node-level properties (mirrors Figma's VariableBindableNodeField union) ──
// These are the ONLY properties where Figma allows variable binding at the node level.
// COLOR bindings live on Paint.boundVariables.color, NOT on node properties like fills/strokes.
// width/height are excluded deliberately — Figma allows binding but it's a visual no-op
// (width/height are computed post-layout). Binding is redirected to layoutSizingHorizontal/Vertical
// at the tool layer.
//
// Sourced from `type VariableBindableNodeField` in @figma/plugin-typings/plugin-api.d.ts,
// plus fontSize/letterSpacing/lineHeight from VariableBindableTextField (these are the
// text-range bindings Figma stores as VariableAlias[], but setBoundVariable() accepts
// them on the node level too, so we surface them as node-level bindable on TEXT nodes).
type BindableType = 'FLOAT' | 'BOOLEAN' | 'STRING' | 'COLOR';
const BINDABLE_FIELDS: Record<string, BindableType> = {
  // Spacing / sizing FLOATs
  itemSpacing: 'FLOAT',
  counterAxisSpacing: 'FLOAT',
  paddingTop: 'FLOAT', paddingRight: 'FLOAT', paddingBottom: 'FLOAT', paddingLeft: 'FLOAT',
  // Min/max sizing FLOATs (size-contributing, unlike width/height)
  minWidth: 'FLOAT', maxWidth: 'FLOAT',
  minHeight: 'FLOAT', maxHeight: 'FLOAT',
  // Grid spacing FLOATs
  gridRowGap: 'FLOAT', gridColumnGap: 'FLOAT',
  // Corner radius
  cornerRadius: 'FLOAT',
  topLeftRadius: 'FLOAT', topRightRadius: 'FLOAT',
  bottomLeftRadius: 'FLOAT', bottomRightRadius: 'FLOAT',
  // Stroke weights
  strokeWeight: 'FLOAT',
  strokeTopWeight: 'FLOAT', strokeRightWeight: 'FLOAT',
  strokeBottomWeight: 'FLOAT', strokeLeftWeight: 'FLOAT',
  // Appearance FLOAT
  opacity: 'FLOAT',
  // Typography FLOATs (only on TEXT — emitter guards by presence of key on entry)
  fontSize: 'FLOAT',
  letterSpacing: 'FLOAT',
  lineHeight: 'FLOAT',
  // Booleans
  visible: 'BOOLEAN',
  // Text content (TEXT only)
  characters: 'STRING',
};

// Properties whose facet (LLM-facing bucket) overrides the role-derived default.
// boundVariables / explicitVariableModes have role='computed' but surface as 'variables'.
const FACET_OVERRIDE: Record<string, string> = {
  boundVariables: 'variables',
  explicitVariableModes: 'variables',
};

// Properties that are forcibly writable:false even when typings mark them non-readonly.
// - width/height: computed post-layout (typings agree, we state it explicitly so future churn can't flip).
// - boundVariables/explicitVariableModes: variable-binding state is not writable through normal setters;
//   goes through setBoundVariable() / setExplicitVariableModeForCollection() APIs instead. Registry
//   stays honest about what `writable` means (= can be targeted by a generic setter).
const FORCE_NOT_WRITABLE = new Set(['width', 'height', 'boundVariables', 'explicitVariableModes']);

// Properties whose sync getter throws under Figma's `documentAccess: dynamic-page` mode —
// readers MUST go through the async variant (e.g. node.getMainComponentAsync()).
// The map value is the async method name used for extraction.
//
// Found via runtime errors like `in get_mainComponent: Cannot call with documentAccess:
// dynamic-page. Use node.getMainComponentAsync instead.` Add new entries here when a
// similar error appears for a different property.
const ASYNC_PROPS: Record<string, string> = {
  mainComponent: 'getMainComponentAsync',
  instances: 'getInstancesAsync',
};

const ROLE_MAP: Record<string, Role> = {
  // ── Structural ──
  id: 'structural', type: 'structural', name: 'structural',
  parent: 'structural', children: 'structural', removed: 'structural',

  // ── Layout (Position & Size + Auto Layout) ──
  x: 'layout', y: 'layout', width: 'layout', height: 'layout', rotation: 'layout',
  layoutSizingHorizontal: 'layout', layoutSizingVertical: 'layout',
  constraints: 'layout', constrainProportions: 'layout',
  minWidth: 'layout', maxWidth: 'layout', minHeight: 'layout', maxHeight: 'layout',
  layoutMode: 'layout', itemSpacing: 'layout', counterAxisSpacing: 'layout',
  paddingTop: 'layout', paddingRight: 'layout', paddingBottom: 'layout', paddingLeft: 'layout',
  primaryAxisAlignItems: 'layout', counterAxisAlignItems: 'layout',
  counterAxisAlignContent: 'layout',
  layoutWrap: 'layout', layoutGrow: 'layout', layoutAlign: 'layout',
  layoutPositioning: 'layout', itemReverseZIndex: 'layout',
  // Grid container (FRAME with grid layout — added in plugin-typings ~1.110+)
  gridRowCount: 'layout', gridColumnCount: 'layout',
  gridRowGap: 'layout', gridColumnGap: 'layout',
  gridRowSizes: 'layout', gridColumnSizes: 'layout',
  // Grid child (any node inside a grid container)
  gridRowAnchorIndex: 'layout', gridColumnAnchorIndex: 'layout',
  gridRowSpan: 'layout', gridColumnSpan: 'layout',
  gridChildHorizontalAlign: 'layout', gridChildVerticalAlign: 'layout',

  // ── Fill ──
  fills: 'fill',

  // ── Stroke ──
  strokes: 'stroke', strokeWeight: 'stroke', strokeAlign: 'stroke',
  strokeJoin: 'stroke', strokeCap: 'stroke', dashPattern: 'stroke',
  strokeTopWeight: 'stroke', strokeRightWeight: 'stroke',
  strokeBottomWeight: 'stroke', strokeLeftWeight: 'stroke',
  strokesIncludedInLayout: 'stroke',
  // Variable-width / complex strokes (added in plugin-typings ~1.115+)
  variableWidthStrokeProperties: 'stroke', complexStrokeProperties: 'stroke',
  cornerRadius: 'stroke', cornerSmoothing: 'stroke',
  topLeftRadius: 'stroke', topRightRadius: 'stroke',
  bottomLeftRadius: 'stroke', bottomRightRadius: 'stroke',

  // ── Effect ──
  effects: 'effect',

  // ── Appearance ──
  opacity: 'appearance', blendMode: 'appearance',
  clipsContent: 'appearance', visible: 'appearance',

  // ── Typography (TEXT only) ──
  characters: 'typography', fontSize: 'typography', fontName: 'typography',
  fontWeight: 'typography', textAlignHorizontal: 'typography',
  textAlignVertical: 'typography', textAutoResize: 'typography',
  lineHeight: 'typography', letterSpacing: 'typography',
  textCase: 'typography', textDecoration: 'typography',
  textTruncation: 'typography', maxLines: 'typography',
  paragraphSpacing: 'typography', paragraphIndent: 'typography',

  // ── Style references (on-demand) ──
  fillStyleId: 'style', strokeStyleId: 'style', effectStyleId: 'style',
  gridStyleId: 'style', textStyleId: 'style',

  // ── Component (on-demand) ──
  mainComponent: 'component', componentProperties: 'component',
  componentPropertyDefinitions: 'component', variantProperties: 'component',
  defaultVariant: 'component', variantGroupProperties: 'component',
  overrides: 'component', exposedInstances: 'component', isExposedInstance: 'component',
  componentPropertyReferences: 'component', instances: 'component', scaleFactor: 'component',

  // ── Prototype (never) ──
  reactions: 'prototype', overflowDirection: 'prototype',
  numberOfFixedChildren: 'prototype',
  overlayPositionType: 'prototype', overlayBackground: 'prototype',
  overlayBackgroundInteraction: 'prototype',
  stuckNodes: 'prototype', attachedConnectors: 'prototype',
  prototypeStartNode: 'prototype',

  // ── Dev Resources (never) ──
  annotations: 'devresource', devStatus: 'devresource',
  description: 'devresource', descriptionMarkdown: 'devresource',
  documentationLinks: 'devresource', guides: 'devresource',

  // ── Computed (never) ──
  absoluteRenderBounds: 'computed', absoluteBoundingBox: 'computed', absoluteTransform: 'computed',
  fillGeometry: 'computed', strokeGeometry: 'computed',
  vectorNetwork: 'computed', vectorPaths: 'computed',
  inferredAutoLayout: 'computed', detachedInfo: 'computed', targetAspectRatio: 'computed',
  isAsset: 'computed', hasMissingFont: 'computed', openTypeFeatures: 'computed',
  relativeTransform: 'computed',
  boundVariables: 'computed', inferredVariables: 'computed',
  resolvedVariableModes: 'computed', explicitVariableModes: 'computed',

  // ── Deprecated ──
  horizontalPadding: 'deprecated', verticalPadding: 'deprecated',
  backgrounds: 'deprecated', backgroundStyleId: 'deprecated',
  primaryAxisSizingMode: 'deprecated', counterAxisSizingMode: 'deprecated',

  // Remaining internal (not fitting above groups)
  expanded: 'devresource', locked: 'devresource',
  layoutGrids: 'devresource', flowStartingPoints: 'devresource',
  exportSettings: 'devresource', key: 'devresource', remote: 'devresource',
  isMask: 'appearance', maskType: 'appearance',
  handleMirroring: 'stroke', strokeMiterLimit: 'stroke',
  autoRename: 'devresource', sectionContentsHidden: 'devresource',
  textDecorationStyle: 'typography', textDecorationOffset: 'typography',
  textDecorationThickness: 'typography', textDecorationColor: 'typography',
  textDecorationSkipInk: 'typography',
  leadingTrim: 'typography', hyperlink: 'typography',
  listSpacing: 'typography', hangingPunctuation: 'typography', hangingList: 'typography',
  arcData: 'stroke', pointCount: 'stroke', innerRadius: 'stroke',
  booleanOperation: 'layout',
};

interface ExtractedProp {
  key: string;
  valueType: string;
  readonly: boolean;
  role: Role;
  writable: boolean;
  bindable?: BindableType;
  facet?: string;
  /** Async getter method name (e.g. 'getMainComponentAsync') for properties that throw
   *  under documentAccess: dynamic-page mode. Readers must `await node[asyncMethod]()`. */
  asyncGetter?: string;
}

// Accumulated across all node types — flushed at end of generate()
const unclassified: Array<{ key: string; nodeType: string }> = [];

/**
 * Check whether `memberType` is a string-literal union — possibly including
 * `unique symbol` (= PluginAPI['mixed']) and null/undefined — and nothing else.
 * Expands through named type aliases (e.g. `BlendMode`, `StrokeCap`), so
 * `blendMode: BlendMode` is detected as enum even though the surface typeString
 * shows only the alias name.
 */
function isStringLiteralUnion(memberType: ts.Type): boolean {
  if (!memberType.isUnion()) return false;
  let hasStringLiteral = false;
  for (const u of memberType.types) {
    if (u.isStringLiteral()) {
      hasStringLiteral = true;
      continue;
    }
    // Tolerate Figma's `PluginAPI['mixed']` (resolves to `unique symbol`) and null/undefined.
    if (u.flags & ts.TypeFlags.UniqueESSymbol) continue;
    if (u.flags & ts.TypeFlags.Null) continue;
    if (u.flags & ts.TypeFlags.Undefined) continue;
    // Anything else (number, object, array, other references) disqualifies.
    return false;
  }
  return hasStringLiteral;
}

function classifyType(typeStr: string, memberType: ts.Type): string {
  const clean = typeStr
    .replace(/\s*\|\s*PluginAPI\['mixed'\]/g, '')
    .replace(/PluginAPI\['mixed'\]\s*\|\s*/g, '')
    .trim();

  if (clean === 'number' || clean === 'number | null') return 'number';
  if (clean === 'string' || clean === 'string | null') return 'string';
  if (clean === 'boolean') return 'boolean';
  // Enum detection via TypeChecker — catches both inline `"A" | "B"` and named
  // aliases like `BlendMode` or `StrokeCap | PluginAPI['mixed']`.
  if (isStringLiteralUnion(memberType)) return 'enum';
  if (clean.startsWith('ReadonlyArray<') || clean.startsWith('Array<') || clean.endsWith('[]')) return 'array';
  return 'object';
}

function extractProperties(checker: ts.TypeChecker, interfaceName: string, sourceFile: ts.SourceFile, nodeType: string): ExtractedProp[] {
  const props: ExtractedProp[] = [];
  const seen = new Set<string>();

  let interfaceNode: ts.InterfaceDeclaration | undefined;
  ts.forEachChild(sourceFile, node => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      interfaceNode = node;
    }
  });

  if (!interfaceNode) {
    console.warn(`  [warn] Interface ${interfaceName} not found`);
    return props;
  }

  const type = checker.getTypeAtLocation(interfaceNode);

  for (const symbol of type.getProperties()) {
    const name = symbol.getName();
    if (seen.has(name)) continue;
    seen.add(name);

    const memberType = checker.getTypeOfSymbolAtLocation(symbol, interfaceNode);
    const callSigs = memberType.getCallSignatures();
    if (callSigs.length > 0) continue;

    const declarations = symbol.getDeclarations();
    let isReadonly = false;
    if (declarations && declarations.length > 0) {
      for (const decl of declarations) {
        if (ts.isPropertySignature(decl) && decl.modifiers) {
          for (const mod of decl.modifiers) {
            if (mod.kind === ts.SyntaxKind.ReadonlyKeyword) {
              isReadonly = true;
              break;
            }
          }
        }
      }
    }

    const typeStr = checker.typeToString(memberType);
    const valueType = classifyType(typeStr, memberType);
    const role = ROLE_MAP[name];
    if (!role) {
      unclassified.push({ key: name, nodeType });
    }

    // writable = !readonly, with a forced override for width/height (computed post-layout).
    const writable = FORCE_NOT_WRITABLE.has(name) ? false : !isReadonly;

    // bindable — only set on the whitelisted node-level fields.
    // characters is STRING and only exists on TEXT; the lookup is key-based so the guard
    // is implicit: if a node type doesn't declare `characters`, the entry is never emitted.
    const bindable = BINDABLE_FIELDS[name];

    // facet — only set for the handful of properties whose LLM-facing bucket differs from role.
    const facet = FACET_OVERRIDE[name];

    const entry: ExtractedProp = { key: name, valueType, readonly: isReadonly, role: role || 'appearance', writable };
    if (bindable !== undefined) entry.bindable = bindable;
    if (facet !== undefined) entry.facet = facet;
    if (ASYNC_PROPS[name] !== undefined) entry.asyncGetter = ASYNC_PROPS[name];
    props.push(entry);
  }

  return props;
}

function generate(check: boolean): void {
  console.log(`Parsing @figma/plugin-typings... (${check ? 'check' : 'write'} mode)`);

  const program = ts.createProgram([TYPINGS_PATH], {
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
  });

  const sourceFile = program.getSourceFile(TYPINGS_PATH);
  if (!sourceFile) {
    console.error('Cannot read plugin-api.d.ts');
    process.exit(1);
  }

  const checker = program.getTypeChecker();
  const registry: Record<string, ExtractedProp[]> = {};

  for (const [nodeType, interfaceName] of Object.entries(TARGET_NODES)) {
    console.log(`  ${nodeType} → ${interfaceName}`);
    const props = extractProperties(checker, interfaceName, sourceFile, nodeType);
    registry[nodeType] = props;
    console.log(`    ${props.length} total`);
  }

  // ── Fail fast on unclassified — must be fixed in ROLE_MAP before writing ──
  if (unclassified.length > 0) {
    const byKey = new Map<string, string[]>();
    for (const { key, nodeType } of unclassified) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(nodeType);
    }
    console.error(`\n❌ ${byKey.size} unclassified propert${byKey.size === 1 ? 'y' : 'ies'} — add to ROLE_MAP in tools/extract-figma-props.ts:`);
    for (const [key, nodeTypes] of byKey) {
      console.error(`   ${key}  (${nodeTypes.join(', ')})`);
    }
    process.exit(1);
  }

  // ── Generate Section 1 only ──
  const section1Lines: string[] = [
    'export const PROPERTY_REGISTRY: Record<string, PropertyDef[]> = {',
  ];

  for (const [nodeType, props] of Object.entries(registry)) {
    section1Lines.push(`  ${nodeType}: [`);
    for (const p of props) {
      const base = `key: '${p.key}', valueType: '${p.valueType}', readonly: ${p.readonly}, role: '${p.role}', writable: ${p.writable}`;
      const bindablePart = p.bindable !== undefined ? `, bindable: '${p.bindable}'` : '';
      const facetPart = p.facet !== undefined ? `, facet: '${p.facet}'` : '';
      const asyncPart = p.asyncGetter !== undefined ? `, asyncGetter: '${p.asyncGetter}'` : '';
      section1Lines.push(`    { ${base}${bindablePart}${facetPart}${asyncPart} },`);
    }
    section1Lines.push('  ],');
  }
  section1Lines.push('};');

  // ── Read existing file, replace Section 1, preserve Sections 2+3 ──
  const existing = fs.readFileSync(OUTPUT_PATH, 'utf-8');
  const section2Marker = '// ═══════════════════════════════════════════════════════════════\n// Section 2';
  const section2Start = existing.indexOf(section2Marker);

  if (section2Start === -1) {
    console.error('Cannot find Section 2 marker in existing file. Aborting to avoid data loss.');
    process.exit(1);
  }

  const header = [
    '/**',
    ' * @file figma-property-registry.ts',
    ' * @description Single source of truth for Figma property metadata.',
    ' *',
    ' * Section 1 (`PROPERTY_REGISTRY`) is **auto-generated** from @figma/plugin-typings',
    ' * by `tools/extract-figma-props.ts`. Do not hand-edit — run the extractor to',
    ' * re-sync after updating plugin-typings. The build (`node build.js`) verifies sync',
    ' * via `--check` and fails if the registry drifts from the typings.',
    ' *',
    ' * To add / adjust a Figma property:',
    ' *   - Update `ROLE_MAP`, `BINDABLE_FIELDS`, `FACET_OVERRIDE`, or `FORCE_NOT_WRITABLE`',
    ' *     in `tools/extract-figma-props.ts`, then re-run the extractor.',
    ' *   - Every downstream consumer (read side via figma-property-registry-helpers.ts,',
    ' *     write side via bind_variable + expandShorthands + prop-dsl) picks up the',
    ' *     change without additional wiring.',
    ' *',
    ' * Sections:',
    ' *   1. PROPERTY_REGISTRY (auto-generated) — per-node-type property lists tagged with',
    ' *      valueType, readonly, role, writable, bindable, facet.',
    ' *   2. (reserved)',
    ' *   3. PROPERTY_META (hand-maintained) — enrichment: defaults, enums, constraints.',
    ' *',
    ' * See also: `src/constants/figma-property-registry-helpers.ts` for pure-logic',
    ' * queries (getFacetKeys, getWritableKeys, getBindableKeys, getPropertyDef).',
    ' */',
    '',
    'export interface PropertyDef {',
    '  key: string;',
    "  valueType: 'number' | 'string' | 'boolean' | 'enum' | 'object' | 'array';",
    '  readonly: boolean;',
    "  role: 'layout' | 'fill' | 'stroke' | 'effect' | 'appearance' | 'typography'",
    "      | 'style' | 'component'",
    "      | 'prototype' | 'devresource' | 'computed' | 'deprecated' | 'structural';",
    '  /** Whether the property can be written by setters. Mirrors !readonly, except width/height which stay false (computed post-layout). */',
    '  writable: boolean;',
    "  /** Set only on properties where Figma allows node-level variable binding. COLOR bindings live on Paint.boundVariables.color, not here. */",
    "  bindable?: 'FLOAT' | 'BOOLEAN' | 'STRING' | 'COLOR';",
    '  /** Override for LLM-facing facet bucket. When omitted, consumers derive from role. Currently only boundVariables/explicitVariableModes → "variables". */',
    '  facet?: string;',
    '  /** Async getter method name for properties that throw under documentAccess: dynamic-page',
    "   *  (e.g. 'getMainComponentAsync'). When set, readers MUST `await node[asyncGetter]()`",
    '   *  instead of the sync property — sync access raises a runtime error in that mode. */',
    '  asyncGetter?: string;',
    '}',
    '',
    '// ═══════════════════════════════════════════════════════════════',
    '// Section 1: Per-node-type property lists (auto-generated)',
    '// ═══════════════════════════════════════════════════════════════',
    '',
  ].join('\n');

  const preserved = existing.substring(section2Start);
  const output = header + section1Lines.join('\n') + '\n\n' + preserved;

  if (check) {
    if (existing !== output) {
      console.error('\n❌ figma-property-registry.ts is out of sync with @figma/plugin-typings.');
      console.error('   Run: npx tsx tools/extract-figma-props.ts');
      console.error('   Review the diff, then commit the regenerated file.');
      process.exit(1);
    }
    console.log(`\n✅ figma-property-registry.ts is in sync.`);
  } else {
    fs.writeFileSync(OUTPUT_PATH, output);
    console.log(`\nWritten: ${OUTPUT_PATH}`);
  }

  // Summary
  const roleCounts: Record<string, number> = {};
  const allProps = new Set<string>();
  for (const props of Object.values(registry)) {
    for (const p of props) {
      allProps.add(p.key);
      roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
    }
  }
  console.log(`Total unique properties: ${allProps.size}`);
  console.log('Role distribution (across all node types):');
  for (const [role, count] of Object.entries(roleCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role}: ${count}`);
  }
}

const isCheck = process.argv.includes('--check');
generate(isCheck);
