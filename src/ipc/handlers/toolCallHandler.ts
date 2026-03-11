/**
 * @file toolCallHandler.ts
 * @description IPC handler for TOOL_CALL events.
 *
 * [RESPONSIBILITY]: Route tool calls to appropriate services.
 * [PATTERN]: Command Handler - thin layer that delegates to services.
 */

import { ToolResultHandler } from '../../types';
import { nodeLayoutService } from '../../engine/services';
import { ToolResponse, ToolContext } from '../../engine/agent/tools/types';
import { emit } from '@create-figma-plugin/utilities';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { FlatOpsSerializer } from '../../engine/flat/flatOpsSerializer';

import { ActionExecutor } from '../../engine/actions/executor';
import { FigmaAction } from '../../engine/actions/types';
import { ActionCompiler } from '../../engine/actions/compiler';
import { IncrementalExecutor } from '../../engine/actions/incrementalExecutor';
import { collectTreeViolations } from '../../engine/validation/postOpValidator';
import { normalizeProps } from '../../domain/node-normalizers';
import { validateSemantics } from '../../engine/validation/semanticValidator';
import { parseFlatOps } from '../../engine/flat/flatOpsParser';
import { logger } from '../../utils/logger';
import { CONTEXT_CONSTANTS } from '../../engine/agent/context/constants';
import { fontBus } from '../../engine/figma-adapter/resources/FontBus';
import { buildCreateReceipt, buildEditReceipt } from './receiptBuilder';
import type { ValidationViolation } from '../../engine/validation/postOpValidator';

export interface ToolCallData {
  toolName: string;
  parameters: any;
  context?: ToolContext;
  requestId: string;
}

// ── Shared node resolution (single source for getNodeByIdAsync + type guard) ──

type NodeResolved = { ok: true; node: SceneNode } | { ok: false; response: ToolResponse };

async function resolveSceneNode(nodeId: string): Promise<NodeResolved> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    return { ok: false, response: { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` } } };
  }
  // SceneNode always has 'visible'; PageNode / DocumentNode don't
  if (!('visible' in node)) {
    return { ok: false, response: { success: false, error: { code: 'INVALID_NODE_TYPE', message: `Node ${nodeId} (type: ${node.type}) is not a SceneNode.` } } };
  }
  return { ok: true, node: node as SceneNode };
}

async function collectViolationsForNodeIds(
  nodeIds: Array<string | undefined>,
  maxDepth: number,
  maxViolations: number = 10
): Promise<ValidationViolation[] | undefined> {
  const uniqueNodeIds = [...new Set(nodeIds.filter((nodeId): nodeId is string => Boolean(nodeId)))];
  if (uniqueNodeIds.length === 0) return undefined;

  const violations: ValidationViolation[] = [];
  const seen = new Set<string>();

  for (const nodeId of uniqueNodeIds) {
    if (violations.length >= maxViolations) break;
    const resolved = await resolveSceneNode(nodeId);
    if (!resolved.ok) continue;

    const found = collectTreeViolations(resolved.node, maxDepth, maxViolations - violations.length);
    for (const violation of found) {
      const key = `${violation.nodeId}:${violation.code}:${violation.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(violation);
      if (violations.length >= maxViolations) break;
    }
  }

  return violations.length > 0 ? violations : undefined;
}


// ── Shared screenshot helper (used by read) ──

interface ScreenshotResult {
  success: true;
  __image: { mimeType: string; data: string };
  width: number;
  height: number;
}

async function exportNodeToBase64(
  node: SceneNode,
  scale: number = 1,
  format: 'png' | 'jpg' = 'png'
): Promise<ScreenshotResult> {
  const exportFormat = (format === 'png' ? 'PNG' : 'JPG') as 'PNG' | 'JPG';
  const exportScale = Math.min(Math.max(scale, 0.5), 2);
  const bytes = await node.exportAsync({
    format: exportFormat,
    constraint: { type: 'SCALE', value: exportScale }
  });

  // Uint8Array → base64 (Figma main thread has no Buffer or btoa)
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    base64 += CHARS[b0 >> 2] + CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    base64 += (i + 1 < bytes.length) ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    base64 += (i + 2 < bytes.length) ? CHARS[b2 & 63] : '=';
  }
  const mimeType = exportFormat === 'PNG' ? 'image/png' : 'image/jpeg';

  return {
    success: true,
    __image: { mimeType, data: base64 },
    width: Math.round(node.width * exportScale),
    height: Math.round(node.height * exportScale),
  };
}

/**
 * Handle TOOL_CALL IPC events.
 * Routes to the unified tool implementations.
 */
