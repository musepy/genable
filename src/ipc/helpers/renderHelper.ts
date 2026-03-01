/**
 * @file renderHelper.ts
 * @description Helper for unified rendering operations.
 * 
 * [RESPONSIBILITY]: Encapsulate the unified render logic used by IPC handlers.
 * This is extracted from main.ts to separate concerns.
 */

import { NodeLayer } from '../../schema/layerSchema';
import { RenderLifecycleManager } from '../../engine/pipeline/RenderLifecycleManager';
import { StreamBufferManager } from '../../engine/pipeline/StreamBufferManager';
import { CanvasOrchestrator } from '../../engine/pipeline/CanvasOrchestrator';
import { getActiveEngineConfig } from '../../engine/engineConfig';
import { SendLogHandler } from '../../types';
import { emit } from '@create-figma-plugin/utilities';
import { DslToActionAdapter } from '../../engine/actions/dslAdapter';
import { ActionExecutor } from '../../engine/actions/executor';

// State management for streaming
const streamRoots = new Map<string, SceneNode>();

/**
 * Clear a stream session.
 */
export function clearStream(streamSessionId: string): void {
  const existing = streamRoots.get(streamSessionId);
  if (existing) {
    RenderLifecycleManager.safeRemove(existing);
    streamRoots.delete(streamSessionId);
  }
  StreamBufferManager.clear(streamSessionId);
}

/**
 * Get stream root node if exists.
 */
export function getStreamRoot(streamSessionId: string): SceneNode | undefined {
  return streamRoots.get(streamSessionId);
}

/**
 * Set stream root node.
 */
export function setStreamRoot(streamSessionId: string, node: SceneNode): void {
  streamRoots.set(streamSessionId, node);
}

/**
 * Delete stream root.
 */
export function deleteStreamRoot(streamSessionId: string): void {
  streamRoots.delete(streamSessionId);
}

/**
 * Unified render handler for both streaming and non-streaming operations.
 * This is the core rendering logic extracted from main.ts.
 */
export async function handleUnifiedRender(
  data: any,
  isStream: boolean,
  explicitParent?: (BaseNode & ChildrenMixin) | null
): Promise<SceneNode | null> {
  const {
    designSystemId,
    renderContext,
    streamSessionId,
    meta,
    __modifyMode,
    __modifyTargetId,
    ...layerData
  } = data;

  const currentStreamId = streamSessionId || meta?.replaceStreamSessionId;
  const existingStreamRoot = currentStreamId ? streamRoots.get(currentStreamId) : null;

  const placement = RenderLifecycleManager.resolvePlacement(
    (__modifyMode && __modifyTargetId) ? await figma.getNodeByIdAsync(__modifyTargetId) as SceneNode : null,
    existingStreamRoot as SceneNode,
    explicitParent
  );

  const activeConfig = getActiveEngineConfig(designSystemId);
  const traceId = streamSessionId || meta?.traceId || 'unified';

  // [Phase 3.5] Migrate legacy entries to ActionExecutor via Adapter
  let rootNode: SceneNode | null = null;
  const actions = DslToActionAdapter.convert(layerData as NodeLayer, placement.parent?.id);
  const executor = new ActionExecutor();
  const result = await executor.execute(actions);

  // Assume the first successful tempId -> realId is the root
  if (result.results.length > 0 && result.results[0].success) {
      rootNode = await figma.getNodeByIdAsync(result.results[0].nodeId!) as SceneNode;
  }

  if (rootNode) {
    if (existingStreamRoot && rootNode !== existingStreamRoot) {
      RenderLifecycleManager.safeRemove(existingStreamRoot);
    }

    if (isStream && streamSessionId) {
      streamRoots.set(streamSessionId, rootNode);
    } else if (!isStream) {
      if (meta?.replaceStreamSessionId) {
        streamRoots.delete(meta.replaceStreamSessionId);
        StreamBufferManager.clear(meta.replaceStreamSessionId);
      }
      // Zoom only for root-level generations
      if (!explicitParent) {
        figma.viewport.scrollAndZoomIntoView([rootNode]);
      }

      // [REMOVED] Implicitly forcing nodes into "📦 Components" or "📱 Pages" sections.
      // This was a hardcoded heuristic that interfered with LLM intent and caused crashes if sections were locked.
      // Organization should be explicit (e.g., via Tool Use or specialized flows like Token Preview).

      emit<SendLogHandler>('SEND_LOG', { message: `Generation Complete!`, type: 'success' });
    }
  }
  return rootNode;
}
