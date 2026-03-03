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

import { ActionExecutor } from '../../engine/actions/executor';
import { FigmaAction } from '../../engine/actions/types';
import { operationsToParsedLines } from '../../engine/actions/operationAdapter';
import { ActionCompiler } from '../../engine/actions/compiler';
import { IncrementalExecutor } from '../../engine/actions/incrementalExecutor';
import { collectTreeAnomalies } from '../../engine/validation/postOpValidator';
import { logger } from '../../utils/logger';

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

  logger.info(`Tool Call: ${toolName}`, { parameters, requestId });

  let response: ToolResponse;

  try {
    switch (toolName) {
      // ==========================================
      // UNIFIED TOOLS — 7-primitive API
      // ==========================================

      case 'read_node': {
        const { mode: readMode, nodeId: readNodeId, depth: readDepth } = parameters;

        switch (readMode) {
          case 'selection': {
            const selection = nodeLayoutService.getSelection();
            response = { success: true, data: selection };
            break;
          }
          case 'hierarchy': {
            const hResolved = await resolveSceneNode(readNodeId);
            if (!hResolved.ok) { response = hResolved.response; break; }
            const hNode = hResolved.node;
            const hSerialized = NodeSerializer.serializeWithCompression(hNode, {
              maxDepth: Math.min(readDepth || 5, 10),
              pruneDefaults: false
            });
            const anomalies = collectTreeAnomalies(hNode, Math.min(readDepth || 5, 10));
            response = {
              success: true,
              data: {
                ...hSerialized,
                anomalies: anomalies.length > 0 ? anomalies : undefined
              }
            };
            break;
          }
          case 'node': {
            const nResolved = await resolveSceneNode(readNodeId);
            if (!nResolved.ok) { response = nResolved.response; break; }
            const nSerialized = NodeSerializer.serialize(nResolved.node);
            response = { success: true, data: nSerialized };
            break;
          }
          default:
            response = { success: false, error: { code: 'INVALID_MODE', message: `read_node mode '${readMode}' is not valid. Use 'selection', 'hierarchy', or 'node'.` } };
        }
        break;
      }

      case 'build_design': {
        const { operations, parentId: bdParentId, onError: bdOnError = 'continue', rollbackMode = 'none' } = parameters;

        if (!operations || !Array.isArray(operations) || operations.length === 0) {
          response = {
            success: false,
            error: { code: 'EMPTY_OPERATIONS', message: 'The operations parameter must be a non-empty array.' }
          };
          break;
        }

        try {
          // 1. Convert operations to ParsedLines
          const parsedLines = operationsToParsedLines(operations);

          // 2. Compile: convert ParsedLines to FigmaActions
          const compiler = new ActionCompiler();
          const { actions, errors } = compiler.compile(parsedLines, bdParentId);

          // 3. Execute incrementally
          const bdExecutor = new IncrementalExecutor();
          const bdResult = await bdExecutor.execute(actions, errors, {
            onError: bdOnError,
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
            error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error in build_design pipeline' }
          };
        }
        break;
      }

      case 'patch_node': {
        const { patches, stepId: _patchStepId } = parameters;

        const patchActions: FigmaAction[] = patches.map((patch: any) => ({
          action: 'updateProps' as const,
          nodeId: patch.nodeId,
          props: patch.props || {}
        }));

        const executor = new ActionExecutor({ onError: 'skip-dependents' });
        const execResult = await executor.execute(patchActions);

        const failedResults = execResult.results.filter(r => !r.success);

        const allWarnings: any[] = [];
        execResult.results.forEach(r => {
           if (r.warnings && r.warnings.length > 0) {
               r.warnings.forEach((w: any) => {
                   allWarnings.push({
                       ...w,
                       nodeId: r.nodeId || ('nodeId' in r.action ? r.action.nodeId : undefined)
                   });
               });
           }
        });

        // Inline post-op validation on patched nodes
        let patchAnomalies: any[] | undefined;
        const patchRootId = patches[0]?.nodeId;
        if (patchRootId) {
          const patchResolved = await resolveSceneNode(patchRootId);
          if (patchResolved.ok) {
            const found = collectTreeAnomalies(patchResolved.node, 3);
            if (found.length > 0) patchAnomalies = found;
          }
        }

        if (!execResult.success && failedResults.length > 0) {
          const firstFailure = failedResults[0];
          const errorContext = firstFailure.errorContext;
          const retryTried = errorContext ? errorContext.retryTried : false;
          const subCategory = errorContext ? errorContext.subCategory : 'UNKNOWN';
          const failedNodeId = firstFailure.nodeId || ('nodeId' in firstFailure.action ? firstFailure.action.nodeId : undefined);

          response = {
            success: false,
            error: {
              code: 'ACTION_FAILED',
              message: `Failed to patch nodes: ${firstFailure.error}. subCategory: ${subCategory}, retryTried: ${retryTried}. See data.firstFailure for details.`
            },
            data: {
              results: execResult.results,
              firstFailure: {
                nodeId: failedNodeId,
                action: firstFailure.action.action,
                error: firstFailure.error,
                subCategory,
                failedNodeId: errorContext?.failedNodeId || failedNodeId,
                retryTried
              },
              failureCount: failedResults.length,
              failureActionIds: failedResults.map(r => r.nodeId || ('nodeId' in r.action ? r.action.nodeId : undefined)),
              warnings: allWarnings.length > 0 ? allWarnings : undefined,
              anomalies: patchAnomalies
            }
          };
        } else {
          response = {
            success: execResult.success,
            data: {
              results: execResult.results,
              warnings: allWarnings.length > 0 ? allWarnings : undefined,
              anomalies: patchAnomalies
            }
          };
        }
        break;
      }

      case 'delete_node': {
        response = await nodeLayoutService.deleteNode(parameters.nodeId);
        break;
      }

      case 'capture_screenshot': {
        const { nodeId: csNodeId, scale: csScale, format: csFormat } = parameters;
        const csResolved = await resolveSceneNode(csNodeId);
        if (!csResolved.ok) { response = csResolved.response; break; }
        const csNode = csResolved.node;

        if (!csNode.visible) {
          response = { success: false, error: { code: 'EXPORT_FAILED', message: `Node ${csNodeId} is not visible.` } };
          break;
        }
        const csWidth = csNode.width;
        const csHeight = csNode.height;
        if (csWidth === 0 || csHeight === 0) {
          response = { success: false, error: { code: 'EXPORT_FAILED', message: `Node ${csNodeId} has zero dimensions (${csWidth}x${csHeight}).` } };
          break;
        }

        try {
          const exportFormat = (csFormat === 'png' ? 'PNG' : 'JPG') as 'PNG' | 'JPG';
          const exportScale = Math.min(Math.max(csScale || 1, 0.5), 2);
          const bytes = await csNode.exportAsync({
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

          response = {
            success: true,
            data: {
              nodeId: csNodeId,
              width: Math.round(csWidth * exportScale),
              height: Math.round(csHeight * exportScale),
              format: exportFormat.toLowerCase(),
              sizeBytes: bytes.length,
              __image: { mimeType, data: base64 }
            }
          };
        } catch (exportErr: any) {
          response = { success: false, error: { code: 'EXPORT_FAILED', message: exportErr?.message || 'exportAsync failed' } };
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
