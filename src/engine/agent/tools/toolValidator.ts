import { LLMToolCall } from '../../llm-client/providers/types';

export class ToolValidator {
  /**
   * Validates tool call arguments before execution.
   * Throws an error with a clear message if validation fails, 
   * which is fed back to the LLM to trigger self-correction.
   */
  static validate(tc: LLMToolCall): void {
    if (!tc || !tc.args || typeof tc.args !== 'object') {
      throw new Error('Validation Error: Tool call arguments are undefined or null.');
    }

    switch (tc.name) {
      case 'generateDesign': {
        if (!tc.args.prompt || typeof tc.args.prompt !== 'string') {
          throw new Error('Validation Error: generateDesign requires a descriptive "prompt" string.');
        }
        break;
      }
    }
  }
}
