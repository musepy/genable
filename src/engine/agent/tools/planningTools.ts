import { ToolDefinition } from './types';

// ==========================================
// 0. Planning Tool (ReAct Pattern)
// ==========================================

export const planDesignDefinition: ToolDefinition = {
  name: 'planDesign',
  category: 'plan',
  dependencies: [],
  description: `
[PLANNING] Create a CONCISE execution plan (MAX 8 steps). Each step should group related operations.
Do NOT create one step per node — group sibling nodes, container+children, or related style changes into single steps.

EXAMPLE: For "Create a login form with email, password, and sign-in button":
- Step 1: Create root container "Login Form" with header (title + subtitle)
- Step 2: Create form fields (email input + password input)
- Step 3: Create sign-in button and social login buttons
- Step 4: Apply final layout and styles

ANTI-PATTERN (TOO GRANULAR - DO NOT DO THIS):
- Step 1: Create container → Step 2: Create title → Step 3: Create subtitle → ... (20 steps)
`,
  parameters: {
    type: 'object',
    properties: {
      analysis: {
        type: 'string',
        description: 'Analysis of the user request and design requirements'
      },
      steps: {
        type: 'array',
        description: 'Ordered list of HIGH-LEVEL design milestones (NOT individual tool calls). Each step groups multiple related operations.',
        items: {
          type: 'object',
          description: 'A component-level milestone that requires MULTIPLE tool calls to complete',
          properties: {
            stepNumber: { type: 'number', description: 'Step order (1, 2, 3...)' },
            action: { type: 'string', description: 'High-level description of what to build (e.g., "Build header section with logo, title, and navigation links"). NOT a tool name.' },
            nodes: { type: 'array', items: { type: 'string', description: 'Name of a node/element to create' }, description: 'List of nodes/elements this step will create (e.g., ["Header Frame", "Logo", "Title Text", "Nav Links"])' },
            reasoning: { type: 'string', description: 'Why this step is needed' }
          }
        }
      }
    },
    required: ['analysis', 'steps']
  },
  executionStrategy: 'sequential',
  modes: ['PLANNING'],
  errors: {}
};
