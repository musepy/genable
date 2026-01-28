/**
 * @file CanvasOrchestrator.ts
 * @description Manages the layout of nodes on the canvas, including Sections and Component Sets.
 */

import { TokenMode } from '../sync/tokenParser';

export class CanvasOrchestrator {
  private static SECTION_NAMES = {
    TOKENS: '🎨 Design Tokens',
    COMPONENTS: '📦 Components',
    PAGES: '📱 Pages'
  };

  /**
   * Get or create a section by name.
   */
  static async getOrCreateSection(name: string): Promise<SectionNode> {
    let section = figma.currentPage.findOne(n => n.type === 'SECTION' && n.name === name) as SectionNode;
    
    if (!section) {
      section = figma.createSection();
      section.name = name;
      figma.currentPage.appendChild(section);
      
      // Basic auto-layout-like positioning for sections
      const sections = figma.currentPage.findAll(n => n.type === 'SECTION');
      const offset = (sections.length - 1) * 1200;
      section.x = offset;
    }
    
    return section;
  }

  /**
   * Place a node into the appropriate section based on its structure/intent.
   */
  static async placeInSection(node: SceneNode, intent: 'TOKENS' | 'COMPONENTS' | 'PAGES') {
    const sectionName = this.SECTION_NAMES[intent] || this.SECTION_NAMES.COMPONENTS;
    const section = await this.getOrCreateSection(sectionName);
    
    section.appendChild(node);
    
    // Auto-arrange within section
    this.arrangeChildren(section);
  }

  /**
   * Combine selected nodes into a Component Set (Variants).
   */
  static async combineVariants(prefix: string) {
    let nodes = figma.currentPage.selection.filter(n => 
      n.name.startsWith(`${prefix}/`)
    );

    if (nodes.length < 2) {
      throw new Error(`需要至少 2 个以 "${prefix}/" 开头的组件或图层才能合并变体。`);
    }

    // Wrap regular nodes into components if they aren't already
    const components: ComponentNode[] = [];
    for (const node of nodes) {
      if (node.type === 'COMPONENT') {
        components.push(node);
      } else {
        const comp = figma.createComponent();
        comp.name = node.name;
        comp.resize(node.width, node.height);
        comp.x = node.x;
        comp.y = node.y;
        
        const parent = node.parent;
        if (parent) {
          parent.appendChild(comp);
        }
        comp.appendChild(node);
        node.x = 0;
        node.y = 0;
        components.push(comp);
      }
    }

    try {
      const componentSet = figma.combineAsVariants(components, figma.currentPage);
      componentSet.name = prefix;
      
      await this.placeInSection(componentSet, 'COMPONENTS');
    } catch (e) {
      console.error('[CanvasOrchestrator] Failed to combine variants:', e);
      throw e;
    }
  }

  /**
   * Create a visual representation of the current design tokens.
   */
  static async createTokenPreview(modes: TokenMode[]) {
    const section = await this.getOrCreateSection(this.SECTION_NAMES.TOKENS);
    
    // Create a local auto-layout frame for the styles
    const container = figma.createFrame();
    container.name = "Token sheet";
    container.layoutMode = "VERTICAL";
    container.itemSpacing = 24;
    container.paddingLeft = container.paddingRight = container.paddingTop = container.paddingBottom = 40;
    container.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    container.cornerRadius = 12;

    for (const mode of modes) {
        const title = figma.createText();
        await figma.loadFontAsync(title.fontName as FontName);
        title.characters = `${mode.name} Mode`;
        title.fontSize = 20;
        container.appendChild(title);

        const grid = figma.createFrame();
        grid.name = "Color Grid";
        grid.layoutMode = "HORIZONTAL";
        grid.counterAxisSizingMode = "AUTO";
        grid.itemSpacing = 12;
        grid.layoutWrap = "WRAP";
        grid.fills = [];
        
        for (const token of mode.tokens) {
            if (token.name.includes('color')) {
                const item = figma.createFrame();
                item.name = token.name;
                item.resize(80, 100);
                item.layoutMode = "VERTICAL";
                item.itemSpacing = 4;
                item.fills = [];

                const swatch = figma.createFrame();
                swatch.resize(80, 80);
                swatch.cornerRadius = 8;
                
                // Set fill if it's a raw color, otherwise it's an alias (visualizing aliases is more complex, skipping for now)
                if (!token.value.startsWith('{')) {
                    const resolved = (token as any)._resolvedColor || { r: 0.8, g: 0.8, b: 0.8, a: 1 };
                    const { r, g, b, a } = resolved;
                    
                    // Explicitly construct the color object to avoid passing 'a' or other properties
                    swatch.fills = [{ 
                        type: 'SOLID', 
                        color: { r, g, b },
                        opacity: a 
                    }];
                } else {
                    swatch.fills = [{ type: 'SOLID', color: {r:0.9, g:0.9, b:0.9} }];
                    swatch.strokes = [{ type: 'SOLID', color: {r:0.7, g:0.7, b:0.7} }];
                }
                
                const label = figma.createText();
                await figma.loadFontAsync(label.fontName as FontName);
                label.characters = token.name.split('/').pop() || token.name;
                label.fontSize = 10;
                
                item.appendChild(swatch);
                item.appendChild(label);
                grid.appendChild(item);
            }
        }
        container.appendChild(grid);
    }

    section.appendChild(container);
    this.arrangeChildren(section);
  }

  /**
   * Simple grid arrangement for section children.
   */
  private static arrangeChildren(section: SectionNode) {
    const padding = 100;
    const gap = 40;
    let currentX = padding;
    let currentY = padding;
    let maxHeightInRow = 0;

    section.children.forEach((child, index) => {
      child.x = currentX;
      child.y = currentY;
      
      maxHeightInRow = Math.max(maxHeightInRow, child.height);
      currentX += child.width + gap;

      // Wrap row after 3 items
      if ((index + 1) % 4 === 0) {
        currentX = padding;
        currentY += maxHeightInRow + gap;
        maxHeightInRow = 0;
      }
    });
  }
}
