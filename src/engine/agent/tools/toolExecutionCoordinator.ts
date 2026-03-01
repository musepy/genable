import {
  RuntimeRequiredParamSpec,
  RuntimeToolValidationResult,
  RuntimeValidationMode,
  ToolValidationErrorDetail,
  ToolValidationInvalidParam,
} from './types';
import { runtimeToolDescriptions } from './runtimeToolDescriptions';

type ValidationStatus = 'valid' | 'missing' | 'invalid';

interface MapResolvedValue {
  value: any;
  path: string;
}

export class ToolExecutionCoordinator {
  private static readonly LEGACY_TOOL_REPAIR_HINTS: Record<string, string> = {
    plan: 'call signal with type "plan"',
    task_start: 'call signal with type "task_start"',
    progress: 'call signal with type "progress"',
    complete: 'call signal with type "complete"',
    new_task: 'call signal with type "task_start"',
    update_todo_list: 'call signal with type "progress"',
    summarize_progress: 'call signal with type "progress"',
    complete_task: 'call signal with type "complete"',
  };

  private readonly descriptionMap = new Map(
    runtimeToolDescriptions.map((description) => [`${description.mode}:${description.tool}`, description])
  );

  validateToolCall(
    toolName: string,
    args: any,
    mode: RuntimeValidationMode = 'EXECUTION',
    allowedToolNames?: Iterable<string>
  ): RuntimeToolValidationResult {
    const normalizedArgs =
      args && typeof args === 'object' && !Array.isArray(args)
        ? args
        : {};

    const allowedTools = this.normalizeAllowedToolNames(allowedToolNames);
    if (allowedTools && !allowedTools.has(toolName)) {
      return this.buildUnknownToolError(toolName, mode, normalizedArgs, allowedTools);
    }

    const description = this.descriptionMap.get(`${mode}:${toolName}`);
    if (!description) return { ok: true };

    const missing = new Set<string>();
    const invalid: ToolValidationInvalidParam[] = [];

    this.validateRequiredSpecs(description.required, normalizedArgs, missing, invalid);
    for (const conditional of description.conditionalRequired || []) {
      if (conditional.when(normalizedArgs)) {
        this.validateRequiredSpecs(conditional.required, normalizedArgs, missing, invalid);
      }
    }

    for (const invalidRule of description.invalidRules || []) {
      const value = normalizedArgs[invalidRule.name];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && value.trim().length === 0) continue;
      if (invalidRule.isValid(normalizedArgs)) continue;
      invalid.push({
        name: invalidRule.name,
        reason: invalidRule.reason,
      });
    }

    const details: ToolValidationErrorDetail = {
      tool: toolName,
      mode,
      missing: Array.from(missing),
      invalid: this.dedupeInvalid(invalid),
      receivedKeys: Object.keys(normalizedArgs),
      repairHint: description.repairHint,
    };

    if (details.missing.length === 0 && details.invalid.length === 0) {
      return { ok: true };
    }

