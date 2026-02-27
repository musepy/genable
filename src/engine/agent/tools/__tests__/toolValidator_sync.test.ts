import { describe, it, expect } from 'vitest';
import { ToolValidator } from '../toolValidator';
import { generateDesignDefinition } from './generateDesignTool';

describe('ToolValidator - generateDesign sync', () => {
  it('should pass validation when prompt is provided', () => {
    const validCall = {
      name: 'generateDesign',
      args: {
        prompt: 'Create a login form',
        nodes: []
      },
      id: 'call_1'
    };
    
    expect(() => ToolValidator.validate(validCall)).not.toThrow();
  });

  it('should throw validation error when prompt is missing', () => {
    const invalidCall = {
      name: 'generateDesign',
      args: {
        nodes: []
      },
      id: 'call_2'
    };
    
    expect(() => ToolValidator.validate(invalidCall)).toThrow(/requires a descriptive "prompt" string/);
  });
});
