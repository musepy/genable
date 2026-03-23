import './utils/compatibility';
import { on, showUI, emit } from '@create-figma-plugin/utilities'
import {
  CloseHandler,
  GetVariablesHandler,
  SendVariablesHandler,
  LoadSettingsHandler,
  SaveSettingsHandler,
  SendLogHandler,
  ResizeHandler,
  GetLocalComponentsHandler,
  SendLocalComponentsHandler,
  ToolCallHandler,
  SelectNodeHandler,
  GetSelectionHandler,
  SendSelectionHandler
} from './types'
import { WINDOW_WIDTH, getIdealHeight } from './ui/constants/layout'

import { NodeSerializer } from './engine/figma-adapter/nodeSerializer';
import { SerializeSelectionHandler, DevBridgeExportHandler } from './types';
import { serializeCurrentPage } from './dev/nodeTreeSerializer';

// ==========================================
// IPC Handlers and Services
// ==========================================
import { handleToolCall } from './ipc/handlers/toolCallHandler';
import { handleLoadSettings, handleSaveSettings, handleResetSettings } from './ipc/handlers/settingsHandler';

export default async function () {
  console.log('[Genable] Plugin started');

  function getNodeCenter(node: SceneNode) {
    // Use any cast to avoid complex type narrowing issues with SceneNode subtypes
    const bounds = (node as any).absoluteBoundingBox || (node as any).absoluteRenderBounds || null;
    
    if (!bounds) return figma.viewport.center;
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  async function smoothPanTo(target: { x: number; y: number }, durationMs = 250, steps = 8) {
    const start = figma.viewport.center;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // easeOutQuad
      const eased = 1 - Math.pow(1 - t, 2);
      figma.viewport.center = {
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased
      };
      await new Promise(r => setTimeout(r, durationMs / steps));
    }
  }

  on<SelectNodeHandler>('SELECT_NODE', async (data) => {
    const { nodeId, smooth = true, durationMs = 250 } = data;
    const node = await figma.getNodeByIdAsync(nodeId) as SceneNode | null;
    if (!node) {
      emit<SendLogHandler>('SEND_LOG', { message: `Node ${nodeId} not found`, type: 'warn' });
      return;
    }

    figma.currentPage.selection = [node];

    if (!smooth) {
      figma.viewport.scrollAndZoomIntoView([node]);
      return;
    }

    const target = getNodeCenter(node);
    await smoothPanTo(target, durationMs, 8);
  });

  on<GetSelectionHandler>('GET_SELECTION', function () {
    const selection = figma.currentPage.selection.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
    }));
    emit<SendSelectionHandler>('SEND_SELECTION', { selection });
  });

  // ==========================================
  // Level 1: Agentic Tool IPC Bridge
  // ==========================================

  on<ToolCallHandler>('TOOL_CALL', async (data) => {
    await handleToolCall(data as any);
  });

  // ==========================================
  // Level 2: Variable & Style Sync
  // ==========================================
  on<GetVariablesHandler>('GET_VARIABLES', async function () {
    try {
      if (figma.variables) {
        const vars = await figma.variables.getLocalVariablesAsync();
        const names = vars.map(v => v.name);
        emit<SendVariablesHandler>('SEND_VARIABLES', { names });
      } else {
        emit<SendVariablesHandler>('SEND_VARIABLES', { names: [] });
      }
    } catch (e) {
      console.error('Error getting variables', e);
      emit<SendVariablesHandler>('SEND_VARIABLES', { names: [] });
    }
  })

  // ==========================================
  // Level 3: Settings Management
  // ==========================================
  on<LoadSettingsHandler>('LOAD_SETTINGS', handleLoadSettings);

  on<SaveSettingsHandler>('SAVE_SETTINGS', handleSaveSettings);

  on<import('./types').ResetSettingsHandler>('RESET_SETTINGS', handleResetSettings);

  on<CloseHandler>('CLOSE', function () {
    figma.closePlugin()
  })



  on<GetLocalComponentsHandler>('GET_LOCAL_COMPONENTS', async function () {
    const localComponents = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
    const componentsData = localComponents.map(c => ({
        key: c.key,
        name: c.name,
        description: c.description,
        type: c.type as any,
        isLibrary: false
    }));
    emit<SendLocalComponentsHandler>('SEND_LOCAL_COMPONENTS', { components: componentsData });
  })

  // ==========================================
  // Dogfooding: Figma to Code Serialization
  // ==========================================
  on<SerializeSelectionHandler>('SERIALIZE_SELECTION', function () {
    try {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        emit<SendLogHandler>('SEND_LOG', { message: 'No selection to serialize', type: 'warn' });
        return;
      }
      
      console.log('[Dogfood] Serializing selection...');
      const serializedNodes = selection.map(node => NodeSerializer.serialize(node));
      const jsonString = JSON.stringify(serializedNodes, null, 2);
      
      emit<import('./types').SendSerializedSelectionHandler>('SEND_SERIALIZED_SELECTION', { jsonString });
      emit<SendLogHandler>('SEND_LOG', { message: 'Selection serialized to DSL', type: 'success' });
    } catch (e: any) {
      console.error('Serialization Error', e);
      emit<SendLogHandler>('SEND_LOG', { message: `Serialization Failed: ${e.message}`, type: 'warn' });
    }
  });



  // ==========================================
  // Dev Bridge: Export node tree + screenshot
  // ==========================================
  on<DevBridgeExportHandler>('DEV_BRIDGE_EXPORT', async function ({ rootNodeIds }) {
    try {
      const nodeTree = serializeCurrentPage();
      const exportOpts = { format: 'PNG' as const, constraint: { type: 'SCALE' as const, value: 2 } };

      // Collect all root nodes for per-node screenshots
      const nodes: Array<{ node: SceneNode; id: string; name: string; area: number }> = [];
      if (rootNodeIds && rootNodeIds.length > 0) {
        for (const id of rootNodeIds) {
          const node = await figma.getNodeByIdAsync(id) as SceneNode | null;
          if (node && 'width' in node && 'height' in node) {
            nodes.push({ node, id, name: node.name, area: node.width * node.height });
          }
        }
      }
      // Fallback: last top-level node on the page
      if (nodes.length === 0) {
        const topNodes = figma.currentPage.children;
        if (topNodes.length > 0) {
          const last = topNodes[topNodes.length - 1];
          nodes.push({ node: last, id: last.id, name: last.name, area: ('width' in last ? last.width * last.height : 0) });
        }
      }

      // Screenshot every root node
      const screenshots: Array<{ nodeId: string; name: string; base64: string }> = [];
      for (const { node, id, name } of nodes) {
        try {
          const bytes = await node.exportAsync(exportOpts);
          screenshots.push({ nodeId: id, name, base64: figma.base64Encode(bytes) });
        } catch (e: any) {
          console.warn(`[DevBridge] Screenshot export failed for ${id}:`, e.message);
        }
      }

      emit<import('./types').DevBridgeExportResultHandler>('DEV_BRIDGE_EXPORT_RESULT', {
        nodeTree,
        screenshots,
      });
    } catch (e: any) {
      console.error('[DevBridge] Export failed:', e);
      emit<import('./types').DevBridgeExportResultHandler>('DEV_BRIDGE_EXPORT_RESULT', {
        nodeTree: null,
        screenshots: [],
      });
    }
  });

  on<ResizeHandler>('RESIZE', (data) => {
    figma.ui.resize(WINDOW_WIDTH, data.height);
  });

  on<SendLogHandler>('SEND_LOG', (data) => {
    // [FIX] Forward log messages from UI back to UI via the Main thread.
    // This allows components in the UI thread to listen to logs emitted by other 
    // UI-side services (like AgentOrchestrator).
    emit<SendLogHandler>('SEND_LOG', data);
  });



  showUI({
    height: getIdealHeight(),
    width: WINDOW_WIDTH
  });
  
  // Pass editor mode to UI
  emit('SET_EDITOR_MODE', { editorType: figma.editorType });
}
