/**
 * @file test-gemini-empty-response.mjs
 * @description Runs the exact FULL REQUEST DUMP shape against Gemini models
 * to reproduce empty-response / malformed-response behavior under real agent payload size.
 *
 * Usage:
 *   node test-gemini-empty-response.mjs
 *   node test-gemini-empty-response.mjs --models=gemini-3.1-pro-preview,gemini-3-flash-preview
 *   node test-gemini-empty-response.mjs --attempts=2
 *   GEMINI_API_KEY=xxx node test-gemini-empty-response.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const API_KEY = process.env.GEMINI_API_KEY?.trim();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEM_INSTRUCTION_PATH = path.join(__dirname, 'test-gemini-full-system-instruction.md');
const STREAM_TIMEOUT_MS = 75_000;

const DEFAULT_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
];

function getArgValue(flagName) {
  const prefix = `${flagName}=`;
  const arg = process.argv.slice(2).find(item => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseModels() {
  const fromArg = getArgValue('--models');
  const fromEnv = process.env.GEMINI_MODELS;
  const raw = fromArg || fromEnv;
  if (!raw) return DEFAULT_MODELS;
  return [...new Set(raw.split(',').map(v => v.trim()).filter(Boolean))];
}

function parseAttempts() {
  const raw = getArgValue('--attempts') || process.env.GEMINI_ATTEMPTS || '1';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 5);
}

function loadSystemInstruction() {
  if (!fs.existsSync(SYSTEM_INSTRUCTION_PATH)) {
    throw new Error(`Missing system instruction file: ${SYSTEM_INSTRUCTION_PATH}`);
  }
  return fs.readFileSync(SYSTEM_INSTRUCTION_PATH, 'utf8');
}

const FUNCTION_DECLARATIONS = [
  {
    name: 'new_task',
    description: 'Signals the start of a clear semantic task. Triggers a new Task Card in the UI.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'A concise title for the task (e.g., "Create Login UI").'
        },
        description: {
          type: 'string',
          description: 'A brief description of what this task accomplishes.'
        },
        stepId: {
          type: 'string',
          description: 'Optional ID. Use this if you are continuing or refining a specific step from a previous plan.'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'update_todo_list',
    description: 'Dynamically manages sub-steps (todos) within the current active task.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'List of todo items.',
          items: {
            type: 'object',
            description: 'A single todo item.',
            properties: {
              id: {
                type: 'string',
                description: 'Unique ID for the todo item.'
              },
              label: {
                type: 'string',
                description: 'Human-readable description of the todo.'
              },
              status: {
                type: 'string',
                enum: ['pending', 'completed', 'failed'],
                description: 'Current status of this specific sub-item.'
              }
            },
            required: ['id', 'label', 'status']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'getProjectUIContext',
    description: 'Retrieve a REFERENCE technical specification for project UI components. Use ONLY when user explicitly requests project-specific implementations. For free design or generic systems (iOS, shadcn), rely on your own knowledge.',
    parameters: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description: 'Specific component name to get details for (e.g., "Button", "Card", "Header"). Case-insensitive.'
        },
        category: {
          type: 'string',
          description: 'Filter components by category.',
          enum: ['layout', 'input', 'display', 'feedback', 'navigation']
        },
        query: {
          type: 'string',
          description: 'Search query to find relevant components by name or description.'
        },
        includeTokens: {
          type: 'boolean',
          description: 'Include design tokens (colors, spacing, typography) in the response. Useful for understanding the design system.'
        }
      }
    }
  },
  {
    name: 'getDesignSystemTokens',
    description: "Retrieve the project's design tokens (colors, spacing, typography, radius). Use these values to ensure generated designs match the project's visual language.",
    parameters: {
      type: 'object',
      properties: {
        tokenType: {
          type: 'string',
          description: 'Specific token category to retrieve.',
          enum: ['colors', 'spacing', 'typography', 'radius', 'all']
        }
      }
    }
  },
  {
    name: 'listProjectComponents',
    description: 'List all available UI components in the project with brief descriptions. Use this to discover what components exist before creating designs.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by component category.',
          enum: ['layout', 'input', 'display', 'feedback', 'navigation']
        }
      }
    }
  },
  {
    name: 'inspectDesign',
    description: '\n[SUPER TOOL] Unified read tool for Figma state.\n\nMODE OPTIONS:\n- "selection": Get currently selected nodes (names, types, IDs)\n- "hierarchy": Get full DSL tree of a node and children (requires nodeId)\n- "node": Get DSL of a single node (requires nodeId)\n\nREPLACES: getSelection, getDeepHierarchy, getNodeDSL\nUse this instead of those tools.\n',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['selection', 'hierarchy', 'node'],
          description: 'What to inspect'
        },
        nodeId: {
          type: 'string',
          description: 'Required for hierarchy/node modes. ID of node to inspect.'
        },
        depth: {
          type: 'number',
          description: 'For hierarchy mode: max depth (default 5, max 10)'
        }
      },
      required: ['mode']
    }
  },
  {
    name: 'planDesign',
    description: '\n[PLANNING] Create a CONCISE execution plan (MAX 8 steps). Each step should group related operations.\nDo NOT create one step per node — group sibling nodes, container+children, or related style changes into single steps.\n\nEXAMPLE: For "Create a login form with email, password, and sign-in button":\n- Step 1: Create root container "Login Form" with header (title + subtitle)\n- Step 2: Create form fields (email input + password input)\n- Step 3: Create sign-in button and social login buttons\n- Step 4: Apply final layout and styles\n\nANTI-PATTERN (TOO GRANULAR - DO NOT DO THIS):\n- Step 1: Create container → Step 2: Create title → Step 3: Create subtitle → ... (20 steps)\n',
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
              stepNumber: {
                type: 'number',
                description: 'Step order (1, 2, 3...)'
              },
              action: {
                type: 'string',
                description: 'High-level description of what to build (e.g., "Build header section with logo, title, and navigation links"). NOT a tool name.'
              },
              nodes: {
                type: 'array',
                items: {
                  type: 'string',
                  description: 'Name of a node/element to create'
                },
                description: 'List of nodes/elements this step will create (e.g., ["Header Frame", "Logo", "Title Text", "Nav Links"])'
              },
              reasoning: {
                type: 'string',
                description: 'Why this step is needed'
              }
            }
          }
        }
      },
      required: ['analysis', 'steps']
    }
  },
  {
    name: 'searchDesignKnowledge',
    description: 'Search for UI/UX design knowledge, aesthetic directions, visual inspiration, style priorities, color palettes, or industry-specific patterns.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'The specific knowledge domain to search within.',
          enum: ['reasoning', 'styles', 'colors', 'typography', 'landing', 'charts', 'products', 'guidelines', 'stacks', 'figmaLayout']
        },
        query: {
          type: 'string',
          description: 'The search query or keyword.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 3).'
        }
      },
      required: ['domain', 'query']
    }
  },
  {
    name: 'getComponentAnatomy',
    description: 'Retrieve a REFERENCE structural blueprint for a specific UI component. Use ONLY when user explicitly requests project/system patterns. For custom or relative adjustments, rely on your own design reasoning.',
    parameters: {
      type: 'object',
      properties: {
        componentName: {
          type: 'string',
          description: 'The semantic name of the component (e.g., "button", "card", "badge").'
        }
      },
      required: ['componentName']
    }
  },
  {
    name: 'getFigmaLayoutRules',
    description: "Retrieve specific Figma layout constraints and rules (Do/Don't) to ensure design system compliance.",
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Specific topic to filter rules (e.g., "auto layout", "sizing").'
        },
        severityFilter: {
          type: 'string',
          description: 'Filter rules by severity level.',
          enum: ['Critical', 'High', 'Medium', 'Low']
        }
      }
    }
  }
];

function buildBaseRequest() {
  return {
    model: 'gemini-3.1-pro-preview',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'A clean login form with email and password fields, "Sign In" button, and social login options for Google and Apple.'
          }
        ]
      }
    ],
    config: {
      temperature: 0.4,
      maxOutputTokens: 65536,
      thinkingConfig: { thinkingLevel: 'HIGH' },
      systemInstruction: loadSystemInstruction(),
      tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO'
        }
      }
    }
  };
}

function cloneRequestForModel(baseRequest, model) {
  return {
    model,
    contents: baseRequest.contents,
    config: baseRequest.config
  };
}

function toErrorMessage(error) {
  if (!error) return '';
  if (error?.status && error?.message) return `${error.status}: ${error.message}`;
  return String(error?.message || error);
}

async function runStreamRequest(client, request) {
  const startMs = Date.now();
  let chunkCount = 0;
  let textLength = 0;
  let thoughtLength = 0;
  const toolCalls = [];
  const finishReasons = new Set();
  let timedOut = false;
  let usageMetadata = null;
  let error = null;

  try {
    const result = await client.models.generateContentStream(request);
    for await (const chunk of result) {
      chunkCount += 1;
      usageMetadata = chunk?.usageMetadata || usageMetadata;
      const candidate = chunk?.candidates?.[0];
      if (candidate?.finishReason) finishReasons.add(candidate.finishReason);
      const parts = candidate?.content?.parts || [];

      for (const part of parts) {
        if (part?.functionCall) {
          toolCalls.push({
            name: part.functionCall.name,
            argsSize: JSON.stringify(part.functionCall.args || {}).length
          });
        } else if (typeof part?.text === 'string') {
          if (part.thought === true) thoughtLength += part.text.length;
          else textLength += part.text.length;
        }
      }

      if (Date.now() - startMs > STREAM_TIMEOUT_MS) {
        timedOut = true;
        break;
      }
    }
  } catch (streamError) {
    error = streamError;
  }

  return {
    elapsedMs: Date.now() - startMs,
    chunkCount,
    textLength,
    thoughtLength,
    toolCalls,
    finishReasons: [...finishReasons],
    timedOut,
    usageMetadata,
    error
  };
}

async function runNonStreamControl(client, request) {
  const startMs = Date.now();
  let textLength = 0;
  const toolCalls = [];
  let finishReason = null;
  let error = null;

  try {
    const response = await client.models.generateContent(request);
    const candidate = response?.candidates?.[0];
    finishReason = candidate?.finishReason || null;
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      if (part?.functionCall) toolCalls.push(part.functionCall.name);
      else if (typeof part?.text === 'string') textLength += part.text.length;
    }
  } catch (nonStreamError) {
    error = nonStreamError;
  }

  return {
    elapsedMs: Date.now() - startMs,
    textLength,
    toolCalls,
    finishReason,
    error
  };
}

function classifyStreamResult(result) {
  if (result.error) return 'ERROR';
  if (result.timedOut) return 'TIMEOUT';
  const isEmpty = result.textLength === 0 && result.thoughtLength === 0 && result.toolCalls.length === 0;
  return isEmpty ? 'EMPTY_NO_ERROR' : 'OK';
}

function printHeader(baseRequest, models, attempts) {
  const payloadChars = JSON.stringify(baseRequest).length;
  console.log('='.repeat(90));
  console.log('Gemini FULL REQUEST DUMP Repro');
  console.log('='.repeat(90));
  console.log(`API Key: ${API_KEY ? 'loaded' : 'missing'}`);
  console.log(`System instruction file: ${SYSTEM_INSTRUCTION_PATH}`);
  console.log(`System instruction chars: ${baseRequest.config.systemInstruction.length}`);
  console.log(`Payload chars (JSON): ${payloadChars}`);
  console.log(`Function tools: ${FUNCTION_DECLARATIONS.length}`);
  console.log(`Models: ${models.join(', ')}`);
  console.log(`Attempts/model: ${attempts}`);
  console.log(`Stream timeout: ${STREAM_TIMEOUT_MS}ms`);
  console.log('='.repeat(90));
}

function printAttemptSummary(model, attempt, result) {
  const status = classifyStreamResult(result);
  console.log(`\n[${model}] Attempt ${attempt}`);
  console.log(`status=${status} elapsed=${result.elapsedMs}ms chunks=${result.chunkCount} text=${result.textLength} thoughts=${result.thoughtLength} tools=${result.toolCalls.length} finish=${result.finishReasons.join('|') || 'none'} timeout=${result.timedOut}`);
  if (result.usageMetadata) {
    const inTok = result.usageMetadata.promptTokenCount ?? 'n/a';
    const outTok = result.usageMetadata.candidatesTokenCount ?? 'n/a';
    const totalTok = result.usageMetadata.totalTokenCount ?? 'n/a';
    console.log(`usage prompt=${inTok} out=${outTok} total=${totalTok}`);
  }
  if (result.toolCalls.length > 0) {
    const names = result.toolCalls.map(tc => `${tc.name}(${tc.argsSize})`).join(', ');
    console.log(`toolCalls ${names}`);
  }
  if (result.error) {
    console.log(`error ${toErrorMessage(result.error).slice(0, 500)}`);
  }
}

async function main() {
  if (!API_KEY) {
    throw new Error('API key missing. Set GEMINI_API_KEY.');
  }

  const baseRequest = buildBaseRequest();
  const models = parseModels();
  const attempts = parseAttempts();

  printHeader(baseRequest, models, attempts);

  const client = new GoogleGenAI({ apiKey: API_KEY });
  const summary = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const request = cloneRequestForModel(baseRequest, model);
      const streamResult = await runStreamRequest(client, request);
      printAttemptSummary(model, attempt, streamResult);

      const status = classifyStreamResult(streamResult);
      let control = null;

      if (status === 'EMPTY_NO_ERROR') {
        console.log(`control running non-stream check for ${model}...`);
        control = await runNonStreamControl(client, request);
        const controlStatus = control.error ? 'ERROR' : (control.textLength === 0 && control.toolCalls.length === 0 ? 'EMPTY_NO_ERROR' : 'OK');
        console.log(`control status=${controlStatus} elapsed=${control.elapsedMs}ms text=${control.textLength} tools=${control.toolCalls.length} finish=${control.finishReason || 'none'}`);
        if (control.toolCalls.length > 0) {
          console.log(`control toolCalls ${control.toolCalls.join(', ')}`);
        }
        if (control.error) {
          console.log(`control error ${toErrorMessage(control.error).slice(0, 500)}`);
        }
      }

      summary.push({
        model,
        attempt,
        status,
        chunks: streamResult.chunkCount,
        text: streamResult.textLength,
        thoughts: streamResult.thoughtLength,
        tools: streamResult.toolCalls.length,
        error: streamResult.error ? toErrorMessage(streamResult.error).slice(0, 220) : null,
        control
      });

    }
  }

  console.log('\n' + '-'.repeat(90));
  console.log('Summary');
  console.log('-'.repeat(90));
  for (const row of summary) {
    console.log(`${row.model}#${row.attempt} => ${row.status} (chunks=${row.chunks}, text=${row.text}, thoughts=${row.thoughts}, tools=${row.tools}${row.error ? `, error=${row.error}` : ''})`);
    if (row.control) {
      const cStatus = row.control.error ? 'ERROR' : (row.control.textLength === 0 && row.control.toolCalls.length === 0 ? 'EMPTY_NO_ERROR' : 'OK');
      console.log(`  control => ${cStatus} (text=${row.control.textLength}, tools=${row.control.toolCalls.length}${row.control.error ? `, error=${toErrorMessage(row.control.error).slice(0, 180)}` : ''})`);
    }
  }
}

main().catch(error => {
  console.error('\nFatal:', toErrorMessage(error));
  process.exit(1);
});
