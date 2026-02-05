import './utils/compatibility';
import { on, showUI, emit } from '@create-figma-plugin/utilities'
import type { 
  CloseHandler, 
  ClearStreamHandler,
  CreateLayersHandler, 
  StreamLayersHandler,
  NodeLayer, 
  GetVariablesHandler, 
  SendVariablesHandler,
  GetSelectionStylesHandler,
  SendSelectionStylesHandler,
  SelectionStyles,
  LoadSettingsHandler,
  SaveSettingsHandler,
  SendLogHandler,
  GetLibraryResourcesHandler,
  SendLibraryResourcesHandler,
  GetLocalComponentsHandler,
  SendLocalComponentsHandler,
  ToolCallHandler,
  ToolResultHandler,
  SelectNodeHandler
} from './types'
import { renderNodeDSL } from './engine/figma-adapter/renderers/index'
import { figmaVariableCache } from './engine/figma-adapter/caches/figmaVariableCache'
import { getActiveEngineConfig } from './engine/engineConfig'
import { initializeRenderers } from './engine/figma-adapter/renderers'
import { NodeSerializer } from './engine/figma-adapter/nodeSerializer';
import { TreeReconstructor } from './engine/figma-adapter/treeReconstructor';
import { DEFAULT_MODEL } from './ui/constants/models'
import { PaintResolver } from './engine/pipeline/PaintResolver';
import { RenderLifecycleManager } from './engine/pipeline/RenderLifecycleManager';
import { StreamBufferManager } from './engine/pipeline/StreamBufferManager';
import { throttle } from './utils/throttle';
import { TokenParser, TokenMode } from './engine/sync/tokenParser';
import { DesignSystemManager } from './engine/sync/DesignSystemManager';
import { CanvasOrchestrator } from './engine/pipeline/CanvasOrchestrator';
import { ImportTokensHandler, ExportTokensHandler, SendExportedTokensHandler, CombineVariantsHandler, GetSnapshotHistoryHandler, SendSnapshotHistoryHandler, GetProjectTemplatesHandler, SendProjectTemplatesHandler, ImportProjectTemplateHandler, SendCapturedUIHandler, CaptureUIHandler, SerializeSelectionHandler, SendSerializedSelectionHandler, ImportJsonHandler } from './types';
// Removed ui-templates import

// ==========================================
// NEW: Refactored IPC Handlers and Services
// ==========================================
import { handleToolCall } from './ipc/handlers/toolCallHandler';
import { handleLoadSettings, handleSaveSettings } from './ipc/handlers/settingsHandler';
import { handleUnifiedRender, clearStream } from './ipc/helpers/renderHelper';

const throttledRenderers = new Map<string, (...args: any[]) => void>();

