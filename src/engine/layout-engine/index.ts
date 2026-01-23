import { LintWarning } from './types';
import { CorrectionLog } from '../../types/chat';

export type { CorrectionLog };

export * from './types';

// Stub for the missing lint function
export function lint(node: any): LintWarning[] {
  console.log('[LayoutEngine] Lint stub called');
  return [];
}

export function hasErrors(warnings: any[]): boolean {
  return warnings.length > 0;
}

export function formatWarningsForRetry(warnings: any[]): string {
  return '';
}

export function formatSemanticFeedback(issues: LintWarning[], designSystemId?: string): string {
    return '';
}

export function generateSemanticContext(node: any, designSystemId?: string): string {
    return '';
}

export function postProcess(node: any, debug?: boolean): any {
    return node;
}

export function getCorrectionRules(): any[] {
    return [];
}