    return {
      ok: false,
      error: {
        code: 'TOOL_VALIDATION_ERROR',
        message: this.buildActionableMessage(details),
        details,
      },
    };
  }

  private validateRequiredSpecs(
    specs: RuntimeRequiredParamSpec[],
    args: Record<string, any>,
    missing: Set<string>,
    invalid: ToolValidationInvalidParam[]
  ): void {
    for (const spec of specs) {
      if (spec.source === 'map') {
        const mapPath = spec.mapPath || spec.name;
        const mappedValues = this.resolveMapPathValues(args, mapPath);
        if (!mappedValues || mappedValues.length === 0) continue;
        for (const mapped of mappedValues) {
          const result = this.validateValue(mapped.value, spec);
          if (result.status === 'missing') {
            missing.add(spec.name);
          } else if (result.status === 'invalid') {
            invalid.push({
              name: spec.name,
              reason: result.reason,
              mapPath: mapped.path,
            });
          }
        }
        continue;
      }

      const result = this.validateValue(args[spec.name], spec);
      if (result.status === 'missing') {
        missing.add(spec.name);
      } else if (result.status === 'invalid') {
        invalid.push({
          name: spec.name,
          reason: result.reason,
        });
      }
    }
  }

  private validateValue(
    value: any,
    spec: RuntimeRequiredParamSpec
  ): { status: ValidationStatus; reason: string } {
    const check = spec.check || 'required';
    const shouldTrim = spec.trim !== false;

    if (value === undefined || value === null) {
      return { status: 'missing', reason: 'value is required' };
    }

    if (typeof value === 'string' && shouldTrim && value.trim().length === 0) {
      return { status: 'missing', reason: 'value cannot be empty' };
    }

    if (check === 'non_empty_array') {
      if (!Array.isArray(value)) {
        return { status: 'invalid', reason: 'must be a non-empty array' };
      }
      if (value.length === 0) {
        return { status: 'missing', reason: 'array cannot be empty' };
      }
    } else if (check === 'non_empty_object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { status: 'invalid', reason: 'must be a non-empty object' };
      }
      if (Object.keys(value).length === 0) {
        return { status: 'missing', reason: 'object cannot be empty' };
      }
    }

    return { status: 'valid', reason: '' };
  }

  private resolveMapPathValues(
    args: Record<string, any>,
    mapPath: string
  ): MapResolvedValue[] | null {
    const segments = mapPath.split('.').filter(Boolean);
    if (segments.length === 0) return null;

    let cursor: MapResolvedValue[] = [{ value: args, path: '' }];

    for (const segment of segments) {
      if (segment.endsWith('[]')) {
        const arrayKey = segment.slice(0, -2);
        const next: MapResolvedValue[] = [];

        for (const entry of cursor) {
          const arrayValue = entry.value?.[arrayKey];
          if (!Array.isArray(arrayValue)) return null;
          for (let index = 0; index < arrayValue.length; index++) {
            const pathPrefix = entry.path ? `${entry.path}.${arrayKey}` : arrayKey;
            next.push({
              value: arrayValue[index],
              path: `${pathPrefix}[${index}]`,
            });
          }
        }

        cursor = next;
        continue;
      }

      cursor = cursor.map((entry) => ({
        value: entry.value?.[segment],
        path: entry.path ? `${entry.path}.${segment}` : segment,
      }));
    }

    return cursor;
  }

  private dedupeInvalid(invalid: ToolValidationInvalidParam[]): ToolValidationInvalidParam[] {
    const deduped: ToolValidationInvalidParam[] = [];
    const seen = new Set<string>();
    for (const item of invalid) {
      const key = `${item.name}:${item.reason}:${item.mapPath || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    return deduped;
  }

  private buildActionableMessage(details: ToolValidationErrorDetail): string {
    const missingText = details.missing.join(', ');
    const invalidText = details.invalid
      .map((item) => (item.mapPath ? `${item.name} (${item.mapPath})` : item.name))
      .join(', ');

    if (details.missing.length > 0 && details.invalid.length === 0) {
      return `Validation Error: ${details.tool} is missing required parameter(s): ${missingText}. Please ${details.repairHint}.`;
    }

    if (details.missing.length === 0 && details.invalid.length > 0) {
      return `Validation Error: ${details.tool} has invalid parameter(s): ${invalidText}. Please ${details.repairHint}.`;
    }

    return `Validation Error: ${details.tool} is missing required parameter(s): ${missingText} and has invalid parameter(s): ${invalidText}. Please ${details.repairHint}.`;
  }

  private normalizeAllowedToolNames(allowedToolNames?: Iterable<string>): Set<string> | null {
    if (!allowedToolNames) return null;
    const normalized = new Set<string>();
    for (const name of allowedToolNames) {
      if (typeof name !== 'string') continue;
      const trimmed = name.trim();
      if (!trimmed) continue;
      normalized.add(trimmed);
    }
    return normalized.size > 0 ? normalized : null;
  }

  private buildUnknownToolError(
    toolName: string,
    mode: RuntimeValidationMode,
    args: Record<string, any>,
    allowedTools: Set<string>
  ): RuntimeToolValidationResult {
    const repairHint = this.resolveUnknownToolRepairHint(toolName, allowedTools);
    const details: ToolValidationErrorDetail = {
      tool: toolName,
      mode,
      missing: [],
      invalid: [{ name: 'toolName', reason: `unknown tool '${toolName}'` }],
      receivedKeys: Object.keys(args),
      repairHint,
    };

    return {
      ok: false,
      error: {
        code: 'TOOL_VALIDATION_ERROR',
        message: `Validation Error: ${toolName} is not an available tool in ${mode} mode. Please ${repairHint}.`,
        details,
      },
    };
  }

  private resolveUnknownToolRepairHint(toolName: string, allowedTools: Set<string>): string {
    const mappedHint = ToolExecutionCoordinator.LEGACY_TOOL_REPAIR_HINTS[toolName];
    if (mappedHint) return mappedHint;

    const available = Array.from(allowedTools).slice(0, 7);
    if (available.length === 0) return 'use a valid tool name';
    return `use one of the available tools: ${available.join(', ')}`;
  }
}