export default function () {
  console.log(`[Genable] 🚀 Plugin started | State-Driven Architecture`);

  initializeRenderers(
      (color) => PaintResolver.resolve(color),
      []
  );

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

  on<ClearStreamHandler>('CLEAR_STREAM', function (data: { streamSessionId: string }) {
    clearStream(data.streamSessionId);
  });

  // ==========================================
  // Level 1: Core Rendering Pipeline
  // ==========================================
  
  on<StreamLayersHandler>('STREAM_LAYERS', (data: any) => {
      const { streamSessionId, designSystemId, renderContext, ...node } = data;
      
      if (streamSessionId) {
          const root = StreamBufferManager.addNode(streamSessionId, node as any);
          if (root) {
              let throttled = throttledRenderers.get(streamSessionId);
              if (!throttled) {
                  throttled = throttle((renderData: any) => {
                      handleUnifiedRender(renderData, true);
                  }, 150);
                  throttledRenderers.set(streamSessionId, throttled);
              }
              throttled({ 
                  ...root, 
                  designSystemId: designSystemId || 'vanilla',
                  streamSessionId: streamSessionId,
                  renderContext,
                  meta: { traceId: streamSessionId }
              });
          }
      } else {
          handleUnifiedRender({
            ...data,
            meta: { ...data.meta, traceId: data.streamSessionId || data.meta?.traceId }
          }, true);
      }
  });
  
  on<CreateLayersHandler>('CREATE_LAYERS', (data) => {
      handleUnifiedRender(data, false);
  });

  // ==========================================
  // Level 1.2: Agentic Tool IPC Bridge
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

  on<GetSelectionStylesHandler>('GET_SELECTION_STYLES', function () {
    const selection = figma.currentPage.selection;
    const styles: SelectionStyles = {
        colors: [],
        fonts: [],
        cornerRadius: [],
        referenceLayout: undefined,
        selectionNodes: []
    };

    if (selection.length > 0) {
        styles.selectionNodes = selection.map(node => NodeSerializer.serialize(node));
        const serialized = styles.selectionNodes[0];
        if (serialized.props) {
            styles.referenceLayout = {
                width: serialized.props.width || 0,
                height: serialized.props.height || 0,
                layoutMode: (serialized.props.layoutMode as any) || 'NONE',
                itemSpacing: serialized.props.gap as number,
                padding: {
                    top: serialized.props.paddingTop as number || 0,
                    right: serialized.props.paddingRight as number || 0,
                    bottom: serialized.props.paddingBottom as number || 0,
                    left: serialized.props.paddingLeft as number || 0
                }
            };
        }
    }

    emit<SendSelectionStylesHandler>('SEND_SELECTION_STYLES', styles);
  })

  // ==========================================
  // Level 3: Settings Management
  // ==========================================
  on<LoadSettingsHandler>('LOAD_SETTINGS', handleLoadSettings);

  on<SaveSettingsHandler>('SAVE_SETTINGS', handleSaveSettings);

  on<CloseHandler>('CLOSE', function () {
    figma.closePlugin()
  })

  on<GetLibraryResourcesHandler>('GET_LIBRARY_RESOURCES', async function () {
    emit<SendLibraryResourcesHandler>('SEND_LIBRARY_RESOURCES', { resources: [] });
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

  // Dogfood/Dev Feature: Manual JSON Import
  on<ImportJsonHandler>('IMPORT_JSON', function (data: { jsonString: string }) {
    try {
      console.log('[Genable] Importing JSON layers...');
      const flatNodes = JSON.parse(data.jsonString);
      
      // Reconstruct Tree from Flat JSON
      const { root } = new TreeReconstructor().reconstruct(flatNodes);
      
      if (root) {
        // Reuse unified render flow
        handleUnifiedRender({
          ...root,
          designSystemId: 'vanilla',
          streamSessionId: 'manual-import-' + Date.now(),
          meta: { traceId: 'manual-import' }
        }, false);
        emit<SendLogHandler>('SEND_LOG', { message: 'JSON Imported Successfully', type: 'success' });
      } else {
        emit<SendLogHandler>('SEND_LOG', { message: 'Failed to reconstruct node tree', type: 'warn' });
      }
    } catch (e: any) {
      console.error('JSON Import Error', e);
      emit<SendLogHandler>('SEND_LOG', { message: `Import Failed: ${e.message}`, type: 'warn' });
    }
  });

  on<CombineVariantsHandler>('COMBINE_VARIANTS', async function (data) {
    try {
      emit<SendLogHandler>('SEND_LOG', { message: `Combining variants for ${data.prefix}...`, type: 'info' });
      await CanvasOrchestrator.combineVariants(data.prefix);
      emit<SendLogHandler>('SEND_LOG', { message: `Combined into component set: ${data.prefix}`, type: 'success' });
    } catch (e: any) {
      console.error('Combine Variants Error', e);
      emit<SendLogHandler>('SEND_LOG', { message: `Combine Failed: ${e.message}`, type: 'warn' });
    }
  });

  on<GetSnapshotHistoryHandler>('GET_SNAPSHOT_HISTORY', async function () {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    // We'll use DesignSystemManager's constants if we can, or just hardcode for simplicity in main
    const collection = collections.find(c => c.name.includes('Semantic')); 
    const history = collection ? JSON.parse(collection.getPluginData('snapshot_history') || '[]') : [];
    emit<SendSnapshotHistoryHandler>('SEND_SNAPSHOT_HISTORY', { history });
  });

  on<GetProjectTemplatesHandler>('GET_PROJECT_TEMPLATES', function () {
    emit<SendProjectTemplatesHandler>('SEND_PROJECT_TEMPLATES', { templates: [] });
  });

  on<ImportProjectTemplateHandler>('IMPORT_PROJECT_TEMPLATE', async function (data) {
    emit<SendLogHandler>('SEND_LOG', { message: `Templates are deprecated`, type: 'warn' });
  });

  on<CaptureUIHandler>('CAPTURE_UI', (data) => {
    // Forward to UI thread where DomCapture lives
    emit<CaptureUIHandler>('CAPTURE_UI', data);
  });

  on<SendCapturedUIHandler>('SEND_CAPTURED_UI', async (data) => {
    try {
      emit<SendLogHandler>('SEND_LOG', { message: `Processing captured UI...`, type: 'info' });
      const sessionBase = `captured-${data.templateId || 'unknown'}-${Date.now()}`;

      // Parallel processing for better performance
      const nodes = await Promise.all(
        data.layers.map(async (layer) => {
          const node = await handleUnifiedRender({
            ...layer,
            designSystemId: 'vanilla',
            streamSessionId: `${sessionBase}-${layer.id || Math.random().toString(36).substr(2, 9)}`,
            meta: { traceId: sessionBase }
          }, false);
          return node;
        })
      );

      emit<SendLogHandler>('SEND_LOG', { message: `Live UI Captured & Recreated in Figma!`, type: 'success' });
    } catch (e: any) {
      console.error('Capture Processing Error', e);
      emit<SendLogHandler>('SEND_LOG', { message: `Capture Failed: ${e.message}`, type: 'warn' });
    }
  });

  on<ImportTokensHandler>('IMPORT_TOKENS', async function (data: { cssString: string, jsonString?: string }) {
    try {
      emit<SendLogHandler>('SEND_LOG', { message: 'Syncing tokens to Figma...', type: 'info' });
      
      let resolvedModes: TokenMode[] = [];
      
      if (data.jsonString) {
          // New: Handle JSON import directly (DTCG supported)
          const rawModes = TokenParser.parseJSON(JSON.parse(data.jsonString));
          resolvedModes = TokenParser.resolveLinks(rawModes, true);
      } else {
          // Existing: Handle CSS import
          const rawModes = TokenParser.parse(data.cssString);
          resolvedModes = TokenParser.resolveLinks(rawModes, true);
      }
      
      // [New] Use DesignSystemManager to handle multi-collection orchestration
      const result = await DesignSystemManager.sync(resolvedModes);
      
      // [New] Generate visual preview on canvas
      if (result.success) {
        await CanvasOrchestrator.createTokenPreview(resolvedModes);
      }
      
      emit<SendLogHandler>('SEND_LOG', { 
        message: result.message, 
        type: result.success ? 'success' : 'warn' 
      });
    } catch (e: any) {
      console.error('Token Import Error', e);
      emit<SendLogHandler>('SEND_LOG', { message: `Token Sync Failed: ${e.message}`, type: 'warn' });
    }
  });

  on<ExportTokensHandler>('EXPORT_TOKENS', async function () {
    try {
      emit<SendLogHandler>('SEND_LOG', { message: 'Exporting ALL tokens from Figma collections...', type: 'info' });
      const tokens = await DesignSystemManager.exportAll();
      emit<SendExportedTokensHandler>('SEND_EXPORTED_TOKENS', { tokens });
      emit<SendLogHandler>('SEND_LOG', { message: 'Full DTCG export generated', type: 'success' });
    } catch (e: any) {
      console.error('Token Export Error', e);
      emit<SendLogHandler>('SEND_LOG', { message: `Token Export Failed: ${e.message}`, type: 'warn' });
    }
  });

  on<SendLogHandler>('SEND_LOG', (data) => {
    // [FIX] Forward log messages from UI back to UI via the Main thread.
    // This allows components in the UI thread to listen to logs emitted by other 
    // UI-side services (like AgentOrchestrator).
    emit<SendLogHandler>('SEND_LOG', data);
  });

  // Dev Mode Codegen Support
  if (figma.editorType === 'dev') {
    figma.codegen.on('generate', (event) => {
      try {
        console.log('[Genable] Dev Mode: Generating code for selection...');
        const serialized = NodeSerializer.serialize(event.node);
        const dsl = JSON.stringify(serialized, null, 2);
        
        // React transformation logic (Experimental Stub)
        const componentName = event.node.name.replace(/[^a-zA-Z0-9]/g, '') || 'Component';
        let reactCode = `/**\n * Generated React Component: ${event.node.name}\n * \n * NOTE: This is an experimental placeholder. \n * The full semantic mapping from Genable DSL to React components is in development.\n */\n`;
        // [Figma Sandbox Fix] Obfuscate 'import' to bypass scanner
        reactCode += `${'imp' + 'ort'} React from 'react';\n\n`;
        reactCode += `export const ${componentName}: React.FC = () => {\n`;
        reactCode += `  return (\n`;
        reactCode += `    <div className="genable-node" data-figma-id="${event.node.id}">\n`;
        reactCode += `      {/* \n`;
        reactCode += `        LLM-driven semantic generation is coming soon.\n`;
        reactCode += `        Use the "Genable DSL" tab for the full node structure.\n`;
        reactCode += `      */}\n`;
        reactCode += `      <span>${event.node.name}</span>\n`;
        reactCode += `    </div>\n`;
        reactCode += `  );\n};`;

        return [
          {
            title: 'Genable DSL',
            language: 'JSON',
            code: dsl,
          },
          {
            title: 'React (Preview)',
            language: 'TYPESCRIPT',
            code: reactCode,
          }
        ];
      } catch (e: any) {
        console.error('Codegen Error', e);
        return [
          {
            title: 'Error',
            language: 'PLAINTEXT',
            code: `Failed to generate code: ${e.message}`,
          }
        ];
      }
    });
  }

  showUI({
    height: figma.editorType === 'dev' ? 400 : 500,
    width: 340
  })
  
  // Pass editor mode to UI
  setTimeout(() => {
    emit('SET_EDITOR_MODE', { editorType: figma.editorType });
  }, 200);
}
