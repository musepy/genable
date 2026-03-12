/**
 * @file toolCallHandler.ts
 * @description IPC handler for TOOL_CALL events.
 *
 * [RESPONSIBILITY]: Route tool calls to appropriate services.
 * [PATTERN]: Command Handler - thin layer that delegates to services.
 */

import { ToolResultHandler } from '../../types';
import { ToolResponse, ToolContext } from '../../engine/agent/tools/types';
import { emit } from '@create-figma-plugin/utilities';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { FlatOpsSerializer } from '../../engine/flat/flatOpsSerializer';

import { ActionExecutor } from '../../engine/actions/executor';
import { collectTreeViolations } from '../../engine/validation/postOpValidator';
import { compileDesignOps } from '../../engine/flat/flatOpsParser';
import { logger } from '../../utils/logger';
import { CONTEXT_CONSTANTS } from '../../engine/agent/context/constants';
import { fontBus } from '../../engine/figma-adapter/resources/FontBus';
import { buildCreateReceipt } from './receiptBuilder';
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
        // Focused context: page metadata + target node skeleton + selection
        const { nodeId: contextNodeId, depth: contextDepth } = parameters;
        const contextDepthClamped = Math.min(contextDepth || 2, 5);

        const contextResolved = await resolveSceneNode(contextNodeId);
        if (!contextResolved.ok) { response = contextResolved.response; break; }
        const contextNode = contextResolved.node;

        // Target node skeleton
        const contextSerialized = NodeSerializer.serializeWithCompression(contextNode, {
          maxDepth: contextDepthClamped,
          pruneDefaults: true
        });
        const contextTree = FlatOpsSerializer.serialize(contextSerialized, {
          maxDepth: contextDepthClamped,
          structural: true,
        });

        // Page metadata: name, childCount, top-level node names (lightweight)
        const page = figma.currentPage;
        const topLevelNodes = page.children.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
        }));

        const contextSelection = page.selection.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
        }));

        response = {
          success: true,
          data: {
            page: { name: page.name, childCount: page.children.length, topLevelNodes },
            tree: contextTree,
            ...(contextSelection.length > 0 && { selection: contextSelection }),
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

        // Parse + validate + compile in one call
        let compiled;
        try {
          compiled = compileDesignOps(designOps, designParentId);
          if (compiled.ops.length === 0 && compiled.errors.length > 0) {
            response = { success: false, error: { code: 'PARSE_ERROR', message: compiled.errors.map(e => `L${e.lineNumber}: ${e.error}`).join('; ') } };
            break;
          }
          if (compiled.diagnostics.length > 0) {
            logger.info('Design diagnostics', { diagnostics: compiled.diagnostics });
          }
        } catch (e: any) {
          response = { success: false, error: { code: 'PARSE_ERROR', message: e.message } };
          break;
        }

        try {
          const SOFT_CREATE_LIMIT = 20;

          // Execute all ops (create, update, delete) in one unified pass
          const executor = new ActionExecutor();
          const result = await executor.executeDesignOps(compiled.ops, compiled.errors, {
            onError: 'continue', rollbackMode: 'none', parentId: designParentId,
          });

          // Post-op validation on root
          const rootId = designParentId || Object.values(result.idMap)[0];
          const violations = await collectViolationsForNodeIds([rootId], 5);

          const receipt = buildCreateReceipt({
            result,
            violations,
            softCreateLimit: SOFT_CREATE_LIMIT,
            createLineCount: compiled.ops.length,
          });

          // Surface diagnostics as warnings in receipt
          if (compiled.diagnostics.length > 0) {
            receipt.diagnostics = compiled.diagnostics.slice(0, 10).map(d => ({
              code: d.code,
              severity: d.severity,
              message: d.message,
            }));
          }

          if (result.hasErrors) {
            const parts: string[] = [];
            if (result.stats.created) parts.push(`${result.stats.created} created`);
            if (result.stats.edited) parts.push(`${result.stats.edited} edited`);
            if (result.stats.deleted) parts.push(`${result.stats.deleted} deleted`);
            if (result.stats.failed) parts.push(`${result.stats.failed} failed`);
            if (result.stats.skipped) parts.push(`${result.stats.skipped} skipped`);
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
      if (node.type === 'TEXT') return undefined;
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
      if (node.type !== 'TEXT' && typeof value === 'string') (node as any).fills = [{ type: 'SOLID', color: hexToRgba(value) }];
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
