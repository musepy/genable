import { describe, it, expect } from 'vitest';
import { translateBatchOperationsToActions } from '../translator';

describe('translateBatchOperationsToActions', () => {
  it('translates nested createNode operations', () => {
    const batch = [
      {
        opId: 'row-container',
        action: 'createNode',
        params: {
          type: 'FRAME',
          props: { layoutMode: 'HORIZONTAL', gap: 12 },
          children: [
            { opId: 'col-1', action: 'createNode', params: { type: 'TEXT', characters: 'Label' } },
            { opId: 'col-2', action: 'createNode', params: { type: 'TEXT', characters: 'Value' } }
          ]
        }
      }
    ];

    const actions = translateBatchOperationsToActions(batch);
    expect(actions).toHaveLength(3);
    
    expect(actions[0]).toEqual({
      action: 'createFrame',
      tempId: 'row-container',
      nodeId: undefined,
      parentId: undefined,
      dependsOn: undefined,
      props: { layoutMode: 'HORIZONTAL', gap: 12 }
    });

    expect(actions[1]).toEqual({
      action: 'createText',
      tempId: 'col-1',
      parentId: 'row-container',
      nodeId: undefined,
      dependsOn: undefined,
      props: { characters: 'Label' }
    });
    
    expect(actions[2]).toEqual({
      action: 'createText',
      tempId: 'col-2',
      parentId: 'row-container',
      nodeId: undefined,
      dependsOn: undefined,
      props: { characters: 'Value' }
    });
  });

  it('handles applyDesignPatch by expanding to updateProps', () => {
    const batch = [
      {
        opId: 'patch-op',
        action: 'applyDesignPatch',
        params: {
          patches: [
            { nodeId: '1:1', props: { fill: '#f00' } },
            { nodeId: '1:2', props: { fill: '#0f0' } }
          ]
        }
      }
    ];

    const actions = translateBatchOperationsToActions(batch);
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('updateProps');
    expect(actions[0].nodeId).toBe('1:1');
    expect(actions[1].action).toBe('updateProps');
    expect(actions[1].nodeId).toBe('1:2');
  });

  it('merges updateNodeProperties and setNodeLayout', () => {
    const batch = [
      {
        opId: 'update-1',
        action: 'updateNodeProperties',
        params: {
          nodeRef: 'container-1',
          props: { fill: '#333' }
        }
      }
    ];

    const actions = translateBatchOperationsToActions(batch);
    expect(actions[0].action).toBe('updateProps');
    expect(actions[0].props).toEqual({ fill: '#333' });
    expect(actions[0].nodeId).toBe('container-1');
  });

  it('translates createIcon params into props payload', () => {
    const batch = [
      {
        opId: 'icon-1',
        action: 'createIcon',
        params: {
          iconName: 'lucide:home',
          size: 24,
          color: '#111111'
        }
      }
    ];

    const actions = translateBatchOperationsToActions(batch);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      action: 'createIcon',
      tempId: 'icon-1',
      parentId: undefined,
      dependsOn: undefined,
      nodeId: undefined,
      props: {
        iconName: 'lucide:home',
        width: 24,
        height: 24,
        fills: ['#111111']
      }
    });
  });
});
