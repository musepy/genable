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
  SettingsLoadedHandler,
  SendLogHandler,
  Settings,
  GetLibraryResourcesHandler,
  SendLibraryResourcesHandler,
  GetLocalComponentsHandler,
  SendLocalComponentsHandler
} from './types'
import { figmaVariableCache } from './engine/figma-adapter/caches/figmaVariableCache'
import { getActiveEngineConfig } from './engine/engineConfig'
import { renderOrchestrator } from './engine/pipeline/RenderOrchestrator'
import { initializeRenderers } from './engine/figma-adapter/renderers'
import { NodeSerializer } from './engine/figma-adapter/nodeSerializer';
import { TreeReconstructor } from './engine/figma-adapter/treeReconstructor';
import { DEFAULT_MODEL } from './ui/constants/models'
import { PaintResolver } from './engine/pipeline/PaintResolver';
import { RenderLifecycleManager } from './engine/pipeline/RenderLifecycleManager';
import { StreamBufferManager } from './engine/pipeline/StreamBufferManager';
import { generateLayout } from './engine/llm-client/generator';
import { GenerationPhase } from './engine/llm-client/types';
import { throttle } from './utils/throttle';
import { TokenParser, TokenMode } from './engine/sync/tokenParser';
import { FigmaSync } from './engine/sync/figmaSync';
import { DesignSystemManager } from './engine/sync/DesignSystemManager';
import { CanvasOrchestrator } from './engine/pipeline/CanvasOrchestrator';
import { ImportTokensHandler, ExportTokensHandler, SendExportedTokensHandler, CombineVariantsHandler, GetSnapshotHistoryHandler, SendSnapshotHistoryHandler, GetProjectTemplatesHandler, SendProjectTemplatesHandler, ImportProjectTemplateHandler, SendCapturedUIHandler, CaptureUIHandler } from './types';
import { PROJECT_TEMPLATES } from './knowledge/ui-templates/registry';

const streamRoots = new Map<string, SceneNode>();
const throttledRenderers = new Map<string, (...args: any[]) => void>();

