/**
 * @file compAdapter.ts
 * @description Thin adapter for the `comp` tool — maps structured params to handleComp.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleComp } from './compHandlers';

export async function handleCompTool(params: any): Promise<ToolResponse> {
  return handleComp({
    subcommand: params.action,
    paths: params.nodes || (params.node ? [params.node] : []),
    name: params.name,
    propType: params.type,
    defaultValue: params.default,
    parent: params.parent,
  });
}
