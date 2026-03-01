import { FigmaAction } from './types';

export function translateBatchOperationsToActions(operations: any[]): FigmaAction[] {
  const result: FigmaAction[] = [];

  function processOp(op: any, defaultParentId?: string) {
    const { opId, action, params = {}, dependsOn } = op;
    const parentId = params.parentId || params.parentRef || defaultParentId;
    const nodeId = params.nodeId || params.nodeRef;

    const base: any = {
      tempId: opId,
      parentId,
      dependsOn,
      nodeId
    };

    switch (action) {
      case 'createNode': {
        const type = params.type?.toUpperCase();
        let targetAction = '';
        if (type === 'FRAME' || type === 'GROUP' || type === 'COMPONENT' || type === 'SECTION') {
          targetAction = 'createFrame';
        } else if (type === 'TEXT') {
          targetAction = 'createText';
        } else if (type === 'RECTANGLE' || type === 'ELLIPSE' || type === 'LINE' || type === 'VECTOR') {
          targetAction = 'createShape';
        } else if (type === 'INSTANCE') {
          targetAction = 'createInstance';
        } else {
          targetAction = 'createFrame'; // Fallback
        }

        const actionObj: any = {
          ...base,
          action: targetAction,
          props: { ...params.props }
        };

        if (params.name) actionObj.props.name = params.name;
        if (params.characters) actionObj.props.characters = params.characters;
        if (targetAction === 'createShape') actionObj.shapeType = type;
        if (targetAction === 'createInstance') actionObj.componentKey = params.componentKey; // Assuming passed in props or params

        result.push(actionObj as FigmaAction);

        // Process children
        if (Array.isArray(params.children)) {
          for (const childOp of params.children) {
            processOp(childOp, opId);
          }
        }
        break;
      }

      case 'deleteNode': {
        result.push({
          ...base,
          action: 'delete'
        } as FigmaAction);
        break;
      }

      case 'updateNodeProperties':
      case 'setNodeLayout':
      case 'setNodeStyles':
      case 'patchNode': {
        result.push({
          ...base,
          action: 'updateProps',
          props: { ...params.props, ...params.layout, ...params.styles } // merge all possible property sources
        } as FigmaAction);
        break;
      }

      case 'createIcon': {
        const iconProps: Record<string, any> = { ...params.props };
        if (params.iconName !== undefined) iconProps.iconName = params.iconName;
        if (params.svgData !== undefined) iconProps.svgData = params.svgData;
        if (params.svgContent !== undefined && iconProps.svgData === undefined) {
          iconProps.svgData = params.svgContent;
        }
        if (params.size !== undefined) {
          iconProps.width = params.size;
          iconProps.height = params.size;
        }
        if (params.width !== undefined) iconProps.width = params.width;
        if (params.height !== undefined) iconProps.height = params.height;
        if (params.color !== undefined) iconProps.fills = [params.color];
        result.push({
          ...base,
          action: 'createIcon',
          props: iconProps
        } as FigmaAction);
        break;
      }
      
      case 'applyDesignPatch': {
        // applyDesignPatch takes an array of patches in `params.patches`
        if (Array.isArray(params.patches)) {
          for (let i = 0; i < params.patches.length; i++) {
            const patch = params.patches[i];
            result.push({
              action: 'updateProps',
              tempId: `${opId}-patch-${i}`,
              nodeId: patch.nodeId,
              props: patch.props,
              dependsOn
            } as FigmaAction);
          }
        }
        break;
      }
    }

    if (!result.some(r => r.tempId === opId || r.tempId?.startsWith(`${opId}-`))) {
      throw new Error(`[Translator] Unsupported action type: ${action}`);
    }
  }

  for (const op of operations) {
    processOp(op);
  }

  return result;
}
