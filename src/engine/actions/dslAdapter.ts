import { NodeLayer } from '../../schema/layerSchema';
import { FigmaAction, CreateFrameAction, CreateTextAction, CreateShapeAction, CreateIconAction } from './types';

export class DslToActionAdapter {
  /**
   * Converts a legacy NodeLayer tree into a flat array of FigmaAction objects
   * @param root The root node of the DSL tree
   * @param overrideParentId Optional parent ID to attach the root to
   * @returns Array of ordered FigmaActions ready for ActionExecutor
   */
  public static convert(root: NodeLayer, overrideParentId?: string): FigmaAction[] {
    const actions: FigmaAction[] = [];
    this.traverse(root, overrideParentId, actions);
    return actions;
  }

  private static traverse(node: NodeLayer, parentId: string | undefined, actions: FigmaAction[]) {
    const tempId = node.id || `temp_${Math.random().toString(36).substr(2, 9)}`;
    const props = this.mapProps(node);

    switch (node.type) {
      case 'FRAME':
      case 'COMPONENT':
      case 'INSTANCE':
      case 'GROUP':
      case 'SECTION':
        actions.push({
          action: 'createFrame',
          tempId,
          parentId,
          props
        } as CreateFrameAction);
        break;
      
      case 'TEXT':
        actions.push({
          action: 'createText',
          tempId,
          parentId,
          props: {
            ...props,
            characters: node.props?.characters || node.props?.content || '',
          }
        } as CreateTextAction);
        break;
      
      case 'RECTANGLE':
      case 'ELLIPSE':
      case 'LINE':
        actions.push({
          action: 'createShape',
          shapeType: node.type,
          tempId,
          parentId,
          props
        } as CreateShapeAction);
        break;
      
      case 'VECTOR':
        actions.push({
          action: 'createShape',
          shapeType: 'VECTOR',
          tempId,
          parentId,
          props
        } as CreateShapeAction);
        break;

      case 'ICON': {
        const iconProps = { ...props };
        if (iconProps.svgContent && !iconProps.svgData) {
          iconProps.svgData = iconProps.svgContent;
        }
        delete iconProps.svgContent;
        actions.push({
          action: 'createIcon',
          tempId,
          parentId,
          props: iconProps
        } as CreateIconAction);
        break;
      }
        
      default:
        console.warn(`[DslToActionAdapter] Unsupported node type: ${node.type}`);
        // Fallback to frame
        actions.push({
          action: 'createFrame',
          tempId,
          parentId,
          props
        } as CreateFrameAction);
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        this.traverse(child, tempId, actions);
      }
    }
  }

  private static mapProps(node: NodeLayer): Record<string, any> {
    const dslProps = node.props || {};
    const mapped: Record<string, any> = {
      name: node.name || node.type
    };

    // 1. Direct mappings (most properties match directly)
    for (const [key, value] of Object.entries(dslProps)) {
      if (value !== undefined && value !== null) {
        mapped[key] = value;
      }
    }

    // 2. Translate specific properties that differed in DSL
    if ('gap' in dslProps) {
      mapped.itemSpacing = dslProps.gap;
      delete mapped.gap;
    }
    
    if ('textAlign' in dslProps) {
      mapped.textAlignHorizontal = dslProps.textAlign;
      delete mapped.textAlign;
    }
    
    if ('content' in dslProps && node.type === 'TEXT') {
      mapped.characters = dslProps.content;
      delete mapped.content;
    }
    
    if ('background' in dslProps) {
        mapped.fills = Array.isArray(dslProps.background) ? dslProps.background : [dslProps.background];
        delete mapped.background;
    }

    // Remove properties that shouldn't be set directly or are handled specially
    delete mapped.id;
    delete mapped.type;
    delete mapped.children;
    
    return mapped;
  }
}
