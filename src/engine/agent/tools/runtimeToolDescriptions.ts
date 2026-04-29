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
    repairHint: 'provide "node" ref + "parent", "name", or "index"',
  },
  {
    tool: 'clone_node',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'parent', trim: true, check: 'required' },
    ],
    repairHint: 'provide "node" ref and "parent" path',
  },
  // ask_user — multi-question form (1-4 questions, each with 2-4 options)
  {
    tool: 'ask_user',
    mode: 'EXECUTION',
    required: [{ name: 'questions', trim: false, check: 'required' }],
    repairHint: 'provide "questions" — an array of 1-4 entries, each { question, options[2-4], multiSelect? }',
  },
  // Knowledge readers — one entry per category, all share the same shape
  {
    tool: 'skill',
    mode: 'EXECUTION',
    required: [{ name: 'name', trim: true, check: 'required' }],
    repairHint: 'provide "name" — a bare skill name from the KNOWLEDGE LIBRARY menu, e.g. skill({ name: "restyle" })',
  },
  {
    tool: 'style',
    mode: 'EXECUTION',
    required: [{ name: 'name', trim: true, check: 'required' }],
    repairHint: 'provide "name" — a bare style name from the KNOWLEDGE LIBRARY menu, e.g. style({ name: "neon-cyber" })',
  },
  {
    tool: 'anatomy',
    mode: 'EXECUTION',
    required: [{ name: 'name', trim: true, check: 'required' }],
    repairHint: 'provide "name" — a bare anatomy name from the KNOWLEDGE LIBRARY menu, e.g. anatomy({ name: "data-table" })',
  },
  {
    tool: 'guideline',
    mode: 'EXECUTION',
    required: [{ name: 'name', trim: true, check: 'required' }],
    repairHint: 'provide "name" — a bare guideline name from the KNOWLEDGE LIBRARY menu, e.g. guideline({ name: "form" })',
  },
  {
    tool: 'help',
    mode: 'EXECUTION',
    required: [{ name: 'name', trim: true, check: 'required' }],
    repairHint: 'provide "name" — a bare help name from the KNOWLEDGE LIBRARY menu, e.g. help({ name: "interaction-model" })',
  },
  // Variable tools
  {
    tool: 'list_variables',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'optionally provide "collection" (VariableCollectionId), "filter", "cursor", or "limit"',
  },
  {
    tool: 'create_collection',
    mode: 'EXECUTION',
    required: [
      { name: 'name', trim: true, check: 'required' },
      { name: 'modes', check: 'required' },
    ],
    repairHint: 'provide "name" and "modes" (array of mode names, first is default)',
  },
  {
    tool: 'create_variable',
    mode: 'EXECUTION',
    required: [
      { name: 'collection', trim: true, check: 'required' },
      { name: 'name', trim: true, check: 'required' },
      { name: 'type', trim: true, check: 'required' },
    ],
    repairHint: 'provide "collection" (VariableCollectionId), "name", and "type" (COLOR/FLOAT/STRING/BOOLEAN)',
  },
  {
    tool: 'set_variable_value',
    mode: 'EXECUTION',
    required: [
      { name: 'variable', trim: true, check: 'required' },
      { name: 'mode', trim: true, check: 'required' },
      { name: 'value', check: 'required' },
    ],
    repairHint: 'provide "variable" (VariableID), "mode" (modeId), and "value"',
  },
  {
    tool: 'bind_variable',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'prop', trim: true, check: 'required' },
      { name: 'variable', trim: true, check: 'required' },
    ],
    repairHint: 'provide "node", "prop", and "variable" (VariableID)',
  },
  {
    tool: 'set_variable_mode',
    mode: 'EXECUTION',
    required: [
      { name: 'node', trim: true, check: 'required' },
      { name: 'collection', trim: true, check: 'required' },
      { name: 'mode', trim: true, check: 'required' },
    ],
    repairHint: 'provide "node" (id), "collection" (VariableCollectionId), and "mode" (modeId)',
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
