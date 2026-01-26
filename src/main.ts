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
  async function handleUnifiedRender(data: any, isStream: boolean) {
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
            figma.currentPage.selection = [rootNode];
            figma.viewport.scrollAndZoomIntoView([rootNode]);
            emit<SendLogHandler>('SEND_LOG', { message: `Generation Complete!`, type: 'success' });
          }
      }
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
  })

  showUI({
    height: 500,
    width: 340
  })
}
