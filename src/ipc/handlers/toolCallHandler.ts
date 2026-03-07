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
import { XmlSerializer } from '../../engine/figma-adapter/xmlSerializer';

import { ActionExecutor } from '../../engine/actions/executor';
import { FigmaAction } from '../../engine/actions/types';
import { ActionCompiler } from '../../engine/actions/compiler';
import { IncrementalExecutor } from '../../engine/actions/incrementalExecutor';
import { collectTreeAnomalies } from '../../engine/validation/postOpValidator';
import { compileCssProps } from '../../engine/actions/cssCompiler';
import { xmlToParsedLines } from '../../engine/actions/xmlDesignParser';
import { logger } from '../../utils/logger';
import { CONTEXT_CONSTANTS } from '../../engine/agent/context/constants';

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

// ── Read target resolution: Document/Page → page children summary ──

type ReadTarget =
  | { kind: 'scene'; nodeId: string }
  | { kind: 'page'; page: PageNode };

async function resolveReadTarget(nodeId: string): Promise<ReadTarget> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return { kind: 'scene', nodeId }; // let resolveSceneNode handle NOT_FOUND
  if (node.type === 'DOCUMENT') return { kind: 'page', page: figma.currentPage };
  if (node.type === 'PAGE') return { kind: 'page', page: node as PageNode };
  return { kind: 'scene', nodeId };
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
      // UNIFIED TOOLS — 4-primitive API
      // ==========================================

      case 'read': {
        const { nodeId: rawReadNodeId, depth: readDepth, screenshot: wantScreenshot, detail: readDetail } = parameters;
        const depthClamped = Math.min(readDepth || 5, 10);
        const isSummary = readDetail === 'summary';

        // Fallback: Document/Page → current page's children summary
        const readTarget = await resolveReadTarget(rawReadNodeId);

        if (readTarget.kind === 'page') {
          // Page isn't a SceneNode — always use structural mode for page overview
          const page = readTarget.page;
          const childXmls: string[] = [];
          for (const child of page.children) {
            const hSerialized = NodeSerializer.serializeWithCompression(child, {
              maxDepth: Math.min(depthClamped, 2), // shallow for page overview
              pruneDefaults: true
            });
            childXmls.push(XmlSerializer.serialize(hSerialized, { maxDepth: Math.min(depthClamped, 2), structural: true }));
          }
          response = {
            success: true,
            data: {
              xml: `<!-- Page: ${page.name} (${page.children.length} top-level nodes) -->\n${childXmls.join('\n')}`,
              hint: 'This is a page overview. Use read with a specific nodeId for detailed inspection.',
            }
          };
          break;
        }

        const resolved = await resolveSceneNode(readTarget.nodeId);
        if (!resolved.ok) { response = resolved.response; break; }
        const readNode = resolved.node;

        const hSerialized = NodeSerializer.serializeWithCompression(readNode, {
          maxDepth: depthClamped,
          pruneDefaults: true
        });

        // Summary mode: structural skeleton only
        if (isSummary) {
          const xml = XmlSerializer.serialize(hSerialized, {
            maxDepth: depthClamped,
            structural: true,
          });
          const data: any = { xml };

          if (wantScreenshot && readNode.visible && readNode.width > 0 && readNode.height > 0) {
            try {
              const ssResult = await exportNodeToBase64(readNode);
              data.__image = ssResult.__image;
            } catch (e: any) {
              logger.info(`Screenshot bundling failed for ${readTarget.nodeId}: ${e?.message}`);
            }
          }

          response = { success: true, data };
          break;
        }

        // Full mode with auto-degradation
        const fullXml = XmlSerializer.serialize(hSerialized, {
          maxDepth: depthClamped,
        });

        const data: any = {};
        const AUTO_DEGRADE_CHARS = CONTEXT_CONSTANTS.READ_AUTO_DEGRADE_CHARS;

        if (fullXml.length > AUTO_DEGRADE_CHARS) {
          // Auto-degrade: return structural skeleton + hint
          const structuralXml = XmlSerializer.serialize(hSerialized, {
            maxDepth: depthClamped,
            structural: true,
          });
          data.xml = structuralXml;
          const childCount = readNode.type === 'FRAME' || readNode.type === 'GROUP' || readNode.type === 'SECTION'
            ? ('children' in readNode ? (readNode as any).children.length : 0)
            : 0;
          data.hint = `Node tree is large (${childCount} children, ${fullXml.length} chars full XML). Showing structural skeleton. Use read with specific child IDs for full style details.`;
        } else {
          data.xml = fullXml;
        }

        // Bundle screenshot if requested
        if (wantScreenshot && readNode.visible && readNode.width > 0 && readNode.height > 0) {
          try {
            const ssResult = await exportNodeToBase64(readNode);
            data.__image = ssResult.__image;
          } catch (e: any) {
            logger.info(`Screenshot bundling failed for ${readTarget.nodeId}: ${e?.message}`);
          }
        }

        response = { success: true, data };
        break;
      }

      case 'create': {
        const { xml: xmlInput, parentId: bdParentId } = parameters;
        const onError = 'continue';
        const rollbackMode = 'none';

        if (!xmlInput || typeof xmlInput !== 'string' || xmlInput.trim().length === 0) {
          response = {
            success: false,
            error: { code: 'EMPTY_XML', message: 'A non-empty "xml" string must be provided.' }
          };
          break;
        }

        let parsedLines;
        try {
          parsedLines = xmlToParsedLines(xmlInput);
        } catch (e: any) {
          response = { success: false, error: { code: 'XML_PARSE_ERROR', message: e.message } };
          break;
        }

        try {

          // 2. Compile: convert ParsedLines to FigmaActions
          const compiler = new ActionCompiler();
          const { actions, errors } = compiler.compile(parsedLines, bdParentId);

          // 3. Execute incrementally
          const bdExecutor = new IncrementalExecutor();
          const bdResult = await bdExecutor.execute(actions, errors, {
            onError,
            rollbackMode,
            parentId: bdParentId,
          });

          // Inline post-op validation: check the root node for anomalies
          let bdAnomalies: any[] | undefined;
          const bdRootId = bdParentId || Object.values(bdResult.idMap)[0];
          if (bdRootId) {
            const bdRootResolved = await resolveSceneNode(bdRootId);
            if (bdRootResolved.ok) {
              const found = collectTreeAnomalies(bdRootResolved.node, 5);
              if (found.length > 0) bdAnomalies = found;
            }
          }

          // Build compact receipt at source
          const receipt: Record<string, any> = {
            idMap: bdResult.idMap,
            created: bdResult.stats.created,
          };

          if (bdResult.hasErrors) {
            const failures = bdResult.lineResults
              .filter(lr => lr.status === 'failed')
              .slice(0, 8)
              .map(lr => ({
                op: lr.symbol || `line${lr.line}`,
                error: lr.error || 'unknown',
              }));
            receipt.failed = bdResult.stats.failed;
            if (failures.length > 0) receipt.errors = failures;
          }

          // Collect degraded nodes (frames created as minimal placeholders)
          const degradedNodes = bdResult.lineResults
            .filter(lr => lr.warnings?.some(w => w.code === 'DEGRADED_FALLBACK'))
            .map(lr => lr.symbol)
            .filter(Boolean) as string[];
          if (degradedNodes.length > 0) {
            receipt.degraded = degradedNodes;
            receipt.degradedHint = 'These frames were created with minimal props due to errors. Use edit to apply their intended styles (layout, bg, padding, gap, etc).';
          }

          if (bdAnomalies && bdAnomalies.length > 0) {
            receipt.anomalies = bdAnomalies.slice(0, 5);
          }

          // Build error message parts
          const msgParts: string[] = [];
          if (bdResult.stats.failed > 0) {
            msgParts.push(`${bdResult.stats.failed} failed`);
          }
          if (degradedNodes.length > 0) {
            msgParts.push(`${degradedNodes.length} degraded (use edit to fix: ${degradedNodes.join(', ')})`);
          }

          response = {
            success: bdResult.success,
            data: receipt,
            error: (bdResult.hasErrors || degradedNodes.length > 0)
              ? {
                  code: bdResult.hasErrors ? 'PARTIAL_FAILURE' : 'DEGRADED',
                  message: `${bdResult.stats.created} created. ${msgParts.join('. ')}. Use idMap for references.`,
                }
              : undefined,
          };
        } catch (e: any) {
          response = {
            success: false,
            error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error in create pipeline' }
          };
        }
        break;
      }

      case 'edit': {
        const { xml: editXml } = parameters;

        if (!editXml || typeof editXml !== 'string' || editXml.trim().length === 0) {
          response = {
            success: false,
            error: { code: 'EMPTY_XML', message: 'A non-empty "xml" string must be provided.' }
          };
          break;
        }

        let parsedLines;
        try {
          parsedLines = xmlToParsedLines(editXml, { mode: 'edit' });
        } catch (e: any) {
          response = { success: false, error: { code: 'XML_PARSE_ERROR', message: e.message } };
          break;
        }

        try {
          // Separate update and delete operations
          const updateLines = parsedLines.filter(l => l.command === 'update');
          const deleteLines = parsedLines.filter(l => l.command === 'delete');

          const allResults: any[] = [];

          // Execute updates via ActionExecutor
          if (updateLines.length > 0) {
            const patchActions: FigmaAction[] = updateLines.map(line => ({
              action: 'updateProps' as const,
              nodeId: line.targetRef!,
              props: line.props ? compileCssProps(line.props) : {}
            }));

            const executor = new ActionExecutor({ onError: 'skip-dependents' });
            const execResult = await executor.execute(patchActions);
            allResults.push(...execResult.results);
          }

          // Execute deletes
          for (const line of deleteLines) {
            try {
              const delResult = await nodeLayoutService.deleteNode(line.targetRef!);
              allResults.push({ success: delResult.success, nodeId: line.targetRef, action: 'delete', error: delResult.error?.message });
            } catch (e: any) {
              allResults.push({ success: false, nodeId: line.targetRef, action: 'delete', error: e.message });
            }
          }

          const failedResults = allResults.filter(r => !r.success);

          // Inline post-op validation on edited nodes
          let editAnomalies: any[] | undefined;
          const editRootId = updateLines[0]?.targetRef;
          if (editRootId) {
            const editResolved = await resolveSceneNode(editRootId);
            if (editResolved.ok) {
              const found = collectTreeAnomalies(editResolved.node, 3);
              if (found.length > 0) editAnomalies = found;
            }
          }

          // Build compact receipt at source — no downstream cleaning needed
          const editedCount = allResults.filter(r => r.success).length;
          const idMap: Record<string, string> = {};
          for (const r of allResults) {
            if (r.success && r.nodeId) idMap[r.nodeId] = r.nodeId;
          }

          // Collect per-node warnings (props that silently failed to apply)
          const allWarnings = allResults
            .filter(r => r.warnings && r.warnings.length > 0)
            .map(r => ({ nodeId: r.nodeId, warnings: r.warnings }));

          const receipt: Record<string, any> = { edited: editedCount, idMap };
          if (allWarnings.length > 0) {
            receipt.warnings = allWarnings.slice(0, 15);
            receipt.warningCount = allWarnings.reduce((sum, w) => sum + w.warnings.length, 0);
          }
          if (editAnomalies && editAnomalies.length > 0) {
            receipt.anomalies = editAnomalies.slice(0, 5);
          }

          if (failedResults.length > 0) {
            receipt.failed = failedResults.length;
            receipt.errors = failedResults.slice(0, 8).map(r => ({
              op: r.nodeId || '?',
              error: r.error || 'unknown',
            }));
            response = {
              success: false,
              error: {
                code: 'APPLY_ERROR',
                message: `Failed to edit ${failedResults.length} node(s). ${editedCount} succeeded.${allWarnings.length > 0 ? ` ${receipt.warningCount} property warning(s) on ${allWarnings.length} node(s).` : ''}`,
              },
              data: receipt,
            };
          } else {
            response = { success: true, data: receipt };
          }
        } catch (e: any) {
          response = {
            success: false,
            error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error in edit pipeline' }
          };
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
