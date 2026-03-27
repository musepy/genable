/**
 * @file extract-figma-props.ts
 * @description Build-time script — parses @figma/plugin-typings to extract
 *              every writable property per node type.
 *
 * Usage:  npx tsx tools/extract-figma-props.ts
 * Output: src/constants/figma-property-registry.ts
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

interface ExtractedProp {
  key: string;
  valueType: string;
  readonly: boolean;
}

function classifyType(typeStr: string): string {
  // Remove PluginAPI['mixed'] unions
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

function extractProperties(checker: ts.TypeChecker, interfaceName: string, sourceFile: ts.SourceFile): ExtractedProp[] {
  const props: ExtractedProp[] = [];
  const seen = new Set<string>();

  // Find the interface declaration
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

    // Skip methods — check if the symbol's type is a function
    const memberType = checker.getTypeOfSymbolAtLocation(symbol, interfaceNode);
    const callSigs = memberType.getCallSignatures();
    if (callSigs.length > 0) continue;

    // Determine readonly from declarations
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

    props.push({ key: name, valueType, readonly: isReadonly });
  }

  return props;
}

function generate(): void {
  console.log('Parsing @figma/plugin-typings...');

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
    const props = extractProperties(checker, interfaceName, sourceFile);
    registry[nodeType] = props;
    console.log(`    ${props.length} properties (${props.filter(p => !p.readonly).length} writable)`);
  }

  // Generate output
  const lines: string[] = [
    '/** Auto-generated from @figma/plugin-typings. Do not edit manually.',
    ' *  Re-generate: npx tsx tools/extract-figma-props.ts',
    ' */',
    '',
    'export interface PropertyDef {',
    '  key: string;',
    "  valueType: 'number' | 'string' | 'boolean' | 'enum' | 'object' | 'array';",
    '  readonly: boolean;',
    '}',
    '',
    '// ── Per-node-type property lists (extracted from plugin-api.d.ts mixin chains) ──',
    '',
    'export const PROPERTY_REGISTRY: Record<string, PropertyDef[]> = {',
  ];

  for (const [nodeType, props] of Object.entries(registry)) {
    lines.push(`  ${nodeType}: [`);
    for (const p of props) {
      lines.push(`    { key: '${p.key}', valueType: '${p.valueType}', readonly: ${p.readonly} },`);
    }
    lines.push('  ],');
  }
  lines.push('};');

  lines.push('');
  lines.push('// ── Blacklist: properties to never serialize ──');
  lines.push('// Methods, readonly/computed values, deprecated, internal/irrelevant');
  lines.push('');
  lines.push('export const BLACKLIST = new Set([');
  lines.push('  // Identity & structural (handled separately)');
  lines.push("  'id', 'type', 'name', 'parent', 'children', 'removed', 'visible',");
  lines.push('');
  lines.push('  // Readonly / computed values');
  lines.push("  'absoluteRenderBounds', 'absoluteBoundingBox', 'absoluteTransform',");
  lines.push("  'fillGeometry', 'strokeGeometry', 'vectorNetwork', 'vectorPaths',");
  lines.push("  'inferredAutoLayout', 'detachedInfo', 'targetAspectRatio',");
  lines.push("  'overlayPositionType', 'overlayBackground', 'overlayBackgroundInteraction',");
  lines.push("  'exportSettings', 'isAsset', 'stuckNodes', 'attachedConnectors',");
  lines.push("  'variantProperties', 'componentPropertyDefinitions', 'componentProperties',");
  lines.push("  'mainComponent', 'defaultVariant', 'variantGroupProperties',");
  lines.push("  'overrides', 'exposedInstances', 'isExposedInstance',");
  lines.push("  'hasMissingFont', 'openTypeFeatures', 'width', 'height',");
  lines.push("  'relativeTransform', 'key', 'remote', 'prototypeStartNode',");
  lines.push('');
  lines.push('  // Deprecated');
  lines.push("  'horizontalPadding', 'verticalPadding', 'backgrounds', 'backgroundStyleId',");
  lines.push("  'primaryAxisSizingMode', 'counterAxisSizingMode',");
  lines.push('');
  lines.push('  // Style IDs (separate concern)');
  lines.push("  'fillStyleId', 'strokeStyleId', 'effectStyleId', 'gridStyleId', 'textStyleId',");
  lines.push('');
  lines.push('  // Internal / not design-relevant');
  lines.push("  'reactions', 'guides', 'expanded', 'locked',");
  lines.push("  'layoutGrids', 'flowStartingPoints', 'annotations',");
  lines.push("  'componentPropertyReferences', 'boundVariables', 'inferredVariables',");
  lines.push("  'resolvedVariableModes', 'explicitVariableModes',");
  lines.push("  'devStatus', 'description', 'descriptionMarkdown', 'documentationLinks',");
  lines.push("  'numberOfFixedChildren', 'overflowDirection',");
  lines.push("  'isMask', 'maskType', 'handleMirroring', 'strokeMiterLimit',");
  lines.push("  'autoRename', 'scaleFactor',");
  lines.push("  'sectionContentsHidden',");
  lines.push("  'textDecorationStyle', 'textDecorationOffset', 'textDecorationThickness',");
  lines.push("  'textDecorationColor', 'textDecorationSkipInk',");
  lines.push("  'leadingTrim', 'hyperlink', 'listSpacing', 'hangingPunctuation', 'hangingList',");
  lines.push("  'arcData', 'pointCount', 'innerRadius', 'booleanOperation',");
  lines.push(']);');
  lines.push('');

  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n');
  console.log(`\nWritten: ${OUTPUT_PATH}`);

  // Summary
  const allProps = new Set<string>();
  for (const props of Object.values(registry)) {
    for (const p of props) allProps.add(p.key);
  }
  console.log(`Total unique properties across all node types: ${allProps.size}`);
}

generate();
