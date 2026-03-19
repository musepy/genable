/**
 * @file tokenHandler.ts
 * @description Handler for the `token` command — runtime style token management.
 *
 * Subcommands: ls, set, rm, reset.
 * Operates on the mutable token store in styleTokens.ts.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import {
  dumpTokens, setToken, removeToken, resetTokens, listTokens,
} from '../../engine/styleTokens';

export async function handleToken(parameters: any): Promise<ToolResponse> {
  const { subcommand } = parameters;

  switch (subcommand) {
    case 'ls': {
      const filter = parameters.filter as 'text' | 'container' | undefined;
      const tokens = dumpTokens(filter);
      return { success: true, data: { tokens } };
    }

    case 'set': {
      const name = parameters.name as string;
      if (!name) {
        return {
          success: false,
          error: { code: 'MISSING_PARAM', message: 'token set requires a name. Usage: token set <name> prop:value ...' },
        };
      }

      const propTokens = parameters.propTokens as string[] | undefined;
      if (!propTokens || propTokens.length === 0) {
        return {
          success: false,
          error: { code: 'MISSING_PARAM', message: 'token set requires at least one prop:value. Usage: token set bubble fill:#000 corner:20' },
        };
      }

      // Parse prop tokens
      const props: Record<string, string | number> = {};
      for (const token of propTokens) {
        const colonIdx = token.indexOf(':');
        if (colonIdx <= 0) continue;
        const key = token.slice(0, colonIdx);
        const val = token.slice(colonIdx + 1);
        const num = Number(val);
        props[key] = !isNaN(num) && val !== '' ? num : val;
      }

      const explicitType = parameters.tokenType as 'text' | 'container' | undefined;
      const result = setToken(name, props, explicitType);

      return {
        success: true,
        data: {
          name,
          type: result.type,
          action: result.created ? 'created' : 'updated',
          props,
        },
      };
    }

    case 'rm': {
      const name = parameters.name as string;
      if (!name) {
        return {
          success: false,
          error: { code: 'MISSING_PARAM', message: 'token rm requires a name.' },
        };
      }

      const removed = removeToken(name);
      if (!removed) {
        return {
          success: false,
          error: { code: 'CANNOT_REMOVE', message: `Cannot remove "${name}" — either it's a default token or doesn't exist.` },
        };
      }

      return { success: true, data: { name, action: 'removed' } };
    }

    case 'reset': {
      resetTokens();
      const { text, container } = listTokens();
      return {
        success: true,
        data: { action: 'reset', textCount: text.length, containerCount: container.length },
      };
    }

    default:
      return {
        success: false,
        error: { code: 'UNKNOWN_SUBCOMMAND', message: `Unknown subcommand "${subcommand}". Available: ls, set, rm, reset` },
      };
  }
}
