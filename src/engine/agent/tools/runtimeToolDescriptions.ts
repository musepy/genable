import { RuntimeRequiredParamSpec, RuntimeValidationMode } from './types';
import { QUERY_SOURCES } from './unified/query';

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

const VALID_SOURCES = new Set<string>(QUERY_SOURCES);

export const runtimeToolDescriptions: RuntimeToolDescription[] = [
  {
    tool: 'read',
    mode: 'EXECUTION',
    required: [{ name: 'nodeId', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "nodeId"',
  },
  {
    tool: 'create',
    mode: 'EXECUTION',
    required: [{ name: 'xml', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "xml" string with design markup',
  },
  {
    tool: 'edit',
    mode: 'EXECUTION',
    required: [{ name: 'xml', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "xml" string with edit markup (each tag must have an id attribute)',
  },
  {
    tool: 'query',
    mode: 'EXECUTION',
    required: [
      { name: 'source', trim: true, check: 'required' },
      { name: 'query', trim: true, check: 'required' },
    ],
    invalidRules: [{
      name: 'source',
      reason: `must be one of ${QUERY_SOURCES.join(', ')}`,
      isValid: (args) => typeof args?.source === 'string' && VALID_SOURCES.has(args.source),
    }],
    repairHint: `provide "source" as one of ${QUERY_SOURCES.join(', ')} and a non-empty "query"`,
  },
];
