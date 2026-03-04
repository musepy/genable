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

export interface ToolCallData {
  toolName: string;
  parameters: any;
  context?: ToolContext;
  requestId: string;
}

// ── Backward compatibility: old tool names → new names ──

const TOOL_ALIASES: Record<string, string> = {
  build_design: 'create',
  read_node: 'read',
  patch_node: 'edit',
  delete_node: 'edit',
  capture_screenshot: 'read',
};

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

  // Tool Name Normalization (Handle LLM Typos/Hallucinations)
  const normalizedName = toolName.replace(/-([a-z])/g, (g: string) => g[1].toUpperCase());
  if (normalizedName !== toolName) {
    logger.info(`Normalizing tool name: ${toolName} -> ${normalizedName}`);
    toolName = normalizedName;
  }

  // Backward compatibility: alias old tool names to new ones
  const alias = TOOL_ALIASES[toolName];
  if (alias) {
    logger.info(`Tool alias: ${toolName} -> ${alias}`);
    toolName = alias;
  }

  logger.info(`Tool Call: ${toolName}`, { parameters, requestId });

  let response: ToolResponse;

  try {
    switch (toolName) {
      // ==========================================
      // UNIFIED TOOLS — 4-primitive API
      // ==========================================

      case 'read': {
        const { nodeId: readNodeId, depth: readDepth, screenshot: wantScreenshot } = parameters;

        const resolved = await resolveSceneNode(readNodeId);
        if (!resolved.ok) { response = resolved.response; break; }
        const readNode = resolved.node;

        const hSerialized = NodeSerializer.serializeWithCompression(readNode, {
          maxDepth: Math.min(readDepth || 5, 10),
          pruneDefaults: true
        });
        const xml = XmlSerializer.serialize(hSerialized, {
          maxDepth: Math.min(readDepth || 5, 10),
        });
        const anomalies = collectTreeAnomalies(readNode, Math.min(readDepth || 5, 10));
        const data: any = {
          xml,
          anomalies: anomalies.length > 0 ? anomalies : undefined
        };

        // Bundle screenshot if requested
        if (wantScreenshot && readNode.visible && readNode.width > 0 && readNode.height > 0) {
          try {
            const ssResult = await exportNodeToBase64(readNode);
            data.__image = ssResult.__image;
          } catch (e: any) {
            logger.info(`Screenshot bundling failed for ${readNodeId}: ${e?.message}`);
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

          response = {
            success: bdResult.success,
            data: { ...bdResult, anomalies: bdAnomalies },
            error: bdResult.hasErrors
              ? {
                  code: 'PARTIAL_FAILURE',
                  message: `${bdResult.stats.failed} of ${bdResult.stats.total} operations failed. ${bdResult.stats.created} nodes created successfully. Use idMap to reference existing nodes and fix only the failed operations.`
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

          if (failedResults.length > 0) {
            const firstFailure = failedResults[0];
            response = {
              success: false,
              error: {
                code: 'APPLY_ERROR',
                message: `Failed to edit ${failedResults.length} node(s): ${firstFailure.error || 'unknown error'}`
              },
              data: {
                results: allResults,
                anomalies: editAnomalies
              }
            };
          } else {
            response = {
              success: true,
              data: {
                results: allResults,
                anomalies: editAnomalies
              }
            };
          }
        } catch (e: any) {
          response = {
            success: false,
            error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error in edit pipeline' }
          };
        }
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
