import { ChatMessage, ToolCallRecord } from '../../types/chat';

interface DigestMeta {
  modelName?: string;
}

/**
 * Tool-specific parameter extractors to keep only essential info.
 */
const parameterExtractors: Record<string, (params: any) => string> = {
  jsx: (params) => {
    const parts: string[] = [];
    if (typeof params.jsx === 'string') parts.push(`jsx: ${params.jsx.length} chars`);
    if (params.parent) parts.push(`parent: ${params.parent}`);
    return parts.join(', ') || 'empty';
  },
  edit: (params) => {
    if (typeof params.jsx === 'string') return `jsx: ${params.jsx.length} chars`;
    return params.target ? `target: ${params.target}` : 'empty';
  },
  inspect: (params) => {
    const depthStr = params.depth !== undefined ? `, depth: ${params.depth}` : '';
    return `target: ${params.target || '?'}${depthStr}`;
  },
  knowledge: (params) => `action: ${params.action || '?'}, ${params.query ? `query: ${params.query.slice(0, 60)}` : params.id ? `id: ${params.id}` : ''}`,
};

/**
 * Extracts key information from tool results.
 */
function extractResultInfo(tool: ToolCallRecord): string {
  const data = tool.result?.data;
  if (!data || typeof data !== 'object') return '';

  // jsx tool returns node tree info
  if (tool.name === 'jsx') {
    const parts: string[] = [];
    if (data.id) parts.push(`id: ${data.id}`);
    if (data.name) parts.push(`name: ${data.name}`);
    if (typeof data.created === 'number') parts.push(`created: ${data.created}`);
    return parts.join(', ');
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

        const extractor = parameterExtractors[tool.name];
        const paramsStr = extractor ? extractor(tool.parameters) : Object.keys(tool.parameters || {}).join(', ') || 'empty';
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

  // Debrief section (if available from a previous difficult run)
  const lastModel = [...history].reverse().find(m => m.role === 'model' && m.debrief);
  if (lastModel?.debrief) {
    lines.push('--- AGENT DEBRIEF ---');
    lines.push(`Exit reason: ${lastModel.debrief.exitReason}`);
    lines.push(lastModel.debrief.text);
    lines.push('');
  }

  lines.push('=== END DIGEST ===');

  return lines.join('\n');
}