export async function handleToolCall(data: ToolCallData): Promise<void> {
  let { toolName, parameters, context, requestId } = data;

  logger.info(`Tool Call: ${toolName}`, { parameters, requestId });

  let response: ToolResponse;

  try {
    switch (toolName) {
      // ==========================================
      // UNIFIED TOOLS — 6-tool API
      // ==========================================

      case 'context': {
        // Canvas overview: page info + top-level skeleton + user selection
        const page = figma.currentPage;
        const childTrees: string[] = [];
        for (const child of page.children) {
          const hSerialized = NodeSerializer.serializeWithCompression(child, {
            maxDepth: 2,
            pruneDefaults: true
          });
          childTrees.push(FlatOpsSerializer.serialize(hSerialized, { maxDepth: 2, structural: true }));
        }

        const selection = page.selection.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
        }));

        response = {
          success: true,
          data: {
            page: { name: page.name, childCount: page.children.length },
            tree: childTrees.join('\n'),
            ...(selection.length > 0 && { selection }),
          }
        };
        break;
      }

      case 'outline': {
        const { nodeId: outlineNodeId, depth: outlineDepth } = parameters;
        const outlineDepthClamped = Math.min(outlineDepth || 5, 10);

        const outlineResolved = await resolveSceneNode(outlineNodeId);
        if (!outlineResolved.ok) { response = outlineResolved.response; break; }
        const outlineNode = outlineResolved.node;

        const outlineSerialized = NodeSerializer.serializeWithCompression(outlineNode, {
          maxDepth: outlineDepthClamped,
          pruneDefaults: true
        });
        const outlineXml = FlatOpsSerializer.serialize(outlineSerialized, {
          maxDepth: outlineDepthClamped,
          structural: true,
        });

        // Compute suggestedReads: children with 3+ own children
        const suggestedReads: string[] = [];
        if ('children' in outlineNode) {
          for (const child of (outlineNode as any).children) {
            if ('children' in child && child.children.length > 3) {
              suggestedReads.push(child.id);
            }
          }
        }

        const outlineData: any = { tree: outlineXml };
        if (suggestedReads.length > 0) outlineData.suggestedReads = suggestedReads;

        response = { success: true, data: outlineData };
        break;
      }

      case 'inspect': {
        const { nodeId: inspectNodeId, depth: inspectDepth, screenshot: wantScreenshot } = parameters;
        const inspectDepthClamped = Math.min(inspectDepth || 5, 10);

        const inspectResolved = await resolveSceneNode(inspectNodeId);
        if (!inspectResolved.ok) { response = inspectResolved.response; break; }
        const inspectNode = inspectResolved.node;

        const inspectSerialized = NodeSerializer.serializeWithCompression(inspectNode, {
          maxDepth: inspectDepthClamped,
          pruneDefaults: true
        });

        // Full mode with auto-degradation
        const inspectFullXml = FlatOpsSerializer.serialize(inspectSerialized, {
          maxDepth: inspectDepthClamped,
        });

        const inspectData: any = {};
        const AUTO_DEGRADE_CHARS = CONTEXT_CONSTANTS.READ_AUTO_DEGRADE_CHARS;

        if (inspectFullXml.length > AUTO_DEGRADE_CHARS) {
          const inspectStructuralXml = FlatOpsSerializer.serialize(inspectSerialized, {
            maxDepth: inspectDepthClamped,
            structural: true,
          });
          inspectData.tree = inspectStructuralXml;
          const childCount = inspectNode.type === 'FRAME' || inspectNode.type === 'GROUP' || inspectNode.type === 'SECTION'
            ? ('children' in inspectNode ? (inspectNode as any).children.length : 0)
            : 0;
          inspectData.hint = `Tree is large (${childCount} children, ${inspectFullXml.length} chars). Use outline() to discover structure, then inspect specific children.`;
        } else {
          inspectData.tree = inspectFullXml;
        }

        // Bundle screenshot if requested
        if (wantScreenshot && inspectNode.visible && inspectNode.width > 0 && inspectNode.height > 0) {
          try {
            const ssResult = await exportNodeToBase64(inspectNode);
            inspectData.__image = ssResult.__image;
          } catch (e: any) {
            logger.info(`Screenshot bundling failed for ${inspectNodeId}: ${e?.message}`);
          }
        }

        response = { success: true, data: inspectData };
        break;
      }

      case 'design': {
        const { ops: designOps, parentId: designParentId } = parameters;

        if (!designOps || typeof designOps !== 'string' || designOps.trim().length === 0) {
          response = { success: false, error: { code: 'EMPTY_OPS', message: 'A non-empty "ops" string must be provided.' } };
          break;
        }

        let designParsedLines;
        let droppedDiagnostics: Array<{ code: string; message: string; symbol?: string }> = [];
        try {
          const { lines: rawOps, errors: parseErrors } = parseFlatOps(designOps);
          if (rawOps.length === 0 && parseErrors.length > 0) {
            response = { success: false, error: { code: 'PARSE_ERROR', message: parseErrors.map(e => `L${e.line}: ${e.error}`).join('; ') } };
            break;
          }
          // Pass 3: semantic validation
          const { validated, diagnostics } = validateSemantics(rawOps);
          designParsedLines = validated;
          if (diagnostics.length > 0) {
            logger.info('Semantic validation diagnostics', { diagnostics });
            droppedDiagnostics = diagnostics
              .filter(d => d.severity === 'error')
              .map(d => ({ code: d.code, message: d.message, symbol: d.symbol }));
          }
          if (parseErrors.length > 0) {
            logger.info('Flat ops parse errors (skipped lines)', { parseErrors: parseErrors.slice(0, 8) });
          }
        } catch (e: any) {
          response = { success: false, error: { code: 'PARSE_ERROR', message: e.message } };
          break;
        }

        try {
          const createLines = designParsedLines.filter(l => l.command === 'create' || l.command === 'icon' || l.command === 'image' || l.command === 'instance');
          const updateLines = designParsedLines.filter(l => l.command === 'update');
          const deleteLines = designParsedLines.filter(l => l.command === 'delete');

          const SOFT_CREATE_LIMIT = 20;

          const receipt: Record<string, any> = {};
          let hasAnyError = false;

          // Phase 1: Execute creates
          if (createLines.length > 0) {
            const compiler = new ActionCompiler();
            const { actions, errors } = compiler.compile(createLines, designParentId);
            const createExec = new IncrementalExecutor();
            const createResult = await createExec.execute(actions, errors, {
              onError: 'continue', rollbackMode: 'none', parentId: designParentId,
            });

            // Post-op validation on root
            const createRootId = designParentId || Object.values(createResult.idMap)[0];
            const createViolations = await collectViolationsForNodeIds([createRootId], 5);

            const createReceipt = buildCreateReceipt({
              result: createResult,
              violations: createViolations,
              softCreateLimit: SOFT_CREATE_LIMIT,
              createLineCount: createLines.length,
            });

            Object.assign(receipt, createReceipt);
            if (createResult.hasErrors) hasAnyError = true;
          }

          // Phase 2: Execute updates
          if (updateLines.length > 0) {
            const patchActions: FigmaAction[] = updateLines.map(line => ({
              action: 'updateProps' as const,
              nodeId: line.targetRef!,
              props: line.props ? normalizeProps(line.props) : {}
            }));
            const updateExec = new ActionExecutor({ onError: 'skip-dependents' });
            const updateResult = await updateExec.execute(patchActions);

            const updateViolations = await collectViolationsForNodeIds(
              updateLines.map(line => line.targetRef),
              3
            );
            const editReceipt = buildEditReceipt({
              allResults: updateResult.results,
              violations: updateViolations,
            });
            receipt.edited = editReceipt.edited;
            if (editReceipt.failed) {
              hasAnyError = true;
              receipt.editFailed = editReceipt.failed;
              receipt.editErrors = editReceipt.errors;
            }
            if (editReceipt.warnings) receipt.warnings = editReceipt.warnings;
            if (editReceipt.warningCount) receipt.warningCount = editReceipt.warningCount;
            if (editReceipt.violations) {
              const priorViolations = Array.isArray(receipt.violations) ? receipt.violations : [];
              receipt.violations = [...priorViolations, ...editReceipt.violations].slice(0, 10);
            }
          }

          // Phase 3: Execute deletes
          if (deleteLines.length > 0) {
            let deletedCount = 0;
            const deleteErrors: any[] = [];
            for (const line of deleteLines) {
              try {
                const delResult = await nodeLayoutService.deleteNode(line.targetRef!);
                if (delResult.success) deletedCount++;
                else deleteErrors.push({ op: line.targetRef, error: delResult.error?.message || 'unknown' });
              } catch (e: any) {
                deleteErrors.push({ op: line.targetRef, error: e.message });
              }
            }
            receipt.deleted = deletedCount;
            if (deleteErrors.length > 0) { hasAnyError = true; receipt.deleteErrors = deleteErrors; }
          }

          // Surface rejected ops from semantic validation
          if (droppedDiagnostics.length > 0) {
            receipt.rejected = droppedDiagnostics.length;
            receipt.rejectedReasons = droppedDiagnostics.slice(0, 5).map(d => d.message);
            hasAnyError = true;
          }

          if (hasAnyError) {
            const parts: string[] = [];
            if (receipt.created) parts.push(`${receipt.created} created`);
            if (receipt.edited) parts.push(`${receipt.edited} edited`);
            if (receipt.deleted) parts.push(`${receipt.deleted} deleted`);
            if (receipt.failed) parts.push(`${receipt.failed} create failed`);
            if (receipt.editFailed) parts.push(`${receipt.editFailed} edit failed`);
            if (receipt.rejected) parts.push(`${receipt.rejected} rejected by validation`);
            response = { success: false, data: receipt, error: { code: 'PARTIAL_FAILURE', message: `${parts.join(', ')}. Use idMap for references.` } };
          } else {
            response = { success: true, data: receipt };
          }
        } catch (e: any) {
          response = { success: false, error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error in design pipeline' } };
        }
        break;
      }

      case 'replace': {
        const { mode: replaceMode, rootId: replaceRootId, properties: replaceProps, replacements } = parameters;

        if (replaceMode !== 'search' && replaceMode !== 'replace') {
          response = { success: false, error: { code: 'INVALID_MODE', message: 'Mode must be "search" or "replace".' } };
          break;
        }

        const replaceRootResolved = await resolveSceneNode(replaceRootId);
        if (!replaceRootResolved.ok) { response = replaceRootResolved.response; break; }
        const replaceRoot = replaceRootResolved.node;

        try {
          if (replaceMode === 'search') {
            if (!replaceProps || !Array.isArray(replaceProps) || replaceProps.length === 0) {
              response = { success: false, error: { code: 'MISSING_PROPERTIES', message: 'Search mode requires a non-empty "properties" array.' } };
              break;
            }

            const uniqueValues: Record<string, Set<string | number>> = {};
            for (const prop of replaceProps) uniqueValues[prop] = new Set();

            function collectValues(node: SceneNode): void {
              for (const prop of replaceProps) {
                const val = extractReplacePropertyValue(node, prop);
                if (val !== undefined && val !== null) uniqueValues[prop].add(val);
              }
              if ('children' in node) {
                for (const child of (node as any).children) collectValues(child);
              }
            }
            collectValues(replaceRoot);

            const result: Record<string, (string | number)[]> = {};
            for (const [prop, valueSet] of Object.entries(uniqueValues)) result[prop] = Array.from(valueSet);
            response = { success: true, data: result };
          } else {
            if (!replacements || typeof replacements !== 'object' || Object.keys(replacements).length === 0) {
              response = { success: false, error: { code: 'MISSING_REPLACEMENTS', message: 'Replace mode requires a non-empty "replacements" object.' } };
              break;
            }

            let totalReplaced = 0;
            const details: Record<string, number> = {};

            async function doReplace(node: SceneNode): Promise<void> {
              for (const [prop, rules] of Object.entries(replacements)) {
                if (!Array.isArray(rules)) continue;
                for (const rule of rules) {
                  const currentVal = extractReplacePropertyValue(node, prop);
                  if (currentVal !== undefined && matchesReplaceValue(currentVal, rule.from)) {
                    await applyReplacePropertyValue(node, prop, rule.to);
                    totalReplaced++;
                    details[prop] = (details[prop] || 0) + 1;
                  }
                }
              }
              if ('children' in node) {
                for (const child of (node as any).children) await doReplace(child);
              }
            }
            await doReplace(replaceRoot);
            response = { success: true, data: { replaced: totalReplaced, details } };
          }
        } catch (e: any) {
          response = { success: false, error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error during replace' } };
        }
        break;
      }

      case 'query': {
        const { source: querySource, query: queryText } = parameters;

        if (querySource !== 'nodes') {
          // 'knowledge' is handled locally in sandbox — should not arrive here
          response = { success: false, error: { code: 'INVALID_SOURCE', message: `Source "${querySource}" should be handled locally, not via IPC.` } };
          break;
        }

        // Search current page nodes by name or type
        const searchQuery = (queryText || '').toLowerCase();
        const MAX_RESULTS = 20;
        const matches: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number }> = [];

        const allNodes = figma.currentPage.findAll(node => {
          return node.name.toLowerCase().includes(searchQuery)
            || node.type.toLowerCase() === searchQuery;
        });

        for (const node of allNodes.slice(0, MAX_RESULTS)) {
          matches.push({
            id: node.id,
            name: node.name,
            type: node.type,
            x: Math.round(node.x),
            y: Math.round(node.y),
            width: Math.round(node.width),
            height: Math.round(node.height),
          });
        }

        response = {
          success: true,
          data: {
            results: matches,
            total: allNodes.length,
            truncated: allNodes.length > MAX_RESULTS,
          }
        };
        break;
      }

      // ==========================================
      // DEFAULT — Unknown Tool
      // ==========================================
      default:
        response = {
          success: false,
          error: { code: 'UNKNOWN_TOOL', message: `Tool '${toolName}' not found in main registry.` }
        };
        break;
    }
  } catch (e: any) {
    console.error(`[Agent] Tool Execution Error (${toolName}):`, e);
    response = {
      success: false,
      error: { code: 'EXECUTION_ERROR', message: e.message }
    };
  }

  emit<ToolResultHandler>('TOOL_RESULT', { requestId, response: response! });
}