export default function () {
  console.log(`[Genable] 🚀 Plugin started | State-Driven Architecture`);

  initializeRenderers(
      (color) => PaintResolver.resolve(color),
      []
  );

  on<ClearStreamHandler>('CLEAR_STREAM', function (data: { streamSessionId: string }) {
    const existing = streamRoots.get(data.streamSessionId);
    if (existing) {
      RenderLifecycleManager.safeRemove(existing);
      streamRoots.delete(data.streamSessionId);
    }
    StreamBufferManager.clear(data.streamSessionId);
  });

  /**
   * Unified Generation Entry Point
   * Now driven by internal state.
   */
  async function generate(options: {
    apiKey: string,
    modelName: string,
    systemPrompt: string,
    userPrompt: string,
    designSystemId: string,
    sessionId: string,
    streaming?: boolean
  }) {
      try {
          const result = await generateLayout({
              ...options,
              onStateChange: (state: any) => {
                  // 1. Sync State Manager
                  StreamBufferManager.updateState(state.sessionId, state);
                  
                  // 2. Handle Progress Logging (UI Feedback)
                  if (state.progress) {
                      emit<SendLogHandler>('SEND_LOG', { 
                          message: state.progress, 
                          type: state.phase === GenerationPhase.ERROR ? 'warn' : 'info' 
                      });
                  }

                  // 3. Handle Streaming Render (Throttled Declarative Trigger)
                  const node = (state as any).node;
                  if (node) {
                      const root = StreamBufferManager.addNode(state.sessionId, node);
                      if (root) {
                          // Get or create throttled renderer for this session
                          // 150ms is a good balance between responsiveness and flicker reduction
                          let throttled = throttledRenderers.get(state.sessionId);
                          if (!throttled) {
                              throttled = throttle((data: any) => {
                                  handleUnifiedRender(data, true);
                              }, 150);
                              throttledRenderers.set(state.sessionId, throttled);
                          }

                          throttled({ 
                              ...root, 
                              designSystemId: options.designSystemId,
                              streamSessionId: state.sessionId 
                          });
                      }
                  }
              }
          });

          // Final Render for non-streaming or completion
          // Ensure we clear the throttled renderer for this session
          throttledRenderers.delete(options.sessionId);

          handleUnifiedRender({
              ...result.data,
              designSystemId: options.designSystemId,
              streamSessionId: options.sessionId
          }, false);

      } catch (error: any) {
          emit<SendLogHandler>('SEND_LOG', { message: `Error: ${error.message}`, type: 'warn' });
      }
  }

  /**
   * Internal Rendering Core
   */
  async function handleUnifiedRender(data: any, isStream: boolean): Promise<SceneNode | null> {
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
          (__modifyMode && __modifyTargetId) ? figma.getNodeById(__modifyTargetId) as SceneNode : null,
          existingStreamRoot as SceneNode
      );

      const activeConfig = getActiveEngineConfig(designSystemId);
      const traceId = streamSessionId || meta?.traceId || 'unified';

      const rootNode = await renderOrchestrator.process({
          layerData: layerData as NodeLayer,
          designSystemId,
          designSystemConfig: activeConfig,
          renderContext: renderContext,
          meta: { 
              traceId, 
              isStream, 
              position: placement.position,
              positionStrategy: placement.strategy as any,
              viewportCenter: figma.viewport.center,
              parent: placement.parent,
              insertIndex: placement.index
          }
      });

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
            figma.viewport.scrollAndZoomIntoView([rootNode]);

            // [New] Use CanvasOrchestrator to organize the canvas
            const intent = meta?.intent || (rootNode.name.toLowerCase().includes('page') ? 'PAGE' : 'COMPONENT');
            await CanvasOrchestrator.placeInSection(rootNode, intent as any);

            emit<SendLogHandler>('SEND_LOG', { message: `Generation Complete!`, type: 'success' });
          }
      }
      return rootNode;
  }

  // Simplified entry points mapping directly from UI events
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
      // Same here - handle it if it's already pre-parsed data, 
      // but usually the generation starts from LLM.
      handleUnifiedRender(data, false);
  });

  // [TODO]: Add on('START_GENERATION') for the new coordinated flow


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

  on<LoadSettingsHandler>('LOAD_SETTINGS', async function () {
    const apiKey = await figma.clientStorage.getAsync('GEMINI_API_KEY') || '';
    const modelName = await figma.clientStorage.getAsync('GEMINI_MODEL_NAME') || DEFAULT_MODEL;
    emit<SettingsLoadedHandler>('SETTINGS_LOADED', { apiKey, modelName });
  })

  on<SaveSettingsHandler>('SAVE_SETTINGS', async function (settings: Settings) {
    await figma.clientStorage.setAsync('GEMINI_API_KEY', settings.apiKey);
    await figma.clientStorage.setAsync('GEMINI_MODEL_NAME', settings.modelName);
  })

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

  // Dogfooding: Figma to Code Serialization
  on<import('./types').SerializeSelectionHandler>('SERIALIZE_SELECTION', function () {
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
  on<import('./types').ImportJsonHandler>('IMPORT_JSON', function (data: { jsonString: string }) {
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
    emit<SendProjectTemplatesHandler>('SEND_PROJECT_TEMPLATES', { templates: PROJECT_TEMPLATES });
  });

  on<ImportProjectTemplateHandler>('IMPORT_PROJECT_TEMPLATE', async function (data) {
    const template = PROJECT_TEMPLATES.find(t => t.id === data.templateId);
    if (!template) {
      emit<SendLogHandler>('SEND_LOG', { message: `Template not found: ${data.templateId}`, type: 'warn' });
      return;
    }

    try {
      emit<SendLogHandler>('SEND_LOG', { message: `Importing project template: ${template.name}...`, type: 'info' });
      
      const sessionBase = `dogfood-${template.id}-${Date.now()}`;
      
      if (template.variants && template.variants.length > 0) {
        const importedNodes: SceneNode[] = [];
        
        for (const variant of template.variants) {
          emit<SendLogHandler>('SEND_LOG', { message: `Rendering variant: ${variant.name}...`, type: 'info' });
          
          const node = await handleUnifiedRender({
            ...variant.data,
            name: `${template.name}/${variant.name}`, // Standard Figma variant naming
            designSystemId: 'vanilla',
            streamSessionId: `${sessionBase}-${variant.name}`,
            meta: { traceId: `${sessionBase}-${variant.name}` }
          }, false);
          
          if (node) {
            node.setPluginData('dogfood_component_id', template.id);
            node.setPluginData('dogfood_variant_name', variant.name);
            node.setPluginData('dogfood_version', template.version);
            node.setPluginData('dogfood_source_path', template.path);
            importedNodes.push(node);
          }
        }

        if (importedNodes.length >= 2) {
          emit<SendLogHandler>('SEND_LOG', { message: `Combining ${importedNodes.length} variants...`, type: 'info' });
          // Ensure they are selected for combining
          figma.currentPage.selection = importedNodes;
          await CanvasOrchestrator.combineVariants(template.name);
        }
      } else if (template.data) {
        // Fallback for single data
        const importedNode = await handleUnifiedRender({
          ...template.data,
          designSystemId: 'vanilla',
          streamSessionId: sessionBase,
          meta: { traceId: sessionBase }
        }, false);

        if (importedNode) {
          importedNode.setPluginData('dogfood_component_id', template.id);
          importedNode.setPluginData('dogfood_version', template.version);
          importedNode.setPluginData('dogfood_source_path', template.path);
        }
      }
      
      emit<SendLogHandler>('SEND_LOG', { message: `Imported ${template.name} successfully`, type: 'success' });
    } catch (e: any) {
      console.error('Import Project Template Error', e);
      emit<SendLogHandler>('SEND_LOG', { message: `Import Failed: ${e.message}`, type: 'warn' });
    }
  });

  on<CaptureUIHandler>('CAPTURE_UI', (data) => {
    // Forward to UI thread where DomCapture lives
    emit<CaptureUIHandler>('CAPTURE_UI', data);
  });

  on<SendCapturedUIHandler>('SEND_CAPTURED_UI', async (data) => {
    try {
      emit<SendLogHandler>('SEND_LOG', { message: `Processing captured UI for: ${data.templateId}...`, type: 'info' });
      
      const template = PROJECT_TEMPLATES.find(t => t.id === data.templateId);
      const sessionBase = `captured-${data.templateId}-${Date.now()}`;

      for (const layer of data.layers) {
        const node = await handleUnifiedRender({
          ...layer,
          designSystemId: 'vanilla',
          streamSessionId: sessionBase,
          meta: { traceId: sessionBase }
        }, false);

        if (node && template) {
          node.setPluginData('dogfood_component_id', template.id);
          node.setPluginData('dogfood_source_path', template.path);
          node.setPluginData('dogfood_is_live', 'true');
        }
      }

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

  // Dev Mode Codegen Support
  if (figma.editorType === 'dev') {
    figma.codegen.on('generate', (event) => {
      try {
        console.log('[Genable] Dev Mode: Generating DSL for selection...');
        const serialized = NodeSerializer.serialize(event.node);
        const dsl = JSON.stringify(serialized, null, 2);
        
        return [
          {
            language: 'JSON',
            label: 'Genable DSL',
            code: dsl,
          }
        ];
      } catch (e: any) {
        console.error('Codegen Error', e);
        return [
          {
            language: 'PLAINTEXT',
            label: 'Error',
            code: `Failed to generate DSL: ${e.message}`,
          }
        ];
      }
    });
  }

  showUI({
    height: 500,
    width: 340
  })
}
