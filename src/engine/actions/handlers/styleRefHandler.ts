/**
 * @file styleRefHandler.ts
 * @description Applies Figma styles by name reference.
 *
 * Usage in mk:  textStyle:Heading/H1  fillStyle:Brand/Primary
 *
 * The handler looks up local styles by name and sets the corresponding styleId.
 */

import { PropertyHandler, Warning } from './types';

/** Map from mk property name → async setter method on SceneNode */
const STYLE_SETTER_MAP: Record<string, string> = {
  textStyle: 'setTextStyleIdAsync',
  fillStyle: 'setFillStyleIdAsync',
  strokeStyle: 'setStrokeStyleIdAsync',
  effectStyle: 'setEffectStyleIdAsync',
};

/** Map from mk property name → Figma style type for lookup */
const STYLE_TYPE_MAP: Record<string, 'TEXT' | 'PAINT' | 'EFFECT'> = {
  textStyle: 'TEXT',
  fillStyle: 'PAINT',
  strokeStyle: 'PAINT',
  effectStyle: 'EFFECT',
};

async function findStyleByName(
  name: string,
  type: 'TEXT' | 'PAINT' | 'EFFECT',
): Promise<BaseStyle | null> {
  let styles: BaseStyle[];
  if (type === 'TEXT') {
    styles = await figma.getLocalTextStylesAsync();
  } else if (type === 'PAINT') {
    styles = await figma.getLocalPaintStylesAsync();
  } else {
    styles = await figma.getLocalEffectStylesAsync();
  }
  return styles.find(s => s.name === name) ?? null;
}

export const styleRefHandler: PropertyHandler = {
  name: 'styleRef',

  match(key: string): boolean {
    return key in STYLE_SETTER_MAP;
  },

  async apply(node: SceneNode, key: string, value: any): Promise<Warning[]> {
    const styleName = String(value);
    const setter = STYLE_SETTER_MAP[key];
    const styleType = STYLE_TYPE_MAP[key];

    const style = await findStyleByName(styleName, styleType);

    if (!style) {
      return [{
        code: 'STYLE_NOT_FOUND',
        severity: 'warning',
        message: `${styleType} style '${styleName}' not found. Create it first or check the name.`,
      }];
    }

    try {
      await (node as any)[setter](style.id);
      return [];
    } catch (e: any) {
      return [{
        code: 'STYLE_APPLY_FAILED',
        severity: 'warning',
        message: `Failed to apply style '${styleName}' to '${key}': ${e?.message ?? e}`,
      }];
    }
  },
};