// ── Replace tool helpers ──

function rgbaToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function hexToRgba(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return {
    r: parseInt(full.substring(0, 2), 16) / 255,
    g: parseInt(full.substring(2, 4), 16) / 255,
    b: parseInt(full.substring(4, 6), 16) / 255,
  };
}

function extractReplacePropertyValue(node: SceneNode, prop: string): string | number | undefined {
  switch (prop) {
    case 'fillColor': {
      const fills = (node as any).fills;
      if (Array.isArray(fills) && fills.length > 0 && fills[0].type === 'SOLID') return rgbaToHex(fills[0].color);
      return undefined;
    }
    case 'textColor': {
      if (node.type !== 'TEXT') return undefined;
      const fills = (node as any).fills;
      if (Array.isArray(fills) && fills.length > 0 && fills[0].type === 'SOLID') return rgbaToHex(fills[0].color);
      return undefined;
    }
    case 'strokeColor': {
      const strokes = (node as any).strokes;
      if (Array.isArray(strokes) && strokes.length > 0 && strokes[0].type === 'SOLID') return rgbaToHex(strokes[0].color);
      return undefined;
    }
    case 'cornerRadius':
      return typeof (node as any).cornerRadius === 'number' ? (node as any).cornerRadius : undefined;
    case 'gap':
      return typeof (node as any).itemSpacing === 'number' ? (node as any).itemSpacing : undefined;
    case 'fontSize':
      return node.type === 'TEXT' && typeof (node as any).fontSize === 'number' ? (node as any).fontSize : undefined;
    case 'fontFamily':
      return node.type === 'TEXT' && typeof (node as any).fontName === 'object' ? (node as any).fontName.family : undefined;
    case 'fontWeight':
      return node.type === 'TEXT' && typeof (node as any).fontName === 'object' ? (node as any).fontName.style : undefined;
    default:
      return undefined;
  }
}

