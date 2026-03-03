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
import { tokenizeLines, parseLine } from '../../engine/actions/parsing';
import { ActionCompiler } from '../../engine/actions/compiler';
import { IncrementalExecutor } from '../../engine/actions/incrementalExecutor';
import { validatePostOp, collectTreeAnomalies } from '../../engine/validation/postOpValidator';
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
 * Routes to the 7 unified tool implementations.
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
          case 'variables': {
            // Use Figma API to get local variables
            const localVars = typeof figma !== 'undefined' && figma.variables
              ? await figma.variables.getLocalVariablesAsync()
              : [];
            const varsSerialized = localVars.map((v: any) => ({
              id: v.id,
              name: v.name,
              resolvedType: v.resolvedType,
            }));
            response = { success: true, data: varsSerialized };
            break;
          }
          case 'styles': {
            const localStyles = await figma.getLocalPaintStylesAsync();
            const stylesSerialized = localStyles.map(s => ({
              id: s.id,
              name: s.name,
              paints: s.paints
            }));
            response = { success: true, data: stylesSerialized };
            break;
          }
          default:
            response = { success: false, error: { code: 'INVALID_MODE', message: `read_node mode '${readMode}' is not valid. Use 'selection', 'hierarchy', 'node', 'variables', or 'styles'.` } };
        }
        break;
      }

      case 'build_design': {
        const { instructions, parentId: bdParentId, onError: bdOnError = 'continue', rollbackMode = 'none' } = parameters;

        if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
          response = {
            success: false,
            error: { code: 'EMPTY_INSTRUCTIONS', message: 'The instructions parameter must be a non-empty string.' }
          };
          break;
        }

        try {
          // 1. Tokenize: split instruction text into logical lines
          const tokenizedLines = tokenizeLines(instructions);

          if (tokenizedLines.length === 0) {
            response = {
              success: true,
              data: {
                success: true,
                hasErrors: false,
                idMap: {},
                lineResults: [],
                stats: { total: 0, created: 0, failed: 0, skipped: 0, warnings: 0 }
              }
            };
            break;
          }

          // 2. Parse: convert each line into a structured ParsedLine
          const parsedLines = tokenizedLines.map(line => parseLine(line));

          // 3. Compile: convert ParsedLines to FigmaActions
          const compiler = new ActionCompiler();
          const { actions, errors } = compiler.compile(parsedLines, bdParentId);

          // 4. Execute incrementally
          const bdExecutor = new IncrementalExecutor();
          const bdResult = await bdExecutor.execute(actions, errors, {
            onError: bdOnError,
            rollbackMode,
            parentId: bdParentId,
          });

          response = {
            success: bdResult.success,
            data: bdResult,
            error: bdResult.hasErrors
              ? {
                  code: 'PARTIAL_FAILURE',
                  message: `${bdResult.stats.failed} of ${bdResult.stats.total} lines failed. ${bdResult.stats.created} nodes created successfully. Use idMap to reference existing nodes and fix only the failed lines.`
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
              warnings: allWarnings.length > 0 ? allWarnings : undefined
            }
          };
        } else {
          response = {
            success: execResult.success,
            data: {
              results: execResult.results,
              warnings: allWarnings.length > 0 ? allWarnings : undefined
            }
          };
        }
        break;
      }

      case 'delete_node': {
        response = await nodeLayoutService.deleteNode(parameters.nodeId);
        break;
      }

      case 'validate_design': {
        const valResolved = await resolveSceneNode(parameters.nodeId);
        if (!valResolved.ok) { response = valResolved.response; break; }
        const valNode = valResolved.node;
        const valResult = validatePostOp(valNode, {});
        const anomalyResult = collectTreeAnomalies(valNode, 5);
        response = {
          success: true,
          data: {
            valid: valResult.length === 0 && anomalyResult.length === 0,
            issues: valResult.length > 0 ? valResult : undefined,
            anomalies: anomalyResult.length > 0 ? anomalyResult : undefined
          }
        };
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

          // Uint8Array → base64 (Figma main thread has no Buffer)
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
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
