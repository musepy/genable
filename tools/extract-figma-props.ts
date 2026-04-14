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
}

// Accumulated across all node types — flushed at end of generate()
const unclassified: Array<{ key: string; nodeType: string }> = [];

function classifyType(typeStr: string): string {
  const clean = typeStr
    .replace(/\s*\|\s*PluginAPI\['mixed'\]/g, '')
    .replace(/PluginAPI\['mixed'\]\s*\|\s*/g, '')
    .trim();

  if (clean === 'number' || clean === 'number | null') return 'number';
  if (clean === 'string' || clean === 'string | null') return 'string';
  if (clean === 'boolean') return 'boolean';
  if (clean.includes("'") && clean.includes('|') && !clean.includes('{')) return 'enum';
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
    const valueType = classifyType(typeStr);
    const role = ROLE_MAP[name];
    if (!role) {
      unclassified.push({ key: name, nodeType });
    }

    props.push({ key: name, valueType, readonly: isReadonly, role: role || 'appearance' });
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
      section1Lines.push(`    { key: '${p.key}', valueType: '${p.valueType}', readonly: ${p.readonly}, role: '${p.role}' },`);
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
    ' * @description Single source of truth for Figma property discovery + metadata.',
    ' *',
    ' * Three sections:',
    ' *   1. PROPERTY_REGISTRY (auto-generated) — per-node-type property lists with roles',
    ' *   2. (reserved)',
    ' *   3. PROPERTY_META (hand-maintained) — enrichment: defaults, enums, constraints',
    ' *',
    ' * Re-generate section 1: npx tsx tools/extract-figma-props.ts',
    ' */',
    '',
    'export interface PropertyDef {',
    '  key: string;',
    "  valueType: 'number' | 'string' | 'boolean' | 'enum' | 'object' | 'array';",
    '  readonly: boolean;',
    "  role: 'layout' | 'fill' | 'stroke' | 'effect' | 'appearance' | 'typography'",
    "      | 'style' | 'component'",
    "      | 'prototype' | 'devresource' | 'computed' | 'deprecated' | 'structural';",
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
