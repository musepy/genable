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
    tool: 'context',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'no parameters needed',
  },
  {
    tool: 'outline',
    mode: 'EXECUTION',
    required: [{ name: 'nodeId', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "nodeId"',
  },
  {
    tool: 'inspect',
    mode: 'EXECUTION',
    required: [{ name: 'nodeId', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "nodeId"',
  },
  {
    tool: 'design',
    mode: 'EXECUTION',
    required: [{ name: 'xml', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "xml" string with design markup (create, edit, or delete nodes)',
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
    tool: 'replace',
    mode: 'EXECUTION',
    required: [
      { name: 'mode', trim: true, check: 'required' },
      { name: 'rootId', trim: true, check: 'required' },
    ],
    conditionalRequired: [
      {
        when: (args) => args?.mode === 'search',
        required: [{ name: 'properties', trim: false, check: 'required' }],
      },
      {
        when: (args) => args?.mode === 'replace',
        required: [{ name: 'replacements', trim: false, check: 'required' }],
      },
    ],
    invalidRules: [{
      name: 'mode',
      reason: 'must be "search" or "replace"',
      isValid: (args) => typeof args?.mode === 'string' && (args.mode === 'search' || args.mode === 'replace'),
    }],
    repairHint: 'provide "mode" as "search" or "replace", a valid "rootId", and either "properties" (search) or "replacements" (replace)',
  },
  {
    tool: 'query',
    mode: 'EXECUTION',
    required: [
      { name: 'source', trim: true, check: 'required' },
    ],
    conditionalRequired: [{
      when: (args) => args?.source !== 'style-tags',
      required: [{ name: 'query', trim: true, check: 'required' }],
    }],
    invalidRules: [{
      name: 'source',
      reason: `must be one of ${QUERY_SOURCES.join(', ')}`,
      isValid: (args) => typeof args?.source === 'string' && VALID_SOURCES.has(args.source),
    }],
    repairHint: `provide "source" as one of ${QUERY_SOURCES.join(', ')} and a non-empty "query" (except for "style-tags")`,
  },
];
