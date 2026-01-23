import { on, showUI, emit } from '@create-figma-plugin/utilities'
import { 
  CloseHandler, 
  CreateLayersHandler, 
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
import { parseColor } from './utils/colorUtils';
import { DesignSystemConfig } from './types/designSystem';
import { figmaVariableCache } from './engine/figma-adapter/caches/figmaVariableCache'
import { getActiveEngineConfig } from './engine/engineConfig'
import { renderNodeDSL, initializeRenderers } from './engine/figma-adapter/renderers'
import { NodeSerializer } from './engine/figma-adapter/nodeSerializer';
import { DEFAULT_MODEL } from './ui/constants/models'

// Build Version (replaced at build time by build.js)
// Handles Variables, Styles, and Literal colors using SSOT
async function createPaint(input: any, config?: DesignSystemConfig): Promise<Paint | null> {
    if (!input) return null;

    if (typeof input === 'string') {
        const normalized = input.trim().toLowerCase();
        
        // 1. Explicit Variable Binding
        if (normalized.startsWith('variable:')) {
            const varName = input.split(':').slice(1).join(':').trim();
            const foundVar = figmaVariableCache.getVariable(varName);
            if (foundVar && foundVar.resolvedType === 'COLOR') {
                const paint: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
                return figma.variables.setBoundVariableForPaint(paint, 'color', foundVar);
            }
        }

        // 2. Token/Style Resolution
        const isLiteral = normalized.startsWith('#') || normalized.startsWith('rgba') || normalized.startsWith('rgb');
        if (!isLiteral) {
            // Check Variables Map
            const foundVar = figmaVariableCache.getVariable(normalized);
            if (foundVar && foundVar.resolvedType === 'COLOR') {
                const paint: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
                return figma.variables.setBoundVariableForPaint(paint, 'color', foundVar);
            }
            // Check Paint Styles
            const style = figmaVariableCache.getStyle(normalized);
            if (style && style.paints.length > 0) return style.paints[0];
        }
    }

    // 3. Literal Color Fallback
    try {
        const c = parseColor(input);
        return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
    } catch (e) {
        return null;
    }
}

export default function () {
  // 🔧 Startup Log: Verify if new code is running
  console.log(`[Genable] 🚀 Plugin started | Strategy-Registry Active`);

  on<CreateLayersHandler>('CREATE_LAYERS', async function (data: any) {
    const { 
      designSystemId, 
      renderContext, 
      __traceId,     
      ...layerData   
    } = data;
    
    const activeConfig = getActiveEngineConfig(designSystemId);

    // [P8.2] Initialize Renderers with dynamic dependencies
    initializeRenderers(
        (color) => createPaint(color, activeConfig),
        [] // Components will be fetched if needed
    );

    const explicitContext = {
      parent: figma.currentPage,
      depth: 0,
      designSystem: activeConfig,
      viewport: renderContext ? {
          width: renderContext.width,
          height: renderContext.height,
          isMobile: renderContext.isMobile
      } : undefined
    };

    emit<SendLogHandler>('SEND_LOG', { 
        message: `Generating Layers (${layerData.name || 'Untitled'})...`, 
        type: 'info' 
    });

    try {
      await figmaVariableCache.warmup();

      const fontsToLoad = [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Medium' },
        { family: 'Inter', style: 'SemiBold' },
        { family: 'Inter', style: 'Bold' }
      ];
      await Promise.all(fontsToLoad.map(font => 
        figma.loadFontAsync(font).catch(err => console.warn(`[Main] Font load failed: ${font.family} ${font.style}`, err))
      ));
      
      const viewportCenter = figma.viewport.center;
      
      // [V6] Use Strategy-Registry Pattern
      const rootNode = await renderNodeDSL(layerData, explicitContext as any);
      
      if (rootNode) {
        // [FIX] Position at captured viewport center
        const center = viewportCenter;
        const positionedNode = rootNode as SceneNode & { x: number, y: number };

        if ('width' in rootNode && 'height' in rootNode) {
            positionedNode.x = center.x - (rootNode.width / 2);
            positionedNode.y = center.y - (rootNode.height / 2);
        } else {
            positionedNode.x = center.x;
            positionedNode.y = center.y;
        }

        figma.currentPage.selection = [rootNode];
        figma.viewport.scrollAndZoomIntoView([rootNode]);
        
        emit<SendLogHandler>('SEND_LOG', { 
            message: `Generation Complete!`, 
            type: 'success' 
        });
      }
    } catch (error: any) {
        console.error('Render Error:', error);
        emit<SendLogHandler>('SEND_LOG', { 
            message: `Error: ${error.message}`, 
            type: 'warn' 
        });
    }
  })

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
        // Use Unified Serializer to capture full context
        styles.selectionNodes = selection.map(node => NodeSerializer.serialize(node));
        
        // Extract top-level layout as reference
        const primary = selection[0];
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

        // Aggregate styles for legacy UI compatibility
        styles.selectionNodes.forEach(node => {
            const p = node.props as any;
            if (p.fills && Array.isArray(p.fills)) {
                p.fills.forEach((f: string) => {
                    if (!styles.colors.includes(f)) styles.colors.push(f);
                });
            }
            if (p.cornerRadius && !styles.cornerRadius.includes(p.cornerRadius)) {
                styles.cornerRadius.push(p.cornerRadius);
            }
            if (p.fontFamily && !styles.fonts.includes(p.fontFamily)) {
                styles.fonts.push(p.fontFamily);
            }
        });
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
    // [Implementation]: Fetch available library variables/styles
    // For now, we return specific keys if needed, or empty list
    // This is a placeholder for future Context Awareness
    emit<SendLibraryResourcesHandler>('SEND_LIBRARY_RESOURCES', { resources: [] });
  })

  on<GetLocalComponentsHandler>('GET_LOCAL_COMPONENTS', async function () {
    // [Implementation]: Fetch local components for reference
    // [Fix]: Limit search to current page to comply with 'dynamic-page' access
    const localComponents = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
    const componentsData = localComponents.map(c => ({
        key: c.key,
        name: c.name,
        description: c.description,
        type: c.type,
        isLibrary: false
    }));
    emit<SendLocalComponentsHandler>('SEND_LOCAL_COMPONENTS', { components: componentsData });
  })

  showUI({
    height: 500,
    width: 340
  })
}

function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

