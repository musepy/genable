/**
 * @file iconRenderer.ts
 * @description Renderer for ICON type nodes using Iconify API
 * 
 * [INPUT]:  NodeLayer with type: "ICON" and props.iconName
 * [OUTPUT]: FrameNode containing SVG
 * [POS]:    Main Thread (Figma sandbox)
 */

import { NodeLayer, RenderContext, BaseRenderer } from './baseRenderer';
import { PropertyTransformer } from '../propertyTransformer';
import { PROPS } from '../../../constants/figma-api';
import { fetchIconSvg } from '../assets/iconify';

/**
 * IconRenderer - Creates icons from Iconify SVG API
 */
export class IconRenderer extends BaseRenderer {
  constructor(createPaintFn: (color: string) => Promise<Paint | null>) {
    super(createPaintFn);
  }

  protected getRendererName(): string {
    return 'IconRenderer';
  }

  protected async createNode(dsl: NodeLayer): Promise<SceneNode | null> {
    const props = dsl.props as { iconName?: string; width?: number; height?: number; fills?: string[] };
    const { iconName, width = 24, height = 24 } = props;

    if (!iconName) {
      console.warn('[IconRenderer] Missing iconName, creating placeholder');
      return this.createPlaceholder('unknown', width, height);
    }

    // Fetch SVG from Iconify API
    const svg = await fetchIconSvg(iconName);
    
    if (!svg) {
      console.warn(`[IconRenderer] Icon not found: ${iconName}`);
      return this.createPlaceholder(iconName, width, height);
    }

    try {
      // V4: Visual Normalization - Wrapping in a 24x24 standard container if requested size differs
      // or ensuring consistent centering within the generated SVG frame.
      const node = figma.createNodeFromSvg(svg);
      node.name = iconName;
      
      // Resize to requested size (ensures consistent visual weight)
      node.resize(width, height);
      
      // Center internal elements if it's a frame
      if (node.type === 'FRAME') {
        node.layoutMode = 'NONE'; // Ensure absolute positioning for centering
        // FIX: Clear inherited strokes/fills to prevent unwanted background/borders
        node.strokes = [];
        node.fills = [];
        const children = node.children;
        for (const child of children) {
            child.x = (width - child.width) / 2;
            child.y = (height - child.height) / 2;
        }
      }
      
      console.log(`[IconRenderer] Created icon: ${iconName} (${width}x${height})`);
      return node;
    } catch (e) {
      console.error(`[IconRenderer] Failed to create SVG node:`, e);
      return this.createPlaceholder(iconName, width, height);
    }
  }

  protected async applyTypeSpecificProps(
    node: SceneNode,
    dsl: NodeLayer,
    _context: RenderContext
  ): Promise<void> {
    const props = dsl.props as { fills?: string[]; strokeWeight?: number };
    
    // V4: Semantic Glyph Mode - If fill is provided, bind it to ALL paths
    if (props.fills && props.fills.length > 0) {
      await this.applyFillToSvg(node, props.fills[0]);
    }

    // V4: Weight Governance - Apply stroke weight to outline icons
    const rawWeight = props.strokeWeight ?? Math.max(1.5, (dsl.props.width ? (dsl.props.width as number / 24) * 2 : 2));
    const weight = PropertyTransformer.deserialize(rawWeight, PROPS.strokeWeight);
    this.applyStrokeWeightToSvg(node, weight);
  }

  /**
   * Create a placeholder frame when icon fails to load
   */
  private createPlaceholder(name: string, width: number, height: number): FrameNode {
    const frame = figma.createFrame();
    frame.name = `Icon: ${name} (not found)`;
    frame.resize(width, height);
    frame.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
    frame.cornerRadius = 4;
    
    // V6.1: Observability Label
    const text = figma.createText();
    // FontBus ensures Inter Regular is loaded
    text.fontName = { family: 'Inter', style: 'Regular' };
    text.characters = `Icon: ${name}\nNot Found`;
    text.fontSize = Math.max(4, width / 6);
    text.textAlignHorizontal = 'CENTER';
    text.textAlignVertical = 'CENTER';
    
    frame.appendChild(text);
    text.resize(width, height);
    
    return frame;
  }

  /**
   * Apply a semantic style (Fill + Stroke) to an SVG node recursively
   * Uses shared Surgical Binding logic for consistency with VectorRenderer.
   */
  private async applyFillToSvg(node: SceneNode, colorStr: string): Promise<void> {
    const paint = await this.createPaintFn(colorStr);
    if (!paint) return;

    // V5.4: Use shared Surgical Binding logic
    const { applySurgicalBinding } = await import('./surgicalBinding');
    applySurgicalBinding(node, paint);
  }

  /**
   * Apply stroke weight to SVG paths for outline-based libraries (Lucide, f7, etc.)
   * Uses shared utility for consistency.
   */
  private applyStrokeWeightToSvg(node: SceneNode, weight: number): void {
    // V5.4: Use shared utility (imported synchronously since no async needed)
    import('./surgicalBinding').then(({ applyStrokeWeight }) => {
        applyStrokeWeight(node, weight);
    });
  }
}

