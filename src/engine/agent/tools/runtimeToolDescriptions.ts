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
    repairHint: 'provide "node" as a node ref (e.g. "/" for page root, "1:2" for specific node)',
  },
  {
    tool: 'edit',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'provide "node" + "props" for single edit, or "nodes" array for batch',
  },
  // Search tools
  {
    tool: 'find_nodes',
    mode: 'EXECUTION',
    required: [{ name: 'query', trim: true, check: 'required' }],
    repairHint: 'provide "query" string to search nodes by name or type',
  },
  {
    tool: 'discover_props',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'props', check: 'required' },
    ],
    repairHint: 'provide "node" ref and "props" array of property names',
  },
  {
    tool: 'replace_props',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'rules', check: 'required' },
    ],
    repairHint: 'provide "node" ref and "rules" array [{prop, from, to}]',
  },
  // Structure tools
  {
    tool: 'delete_node',
    mode: 'EXECUTION',
    required: [{ name: 'node', trim: true, check: 'required' }],
    repairHint: 'provide "node" ref to delete',
  },
  {
    tool: 'move_node',
    mode: 'EXECUTION',
    required: [{ name: 'node', trim: true, check: 'required' }],
    repairHint: 'provide "node" ref + "dest", "name", or "index"',
  },
  {
    tool: 'clone_node',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'dest', trim: true, check: 'required' },
    ],
    repairHint: 'provide "node" ref and "dest" path',
  },
  // Knowledge
  {
    tool: 'knowledge',
    mode: 'EXECUTION',
    required: [{ name: 'id', trim: true, check: 'required' }],
    repairHint: 'provide "id" from the KNOWLEDGE LIBRARY menu',
  },
  // Variable tools
  {
    tool: 'list_variables',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'optionally provide "collection" to filter',
  },
  {
    tool: 'create_variable',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'provide "variable"+"type"+"value" for a variable, or "collection" for a collection',
  },
  {
    tool: 'bind_variable',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'prop', trim: true, check: 'required' },
      { name: 'variable', trim: true, check: 'required' },
    ],
    repairHint: 'provide "node", "prop", and "variable" path',
  },
  {
    tool: 'alias_variable',
    mode: 'EXECUTION',
    required: [
      { name: 'variable', trim: true, check: 'required' },
      { name: 'target', trim: true, check: 'required' },
    ],
    repairHint: 'provide "variable" and "target" paths',
  },
  // Component tools
  {
    tool: 'create_component',
    mode: 'EXECUTION',
    required: [{ name: 'node', trim: true, check: 'required' }],
    repairHint: 'provide "node" ref to convert to component',
  },
  {
    tool: 'combine_components',
    mode: 'EXECUTION',
    required: [{ name: 'nodes', check: 'required' }],
    repairHint: 'provide "nodes" array of component refs',
  },
  {
    tool: 'add_component_prop',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'name', trim: true, check: 'required' },
      { name: 'type', trim: true, check: 'required' },
    ],
    repairHint: 'provide "node", "name", and "type" (TEXT/BOOLEAN/INSTANCE_SWAP)',
  },
  {
    tool: 'list_component_props',
    mode: 'EXECUTION',
    required: [{ name: 'node', trim: true, check: 'required' }],
    repairHint: 'provide "node" ref of component or instance',
  },
  {
    tool: 'create_instance',
    mode: 'EXECUTION',
    required: [{ name: 'node', trim: true, check: 'required' }],
    repairHint: 'provide "node" ref of component to instantiate',
  },
  // Escape hatch
  {
    tool: 'js',
    mode: 'EXECUTION',
    required: [{ name: 'code', trim: true, check: 'required' }],
    repairHint: 'provide "code" as a JavaScript expression or statement',
  },
];