function matchesReplaceValue(current: string | number, from: string | number): boolean {
  if (typeof current === 'number' && typeof from === 'number') return current === from;
  if (typeof current === 'string' && typeof from === 'string') return current.toUpperCase() === from.toUpperCase();
  return String(current) === String(from);
}

async function applyReplacePropertyValue(node: SceneNode, prop: string, value: string | number): Promise<void> {
  switch (prop) {
    case 'fillColor':
      if (typeof value === 'string') (node as any).fills = [{ type: 'SOLID', color: hexToRgba(value) }];
      break;
    case 'textColor':
      if (node.type === 'TEXT' && typeof value === 'string') (node as any).fills = [{ type: 'SOLID', color: hexToRgba(value) }];
      break;
    case 'strokeColor':
      if (typeof value === 'string') (node as any).strokes = [{ type: 'SOLID', color: hexToRgba(value) }];
      break;
    case 'cornerRadius':
      if (typeof value === 'number') (node as any).cornerRadius = value;
      break;
    case 'gap':
      if (typeof value === 'number') (node as any).itemSpacing = value;
      break;
    case 'fontSize':
      if (node.type === 'TEXT' && typeof value === 'number') (node as any).fontSize = value;
      break;
    case 'fontFamily':
      if (node.type === 'TEXT' && typeof value === 'string') {
        const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
        const { loadedStyle } = await fontBus.getOrLoad(value, cur.style);
        (node as any).fontName = { family: value, style: loadedStyle };
      }
      break;
    case 'fontWeight':
      if (node.type === 'TEXT' && typeof value === 'string') {
        const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
        const { loadedStyle } = await fontBus.getOrLoad(cur.family, value);
        (node as any).fontName = { family: cur.family, style: loadedStyle };
      }
      break;
  }
}
