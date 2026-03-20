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
  {
    tool: 'run',
    mode: 'EXECUTION',
    required: [{ name: 'command', trim: true, check: 'required' }],
    // No invalidRules — command is now a free-form CLI string, not an enum.
    // Validation happens after parsing in unwrapRunCommand → per-command validation.
    repairHint: 'provide "command" as a CLI string (e.g. "ls /", "cat /Card/ -s", "mk /Card/ frame")',
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
  // Unix CLI commands
  {
    tool: 'mk',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'provide a path and props. Example: mk /Card/ frame w:400 layout:column',
  },
  {
    tool: 'grep',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'provide a search query or path with properties. Example: grep Button or grep /Card/ fillColor',
  },
  {
    tool: 'sed',
    mode: 'EXECUTION',
    required: [{ name: 'path', trim: true, check: 'required' }],
    repairHint: 'provide a path and replacement rules. Example: sed /Card/ fillColor:#FFF/#000',
  },
  {
    tool: 'man',
    mode: 'EXECUTION',
    required: [],
    repairHint: 'optionally provide a topic. Example: man components or man guidelines dashboard',
  },
  // FS write commands
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
];
