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

export const runtimeToolDescriptions: RuntimeToolDescription[] = [
  // Core tools
  {
    tool: 'jsx',
    mode: 'EXECUTION',
    required: [{ name: 'markup', trim: true, check: 'required' }],
    repairHint: 'provide "markup" as a JSX string (e.g. "<frame name=\'Card\' w={400}>...</frame>")',
  },
  {
    tool: 'inspect',
    mode: 'EXECUTION',
    required: [{ name: 'node', trim: true, check: 'required' }],
    repairHint: 'provide "node" as a node ref (e.g. "/" for page root, "Card#1:2" for specific node)',
  },
  {
    tool: 'edit',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'provide "node" + "props" for single edit, or "nodes" array for batch',
  },
  // Promoted tools
  {
    tool: 'search',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'provide "query" for find, "node"+"props" for discover, or "node"+"replace" for replace',
  },
  {
    tool: 'structure',
    mode: 'EXECUTION',
    required: [
      { name: 'action', trim: true, check: 'required' },
      { name: 'node', trim: true, check: 'required' },
    ],
    repairHint: 'provide "action" (move/delete/clone) and "node" ref',
  },
  {
    tool: 'knowledge',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'optionally provide "topic" or "source"+"tags"',
  },
  {
    tool: 'var',
    mode: 'EXECUTION',
    required: [{ name: 'action', trim: true, check: 'required' }],
    repairHint: 'provide "action" (ls/create/bind/alias) and required params',
  },
  {
    tool: 'comp',
    mode: 'EXECUTION',
    required: [{ name: 'action', trim: true, check: 'required' }],
    repairHint: 'provide "action" (create/combine/prop/ls/instance) and required params',
  },
  {
    tool: 'js',
    mode: 'EXECUTION',
    required: [{ name: 'code', trim: true, check: 'required' }],
    repairHint: 'provide "code" as a JavaScript expression or statement',
  },
];
