/**
 * @file index.ts
 * @description Core shared types for the Figma AI Generator.
 */

import { NodeLayer } from '../../schema/layerSchema';

export interface RenderContext {
  width: number;
  height: number;
  isMobile: boolean;
}

export interface StreamPayload extends NodeLayer {
  __modifyMode: boolean;
  __modifyTargetId?: string;
  designSystemId: string;
  streamSessionId: string;
  renderContext: RenderContext;
}

export interface CreateLayersPayload extends NodeLayer {
  designSystemId: string;
  __traceId: string;
  renderContext: RenderContext;
  meta?: {
    replaceStreamSessionId?: string;
  };
}

export type ThinkingLevel = 'minimal' | 'low' | 'high';
