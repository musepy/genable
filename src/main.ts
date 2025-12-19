import { on, showUI, emit } from '@create-figma-plugin/utilities'
import { 
  CloseHandler, 
  CreateLayersHandler, 
  LayerDSL, 
  GetVariablesHandler, 
  SendVariablesHandler,
  GetSelectionStylesHandler,
  SendSelectionStylesHandler,
  SelectionStyles,
  LoadSettingsHandler,
  SaveSettingsHandler,
  SettingsLoadedHandler,
  Settings
} from './types'

export default function () {
  on<CreateLayersHandler>('CREATE_LAYERS', async function (data: LayerDSL) {
    const nodes: SceneNode[] = []
    
    // 1. SANITIZE: Fix common LLM hallucinations before rendering
    const sanitizedData = sanitizeLayer(data);

    const rootNode = await renderLayer(sanitizedData, figma.currentPage)
    
    if (rootNode) {
      // Position at viewport center
      const center = figma.viewport.center;
      
      // Cast to handle positioning properties
      const positionedNode = rootNode as SceneNode & { x: number, y: number };

      if ('width' in rootNode && 'height' in rootNode) {
          positionedNode.x = center.x - (rootNode.width / 2);
          positionedNode.y = center.y - (rootNode.height / 2);
      } else {
          positionedNode.x = center.x;
          positionedNode.y = center.y;
      }

      nodes.push(rootNode)
      figma.currentPage.selection = nodes
      figma.viewport.scrollAndZoomIntoView(nodes)
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
        referenceLayout: undefined
    };

    // 1. Extract Layout Context from the primary selection (if applicable)
    if (selection.length > 0) {
        const primary = selection[0];
        // Check if it's a container-like node
        if ('width' in primary && 'height' in primary) {
            styles.referenceLayout = {
                width: primary.width,
                height: primary.height,
                layoutMode: 'layoutMode' in primary ? primary.layoutMode : 'NONE',
                itemSpacing: 'itemSpacing' in primary ? primary.itemSpacing : 0,
                padding: ('paddingLeft' in primary) ? {
                    top: primary.paddingTop,
                    right: primary.paddingRight,
                    bottom: primary.paddingBottom,
                    left: primary.paddingLeft
                } : undefined
            };
        }
    }

    // 2. Extract Style Tokens
    selection.forEach(node => {
        // Extract Fills
        if ('fills' in node && Array.isArray(node.fills)) {
            node.fills.forEach(fill => {
                if (fill.type === 'SOLID') {
                    const hex = rgbToHex(fill.color.r, fill.color.g, fill.color.b);
                    if (!styles.colors.includes(hex)) styles.colors.push(hex);
                }
            });
        }
        // Extract Radius
        if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
            if (node.cornerRadius !== 0 && !styles.cornerRadius.includes(node.cornerRadius)) {
                 styles.cornerRadius.push(node.cornerRadius);
            }
        }
        // Extract Font
        if ('fontName' in node && typeof node.fontName === 'object') {
            const font = (node.fontName as FontName).family;
            if (!styles.fonts.includes(font)) styles.fonts.push(font);
        }
    });

    emit<SendSelectionStylesHandler>('SEND_SELECTION_STYLES', styles);
  })

  on<LoadSettingsHandler>('LOAD_SETTINGS', async function () {
    const apiKey = await figma.clientStorage.getAsync('GEMINI_API_KEY') || '';
    const modelName = await figma.clientStorage.getAsync('GEMINI_MODEL_NAME') || 'gemini-1.5-flash';
    emit<SettingsLoadedHandler>('SETTINGS_LOADED', { apiKey, modelName });
  })

  on<SaveSettingsHandler>('SAVE_SETTINGS', async function (settings: Settings) {
    await figma.clientStorage.setAsync('GEMINI_API_KEY', settings.apiKey);
    await figma.clientStorage.setAsync('GEMINI_MODEL_NAME', settings.modelName);
  })

  on<CloseHandler>('CLOSE', function () {
    figma.closePlugin()
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

/**
 * Sanitize Layer:
 * A heuristic engine to correct common LLM layout hallucinations based on semantic intent.
 */
function sanitizeLayer(layer: LayerDSL): LayerDSL {
  // 1. Fix Paragraphs (The "1px sliver" problem)
  if (layer.type === 'TEXT') {
    if (layer.props.semantic === 'PARAGRAPH') {
       // Paragraphs should strictly be Auto Height + Fill Container (usually)
       layer.props.textAutoResize = 'HEIGHT';
       layer.props.layoutSizingHorizontal = 'FILL';
       
       // Hallucination Fix: If width is absurdly small (< 50px) but not meant to be, reset it.
       if (layer.props.width && layer.props.width < 50) {
           layer.props.width = undefined; // Let Auto Layout handle it
       }
    } else if (layer.props.semantic === 'HEADING' || layer.props.semantic === 'LABEL' || layer.props.semantic === 'BUTTON') {
       // Headings/Labels should hug content
       layer.props.textAutoResize = 'WIDTH_AND_HEIGHT';
       layer.props.layoutSizingHorizontal = 'HUG';
       layer.props.layoutSizingVertical = 'HUG';
    }
  }

  // 2. Fix Containers
  if (layer.type === 'FRAME') {
      // Prevent 0px/1px frames unless they are dividers (height=1)
      const isDivider = layer.props.height === 1 || layer.props.height === 0.5;
      
      if (!isDivider && layer.props.width && layer.props.width < 5) {
          // Fix: Reset to HUG or a reasonable default
          layer.props.layoutSizingHorizontal = 'HUG';
          delete layer.props.width; // Remove the hallucinated value
      }

      // Card Semantics
      if (layer.props.semantic === 'CARD') {
          if (!layer.props.padding) layer.props.padding = 16;
          if (!layer.props.cornerRadius) layer.props.cornerRadius = 8;
          // Ensure valid layout mode for cards
          if (layer.props.layout === 'NONE') layer.props.layout = 'VERTICAL'; 
      }
  }

  // 3. Recursive Sanitize
  if ('children' in layer && layer.children) {
      layer.children = layer.children.map((child: LayerDSL) => sanitizeLayer(child));
  }

  return layer;
}

async function renderLayer(data: LayerDSL, parent: BaseNode & ChildrenMixin): Promise<SceneNode | null> {
  let node: SceneNode;

  try {
    if (data.type === 'FRAME') {
      const frame = figma.createFrame();
      node = frame;
      frame.name = data.props.name || 'Frame';
      
      // Auto Layout
      if (data.props.layout && data.props.layout !== 'NONE') {
        frame.layoutMode = data.props.layout;
        
        // Alignment
        if (data.props.primaryAxisAlignItems) frame.primaryAxisAlignItems = data.props.primaryAxisAlignItems;
        if (data.props.counterAxisAlignItems) frame.counterAxisAlignItems = data.props.counterAxisAlignItems;
        
        // Advanced Layout Props
        if (data.props.itemReverseZIndex !== undefined) frame.itemReverseZIndex = data.props.itemReverseZIndex;
        if (data.props.strokesIncludedInLayout !== undefined) frame.strokesIncludedInLayout = data.props.strokesIncludedInLayout;

        // Padding
        if (typeof data.props.padding === 'number') {
            frame.paddingLeft = frame.paddingRight = frame.paddingTop = frame.paddingBottom = data.props.padding;
        } else if (typeof data.props.padding === 'object') {
            frame.paddingTop = data.props.padding.top;
            frame.paddingRight = data.props.padding.right;
            frame.paddingBottom = data.props.padding.bottom;
            frame.paddingLeft = data.props.padding.left;
        }

        frame.itemSpacing = data.props.gap || 0;
      } else {
        frame.resize(100, 100)
      }

      // Corner Radius
      if (typeof data.props.cornerRadius === 'number') {
          frame.cornerRadius = data.props.cornerRadius;
      } else if (typeof data.props.cornerRadius === 'object') {
          frame.topLeftRadius = data.props.cornerRadius.topLeft;
          frame.topRightRadius = data.props.cornerRadius.topRight;
          frame.bottomRightRadius = data.props.cornerRadius.bottomRight;
          frame.bottomLeftRadius = data.props.cornerRadius.bottomLeft;
      }

      // Fills
      if (data.props.fills && data.props.fills.length > 0) {
          const paints: Paint[] = [];
          for (const fillStr of data.props.fills) {
              const paint = await createPaint(fillStr);
              if (paint) paints.push(paint);
          }
          frame.fills = paints;
      }

      // Stroke
      if (data.props.stroke) {
          const strokePaint = await createPaint(data.props.stroke);
          if (strokePaint) frame.strokes = [strokePaint];
      }
      if (data.props.strokeWeight) frame.strokeWeight = data.props.strokeWeight;
      if (data.props.strokeAlign) frame.strokeAlign = data.props.strokeAlign;
      
      // Effects
      if (data.props.effects) {
        frame.effects = data.props.effects.map((eff: any) => ({
            type: 'DROP_SHADOW',
            color: parseColor(eff.color, 0.2), 
            offset: eff.offset,
            radius: eff.blur,
            spread: eff.spread,
            visible: true,
            blendMode: 'NORMAL'
        }));
      }

    } else if (data.type === 'TEXT') {
      let weight = data.props.fontWeight || "Regular";
      const family = data.props.fontFamily || "Inter";
      
      // Robust Font Loading
      try {
        await figma.loadFontAsync({ family, style: weight });
      } catch (e) {
        console.warn(`Font style '${weight}' not found for '${family}'. Falling back to 'Regular'.`);
        weight = "Regular";
        try {
          await figma.loadFontAsync({ family, style: weight });
        } catch (e2) {
          console.error(`Failed to load font '${family}' entirely.`, e2);
        }
      }

      const text = figma.createText();
      node = text;
      text.fontName = { family, style: weight };
      text.name = data.props.name || 'Text';
      text.characters = data.props.content || "Text";
      
      if (data.props.fontSize) text.fontSize = data.props.fontSize;
      if (data.props.textAlign) text.textAlignHorizontal = data.props.textAlign;
      
      // Text Auto Resize
      if (data.props.textAutoResize) {
          text.textAutoResize = data.props.textAutoResize;
      } else {
          // Default behavior inference if not specified
          if (data.props.layoutSizingHorizontal === 'FIXED' || data.props.width) {
             text.textAutoResize = 'HEIGHT'; // Fixed width, auto height
          } else {
             text.textAutoResize = 'WIDTH_AND_HEIGHT';
          }
      }
      
      // Text Color
      if (data.props.color) {
          const paint = await createPaint(data.props.color);
          if (paint) text.fills = [paint];
      }

    } else if (data.type === 'VECTOR') {
       if (data.props.svgData) {
         try {
           let svgContent = data.props.svgData.trim();
           if (!svgContent.startsWith('<svg')) {
             svgContent = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
           }
           node = figma.createNodeFromSvg(svgContent);
         } catch (svgError) {
           console.error("Failed to render SVG, fallback to rect", svgError);
           node = figma.createRectangle();
           node.name = "Icon (Error)";
           (node as RectangleNode).resize(24, 24);
           (node as RectangleNode).fills = [{type: 'SOLID', color: {r: 1, g: 0, b: 0}}];
         }
       } else {
         node = figma.createRectangle();
       }
       node.name = data.props.name || 'Vector';
    } else {
      // Fallback
      node = figma.createRectangle();
    }

    // Common Visuals
    if (data.props.opacity !== undefined) node.opacity = data.props.opacity;
    if (data.props.visible !== undefined) node.visible = data.props.visible;

    // Append to parent
    parent.appendChild(node);

    // UNIFIED SIZING & CONSTRAINTS LOGIC
    const isParentAutoLayout = parent.type === 'FRAME' && parent.layoutMode !== 'NONE';
    
    // Apply Min/Max constraints if available (FrameNode only)
    if (node.type === 'FRAME') {
        if (data.props.minWidth !== undefined) node.minWidth = data.props.minWidth;
        if (data.props.maxWidth !== undefined) node.maxWidth = data.props.maxWidth;
        if (data.props.minHeight !== undefined) node.minHeight = data.props.minHeight;
        if (data.props.maxHeight !== undefined) node.maxHeight = data.props.maxHeight;
    }

    // Apply Width/Horizontal Sizing
    applyAxisSizing(
        node, 
        'HORIZONTAL', 
        data.props.layoutSizingHorizontal, 
        data.props.width, 
        isParentAutoLayout
    );

    // Apply Height/Vertical Sizing
    applyAxisSizing(
        node, 
        'VERTICAL', 
        data.props.layoutSizingVertical, 
        data.props.height, 
        isParentAutoLayout
    );

    // Children
    if ('children' in data && data.children && 'children' in node) {
      for (const child of data.children) {
        await renderLayer(child, node as FrameNode);
      }
    }
    return node;
  } catch (error) {
    console.error("Error rendering layer:", error);
    return null;
  }
}

function applyAxisSizing(
    node: SceneNode, 
    axis: 'HORIZONTAL' | 'VERTICAL', 
    sizingMode: 'FIXED' | 'HUG' | 'FILL' | undefined, 
    explicitSize: number | undefined,
    isParentAutoLayout: boolean
) {
    const layoutMixin = node as SceneNode & LayoutMixin;
    
    // 1. Determine Sizing Mode
    // Default to FIXED if explicit size provided, otherwise HUG (if applicable) or FIXED
    let mode = sizingMode;
    if (!mode) {
        if (explicitSize !== undefined) mode = 'FIXED';
        else mode = 'HUG'; // Default
    }

    // 2. Apply Mode
    if (isParentAutoLayout) {
        if (axis === 'HORIZONTAL') {
            layoutMixin.layoutSizingHorizontal = mode;
        } else {
            layoutMixin.layoutSizingVertical = mode;
        }
    } 
    // If not auto-layout parent, we can't set "FILL" (it's meaningless/invalid).
    // "HUG" works if the node itself is AutoLayout.

    // 3. Apply Explicit Size (only if FIXED)
    if (mode === 'FIXED' && explicitSize !== undefined) {
        if (axis === 'HORIZONTAL') {
            layoutMixin.resize(explicitSize, layoutMixin.height);
        } else {
            layoutMixin.resize(layoutMixin.width, explicitSize);
        }
    }
}

function parseColor(colorStr: string, defaultAlpha: number = 1): {r: number, g: number, b: number, a: number} {
    if (colorStr.startsWith('#')) {
      const hex = colorStr.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      return { r, g, b, a: defaultAlpha };
    }
    return { r: 0, g: 0, b: 0, a: defaultAlpha }; // Fallback black
}

async function createPaint(colorStr: string): Promise<Paint | null> {
    // 1. Handle Variables
    if (colorStr.startsWith('Variable:')) {
        const varName = colorStr.split(':')[1].trim();
        try {
            const localVars = await figma.variables.getLocalVariablesAsync(); 
            const foundVar = localVars.find(v => v.name === varName);
            
            if (foundVar && foundVar.resolvedType === 'COLOR') {
                // Create a bindable paint
                const paint: SolidPaint = { type: 'SOLID', color: {r:0, g:0, b:0} };
                return figma.variables.setBoundVariableForPaint(paint, 'color', foundVar);
            }
        } catch (e) {
            console.warn(`Failed to bind variable ${varName}`, e);
        }
    }

    // 2. Handle Hex
    const color = parseColor(colorStr);
    return { 
        type: 'SOLID', 
        color: {r: color.r, g: color.g, b: color.b}, 
        opacity: color.a 
    };
}
