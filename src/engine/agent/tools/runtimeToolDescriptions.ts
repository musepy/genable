import { RuntimeRequiredParamSpec, RuntimeValidationMode } from './types';
import { QUERY_SOURCES } from './unified/query';
import { isValidCommand } from './unified/commandRegistry';

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
    tool: 'run',
    mode: 'EXECUTION',
    required: [{ name: 'command', trim: true, check: 'required' }],
    // No invalidRules — command is now a free-form CLI string, not an enum.
    // Validation happens after parsing in unwrapRunCommand → per-command validation.
    repairHint: 'provide "command" as a CLI string (e.g. "ls /", "cat /Card/ -s", "design")',
  },
  // VFS read commands — path-based
  {
    tool: 'ls',
    mode: 'EXECUTION',
    required: [{ name: 'path', trim: true, check: 'required' }],
    repairHint: 'provide a "path" (e.g. "/" for page root, "/Card/" for a named node)',
  },
  {
    tool: 'tree',
    mode: 'EXECUTION',
    required: [{ name: 'path', trim: true, check: 'required' }],
    repairHint: 'provide a "path" (e.g. "/" for page root, "/Card/" for a named node)',
  },
  {
    tool: 'cat',
    mode: 'EXECUTION',
    required: [{ name: 'path', trim: true, check: 'required' }],
    repairHint: 'provide a "path" (e.g. "/Card/" or "/Card/Header/Title")',
  },
  // Write commands — unchanged
  {
    tool: 'design',
    mode: 'EXECUTION',
    required: [{ name: 'ops', trim: true, check: 'required' }],
    repairHint: 'provide a non-empty "ops" string with flat ops (create, update, or delete operations)',
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
      when: (args) => args?.source !== 'style-tags' && args?.source !== 'help',
      required: [{ name: 'query', trim: true, check: 'required' }],
    }],
    invalidRules: [{
      name: 'source',
      reason: `must be one of ${QUERY_SOURCES.join(', ')}`,
      isValid: (args) => typeof args?.source === 'string' && VALID_SOURCES.has(args.source),
    }],
    repairHint: `provide "source" as one of ${QUERY_SOURCES.join(', ')} and a non-empty "query" (except for "style-tags" and "help" which can omit query)`,
  },
  // FS write commands — path-based
  {
    tool: 'mkdir',
    mode: 'EXECUTION',
    required: [{ name: 'path', trim: true, check: 'required' }],
    repairHint: 'provide a "path" for the node to create (e.g. "/Card/" or "/Card/Header/")',
  },
  {
    tool: 'mktext',
    mode: 'EXECUTION',
    required: [{ name: 'path', trim: true, check: 'required' }],
    repairHint: 'provide a "path" for the text node (e.g. "/Card/Title") and optionally text content',
  },
  {
    tool: 'write',
    mode: 'EXECUTION',
    required: [
      { name: 'path', trim: true, check: 'required' },
      { name: 'propsRaw', trim: true, check: 'required' },
    ],
    repairHint: 'provide a "path" and "propsRaw" with properties to update (e.g. {bg:#000})',
  },
  {
    tool: 'rm',
    mode: 'EXECUTION',
    required: [{ name: 'path', trim: true, check: 'required' }],
    repairHint: 'provide a "path" to the node to delete (e.g. "/Card/OldSection/")',
  },
  {
    tool: 'cp',
    mode: 'EXECUTION',
    required: [
      { name: 'sourcePath', trim: true, check: 'required' },
      { name: 'destPath', trim: true, check: 'required' },
    ],
    repairHint: 'provide "sourcePath" and "destPath" (e.g. cp /Card/Default/ /Card/Hover/ {overrides})',
  },
  {
    tool: 'ln',
    mode: 'EXECUTION',
    required: [
      { name: 'path', trim: true, check: 'required' },
      { name: 'component', trim: true, check: 'required' },
    ],
    repairHint: 'provide a "path" and "component" name (e.g. ln /Card/BtnInst Button)',
  },
];
