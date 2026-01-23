export interface LintWarning {
  message?: string;
  severity: 'error' | 'warning';
  nodeId?: string;
  nodePath?: string;
  nodeName?: string;
  ruleId?: string;
  rule?: string;
  semanticContext?: string;
  humanMessage?: string;
  machineReadable?: {
    expected?: string;
    [key: string]: any;
  };
}
