import { RuntimeRequiredParamSpec, RuntimeValidationMode } from './types';

interface RuntimeConditionalRequiredRule {
  when: (args: any) => boolean;
  required: RuntimeRequiredParamSpec[];
}

interface RuntimeInvalidRule {
  name: string;
  reason: string;
  isValid: (args: any) => boolean;
}

export interface RuntimeToolDescription {
  tool: string;
  mode: RuntimeValidationMode;
  required: RuntimeRequiredParamSpec[];
  conditionalRequired?: RuntimeConditionalRequiredRule[];
  invalidRules?: RuntimeInvalidRule[];
  repairHint: string;
}

const SIGNAL_TYPES = new Set(['plan', 'task_start', 'progress', 'complete']);
const KNOWLEDGE_SOURCES = new Set(['knowledge', 'components', 'tokens']);

function normalizedMode(args: any): string {
  if (!args || typeof args !== 'object') return '';
  const rawMode = args.mode;
  if (typeof rawMode !== 'string') return '';
  return rawMode.trim();
}

export const runtimeToolDescriptions: RuntimeToolDescription[] = [
  {
    tool: 'signal',
    mode: 'EXECUTION',
    required: [{ name: 'type', trim: true, check: 'required' }],
    invalidRules: [{
      name: 'type',
      reason: 'must be one of plan, task_start, progress, complete',
      isValid: (args) => typeof args?.type === 'string' && SIGNAL_TYPES.has(args.type),
    }],
    repairHint: 'set "type" to one of plan, task_start, progress, or complete',
  },
  {
    tool: 'read_node',
    mode: 'EXECUTION',
    required: [{ name: 'mode', trim: true, check: 'required' }],
    conditionalRequired: [{
      when: (args) => {
        const mode = normalizedMode(args);
        return mode === 'node' || mode === 'hierarchy';
      },
      required: [{ name: 'nodeId', trim: true, check: 'required' }],
    }],
    repairHint: 'provide "mode", and for "node"/"hierarchy" modes include a non-empty "nodeId"',
  },
  {
    tool: 'create_node',
    mode: 'EXECUTION',
    required: [{ name: 'nodes', check: 'non_empty_array' }],
    repairHint: 'provide a non-empty array of nodes',
  },
  {
    tool: 'patch_node',
    mode: 'EXECUTION',
    required: [
      { name: 'patches', check: 'non_empty_array' },
      { name: 'patches[].nodeId', source: 'map', mapPath: 'patches[].nodeId', trim: true, check: 'required' },
      { name: 'patches[].props', source: 'map', mapPath: 'patches[].props', check: 'non_empty_object' },
    ],
    repairHint: 'provide non-empty "patches", and for each patch include non-empty "nodeId" and non-empty "props"',
  },
  {
    tool: 'delete_node',
    mode: 'EXECUTION',
    required: [{ name: 'nodeId', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "nodeId"',
  },
  {
    tool: 'query_knowledge',
    mode: 'EXECUTION',
    required: [{ name: 'source', trim: true, check: 'required' }],
    invalidRules: [{
      name: 'source',
      reason: 'must be one of knowledge, components, tokens',
      isValid: (args) => typeof args?.source === 'string' && KNOWLEDGE_SOURCES.has(args.source),
    }],
    repairHint: 'provide "source" as one of knowledge, components, or tokens',
  },
  {
    tool: 'validate_design',
    mode: 'EXECUTION',
    required: [{ name: 'nodeId', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "nodeId"',
  },
];

