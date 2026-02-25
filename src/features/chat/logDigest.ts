import { ChatMessage, ToolCallRecord } from '../../types/chat';

interface DigestMeta {
  modelName?: string;
}

/**
 * Tool-specific parameter extractors to keep only essential info.
 */
const parameterExtractors: Record<string, (params: any) => string> = {
  batchOperations: (params) => {
    if (!params.operations || !Array.isArray(params.operations)) {
      return params._truncated ? '[Truncated Operations]' : JSON.stringify(params).slice(0, 100);
    }
    return params.operations
      .map((op: any) => {
        const action = op.action || op.type || '?';
        const name = op.params?.name || op.name || op.params?.nodeId || op.nodeId || op.opId || '?';
        const type = op.params?.type ? `/${op.params.type}` : '';
        return `${action}(${name}${type})`;
      })
      .join(', ');
  },
  applyDesignPatch: (params) => {
    if (!Array.isArray(params.patches)) {
      if (params._truncated && params.patches) return `[${params.patches.length} patches truncated]`;
      return JSON.stringify(params).slice(0, 100);
    }
    return params.patches
      .map((p: any) => `${p.nodeId || p.nodeRef || '?'}{${Object.keys(p).filter(k => !['nodeId', 'nodeRef'].includes(k)).join(',')}}`)
      .join(', ');
  },
  createIcon: (params) => `${params.name || '?'}, ${params.size || 'default'}, ${params.color || 'default'}`,
  planDesign: (params) => `${params.approach || 'default'}, steps:${params.steps?.length || 0}`,
  inspectDesign: (params) => {
    if (params.mode) {
      if (params.mode === 'selection') return `mode: selection`;
      const depthStr = params.depth !== undefined ? `, depth: ${params.depth}` : '';
      return `mode: ${params.mode}, nodeId: ${params.nodeId || '?'}${depthStr}`;
    }
    return `nodeIds: ${params.nodeIds?.join(',') || params.nodeId || '?'}`;
  },
  complete_task: (params) => (params.summary || '').slice(0, 80),
  renderSubtree: (params) => {
    if (Array.isArray(params.nodes)) return `nodes:${params.nodes.length}, parent:${params.parentId || 'root'}`;
    return `${params.nodeId || '?'}, ${params.type || '?'}`;
  },
  patchNode: (params) => `${params.nodeId || '?'}, props:${Object.keys(params.props || {}).join(',')}`,
  generateDesign: (params) => {
    if (!Array.isArray(params.nodes)) return JSON.stringify(params).slice(0, 100);
    const summary = params.nodes
      .slice(0, 3)
      .map((n: any) => `${n.type}(${n.props?.name || n.id || '?'})`)
      .join(', ');
    const more = params.nodes.length > 3 ? `... (+${params.nodes.length - 3} more)` : '';
    return `nodes:${params.nodes.length} [${summary}${more}]`;
  },
};

/**
 * Extracts key information from tool results.
 */
function extractResultInfo(tool: ToolCallRecord): string {
  if (tool.status === 'error') return '';
  const idMap = tool.result?.data?.idMap || tool.result?.idMap;
  if (tool.name === 'batchOperations' && idMap) {
    const mappings = Object.entries(idMap)
      .map(([key, id]) => `${key}→${id}`)
      .join(', ');
    return mappings ? `ids: ${mappings}` : '';
  }
  return '';
}

/**
 * Generates a concise summary of Agent execution logs.
 * Target: 90%+ compression for long logs.
 */
export function generateLogDigest(history: ChatMessage[], meta?: DigestMeta): string {
  const lines: string[] = [];
  let totalTools = 0;
  let errorTools = 0;
  let startTime = 0;
  let endTime = 0;
  let prompt = '';

  // Analysis pass
  history.forEach(msg => {
    if (msg.role === 'user' && !prompt) {
      prompt = msg.text.trim();
    }
    if (msg.toolCalls) {
      msg.toolCalls.forEach(tool => {
        totalTools++;
        if (tool.status === 'error') errorTools++;
        if (!startTime || tool.startTime < startTime) startTime = tool.startTime;
        if (!endTime || (tool.endTime && tool.endTime > endTime)) endTime = tool.endTime!;
      });
    }
  });

  const duration = endTime > startTime ? ((endTime - startTime) / 1000).toFixed(1) : '0';
  const totalIterations = history.filter(m => m.role === 'model' && m.iterations).reduce((acc, m) => acc + (m.iterations?.length || 0), 0);

  // Header
  lines.push('=== AGENT DIGEST ===');
  lines.push(`Prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
  lines.push(`Iterations: ${totalIterations} | Duration: ${duration}s | Tools: ${totalTools - errorTools} ok, ${errorTools} err`);
  lines.push('');

  // Timeline
  lines.push('--- TIMELINE ---');
  let toolIndex = 1;
  const MAX_TOOL_CALLS = 50;
  let skippedTools = 0;

  history.forEach(msg => {
    if (msg.role === 'model' && msg.toolCalls) {
      msg.toolCalls.forEach(tool => {
        if (toolIndex > MAX_TOOL_CALLS) {
          skippedTools++;
          toolIndex++;
          return;
        }

        const status = tool.status === 'error' ? 'ERR' : 'OK';
        const toolDuration = tool.endTime ? `${tool.endTime - tool.startTime}ms` : '?';
        lines.push(`#${toolIndex} [${tool.name}] ${toolDuration} ${status}`);
        
        // Extract thinking if available (approximate link to tool call)
        // Note: Real link is via iteration toolCallIds, but for digest a sequential flow is usually enough
        
        const extractor = parameterExtractors[tool.name];
        const paramsStr = extractor ? extractor(tool.parameters) : JSON.stringify(tool.parameters).slice(0, 100);
        lines.push(`   params: {${paramsStr}}`);

        const resultInfo = extractResultInfo(tool);
        if (resultInfo) lines.push(`   ${resultInfo}`);

        if (tool.error) {
          lines.push(`   error: "${tool.error.split('\n')[0]}"`);
        }
        
        lines.push('');
        toolIndex++;
      });
    }
  });

  if (skippedTools > 0) {
    lines.push(`... and ${skippedTools} more tool calls truncated for brevity ...`);
    lines.push('');
  }

  // Errors section
  if (errorTools > 0) {
    lines.push('--- ERRORS ---');
    toolIndex = 1;
    history.forEach(msg => {
      if (msg.role === 'model' && msg.toolCalls) {
        msg.toolCalls.forEach(tool => {
          if (tool.status === 'error') {
            lines.push(`#${toolIndex} ${tool.name}: "${tool.error?.split('\n')[0]}"`);
          }
          toolIndex++;
        });
      }
    });
    lines.push('');
  }

  lines.push('=== END DIGEST ===');

  return lines.join('\n');
}
