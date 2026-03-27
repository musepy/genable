import { NodeLayer } from '../../types';
import { NODE_TYPES } from '../../constants/figma-api';
import { TokenResolver } from './TokenResolver';

/**
 * DomCapture: Utilities for extracting Figma DSL from live DOM elements.
 */
export class DomCapture {
  /**
   * Captures a DOM element and its children into a NodeLayer tree.
   */
  static async captureElement(element: HTMLElement): Promise<NodeLayer> {
    const ownerWindow = element.ownerDocument?.defaultView || window;
    const style = ownerWindow.getComputedStyle(element);
    
    // 1. Identify Node Type
    const type = this.resolveNodeType(element, style);
    
    // 2. Extract Props
    const props: any = {};
    props['name'] = element.getAttribute('data-name') || element.tagName.toLowerCase();
    
    // 3. Layout Props
    this.extractLayoutProps(element, style, props);
    
    // 4. Visual Props (Fills, Borders, etc.)
    this.extractVisualProps(element, style, props);

    // 5. Recursive Children
    const children: NodeLayer[] = [];
    for (const child of Array.from(element.children)) {
      if (child instanceof HTMLElement && this.shouldCapture(child)) {
        children.push(await this.captureElement(child));
      }
    }

    return {
      type,
      props,
      children: children.length > 0 ? children : undefined
    };
  }

  private static resolveNodeType(el: HTMLElement, style: CSSStyleDeclaration): string {
    if (el.tagName === 'IMG' || style.backgroundImage !== 'none') return NODE_TYPES.RECTANGLE;
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) return NODE_TYPES.TEXT;
    return NODE_TYPES.FRAME;
  }

  private static extractLayoutProps(el: HTMLElement, style: CSSStyleDeclaration, props: any) {
    const rect = el.getBoundingClientRect();
    props['width'] = rect.width;
    props['height'] = rect.height;

    // Auto Layout Mapping
    if (style.display === 'flex') {
      props['layoutMode'] = style.flexDirection === 'column' ? 'VERTICAL' : 'HORIZONTAL';
      props['gap'] = parseInt(style.columnGap) || 0;

      // Alignment
      props['primaryAxisAlignItems'] = this.mapFlexAlign(style.justifyContent);
      props['counterAxisAlignItems'] = this.mapFlexAlign(style.alignItems);
    }

    // Paddings
    props['paddingTop'] = parseInt(style.paddingTop);
    props['paddingRight'] = parseInt(style.paddingRight);
    props['paddingBottom'] = parseInt(style.paddingBottom);
    props['paddingLeft'] = parseInt(style.paddingLeft);
  }

  private static extractVisualProps(el: HTMLElement, style: CSSStyleDeclaration, props: any) {
    // Fills
    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
      const resolvedColor = TokenResolver.resolveColor(style.backgroundColor);
      props['fills'] = [resolvedColor];
    }

    // Borders
    const borderWidth = parseInt(style.borderWidth);
    if (borderWidth > 0) {
      props['strokeWeight'] = borderWidth;
      const resolvedBorderColor = TokenResolver.resolveColor(style.borderColor);
      props['strokes'] = [resolvedBorderColor];
    }

    // Corner Radius
    const radius = parseInt(style.borderRadius);
    if (radius > 0) {
      props['cornerRadius'] = radius;
    }

    // Text Props
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
      props['characters'] = (el.textContent || '').trim();
      props['fontSize'] = parseInt(style.fontSize);
      props['fontWeight'] = style.fontWeight;
      props['fontFamily'] = style.fontFamily.split(',')[0].replace(/"/g, '');
    }
  }

  private static mapFlexAlign(flexAlign: string): string {
    switch (flexAlign) {
      case 'flex-start': return 'MIN';
      case 'center': return 'CENTER';
      case 'flex-end': return 'MAX';
      case 'space-between': return 'SPACE_BETWEEN';
      default: return 'MIN';
    }
  }

  private static shouldCapture(el: HTMLElement): boolean {
    const ownerWindow = el.ownerDocument?.defaultView || window;
    const style = ownerWindow.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
}
