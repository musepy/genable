
import { GoogleGenAI } from '@google/genai';
import { agentTools, getToolsForMode } from '../src/engine/agent/tools/index';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const client = new GoogleGenAI({ apiKey: API_KEY });
const modelName = 'gemini-3-flash-preview'; // Exact model from user logs

async function testPayload(description: string, configOverrides: any = {}, toolsOverride?: any) {
  console.log(`\n>>> Testing: ${description}`);
  
  const PLANNING_TOOLS = getToolsForMode('PLANNING', agentTools);
  
  const functionDeclarations = (toolsOverride || PLANNING_TOOLS).map((t: any) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));

  const systemInstruction = `You are a Figma design agent. You accomplish tasks by calling tools.
You don't just "arrange nodes"; you create experiences with intent.

## CORE POLICIES
- Reliability First: Strictly follow Figma API constraints.
- Precision: Use exact nodeIds from responses, never guess.
- Visual Integrity: Ensure designs are aesthetically pleasing and follow modern UI standards.

### OUTPUT FORMAT: JSON FlatNode Array
You MUST output a valid JSON array of FlatNode objects. 

#### SCHEMA
Each node object MUST follow this structure:
{
  "id": "unique-id",       // Semantic ID
  "parent": "parent-id",   // ID of parent node or null
  "type": "FRAME|TEXT|RECTANGLE|ICON",
  "props": {
    "name": "Layer Name",
    "layoutMode": "HORIZONTAL|VERTICAL|NONE",
    "primaryAxisAlignItems": "MIN|CENTER|MAX|SPACE_BETWEEN",
    "counterAxisAlignItems": "MIN|CENTER|MAX",
    "padding": 16,         // Or { "top": 8, "right": 16, ... }
    "gap": 12,
    "fills": ["#FFFFFF"],
    "cornerRadius": 8,
    "layoutSizingHorizontal": "FIXED|HUG|FILL",
    "layoutSizingVertical": "FIXED|HUG|FILL",
    "layoutPositioning": "AUTO|ABSOLUTE", // Child in auto-layout: ABSOLUTE ignores flow
    "constraints": { "horizontal": "MIN|CENTER|MAX|STRETCH|SCALE", "vertical": "MIN|CENTER|MAX|STRETCH|SCALE" },
    "x": 40,              // Explicit x (non-auto-layout parent or ABSOLUTE child)
    "y": 24,              // Explicit y (non-auto-layout parent or ABSOLUTE child)
    "width": 320,          // Only used/required for FIXED sizing
    "height": 240,         // Only used/required for FIXED sizing
    "characters": "Text content" 
  }
}

#### CANONICAL PROPERTY NAMES
Always use canonical Figma property names directly:
- fills (not "backgroundColor" or "background")
- cornerRadius (not "borderRadius")
- characters (not "content")
- gap (not "spacing" or "itemSpacing")
- layoutMode (not "layout")
- layoutPositioning (AUTO/ABSOLUTE)
- constraints.horizontal / constraints.vertical for parent pin behavior

#### CRITICAL RULES:
1. NO NESTING: Do not use "children" property. Use "parent" references.
2. VALID JSON: Ensure every property and string is double-quoted.
3. NO PROSE: Output ONLY the JSON array.

## PARENT-CHILD CREATION (Optimized)
- Hierarchical Batching (Preferred): Use batchOperations to create multiple nested levels in a single call. Use opId for the parent and parentRef for the children within the SAME batch.
- Sequential Creation: Only required when a child node depends on a parent that was created in a PREVIOUS iteration/tool call. In this case, use the real parentId from the response idMap or inspection.
- Precision (Virtual vs Real IDs): 
  - Virtual (opId): Use nodeRef/parentRef ONLY within the same batchOperations call.
  - Real (nodeId): Use nodeId/parentId for ANY node already existing in Figma (returned in idMap or inspectDesign).
- Query-First: If you are adding children to an existing node, you MUST inspectDesign first to get its real nodeId.

## DESIGN FREEDOM PRINCIPLE

You are a design reasoning agent, NOT a pattern-matching engine.

### When to query knowledge tools:
- ✅ User says: "按照项目规范" → Call getProjectUIContext
- ✅ User says: "参考项目 Button" → Call getComponentAnatomy

### When to reason freely (DO NOT call knowledge tools):
- ✅ "这个太窄了" → Read current width, increase 20-30%
- ✅ "改成 tag 形式" → Semantic transform: TEXT → FRAME+TEXT with badge styling
- ✅ "用 iOS 风格" → Apply iOS HIG from your training knowledge
- ✅ Any relative/vague adjustment → Contextual reasoning

### Naming:
- Default: Semantic English (e.g., "hero-title", "action-button")
- If user specifies Chinese: Use Chinese (e.g., "主标题")
- Single components: Descriptive names, not pattern codes

### Value reasoning for vague requests:
| User says | Your action |
| :--- | :--- |
| "太窄了" | Width += 20-30% or next ratio step |
| "太挤了" | Gap/padding += proportionally |
| "更明显" | Increase contrast, weight, or size |

## THINKING PROTOCOL
- Observe: Read previous tool results and inspect the current stage of the plan.
- Action First: Call tools immediately.
- Step Tracking: When executing a step from the plan, ALWAYS include the stepId in your tool Call (e.g., generateDesign({..., stepId: "..."})). This allows the system to automatically mark the step as`;

  const requestPayload: any = {
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: 'A clean login form with email and password fields, "Sign In" button, and social login options for Google and Apple.' }] }],
    config: {
      temperature: 0.4,
      maxOutputTokens: 65536,
      systemInstruction: systemInstruction,
      ...configOverrides
    }
  };

  if (functionDeclarations.length > 0) {
    requestPayload.config.tools = [{ functionDeclarations }];
    requestPayload.config.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }

  try {
    const response = await (client as any).models.generateContent(requestPayload);
    console.log(`✅ Success!`);
    return { success: true };
  } catch (error: any) {
    console.error(`❌ Failure: ${error.message}`);
    // If it's a 400, try to log the body if possible
    return { success: false, error: error.message };
  }
}

async function run() {
  const PLANNING_TOOLS = getToolsForMode('PLANNING', agentTools);
  const EXECUTION_TOOLS = getToolsForMode('EXECUTION', agentTools);
  
  // Test Case: toolConfig specifies a tool NOT in the tools array
  console.log("\n>>> Testing: Scenario 2 - Tool Name Mismatch (Forced tool not in tools list)");
  
  const payloadMismatch = {
    model: 'gemini-3-flash-preview',
    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    config: {
      tools: [{ functionDeclarations: EXECUTION_TOOLS.slice(0, 5).map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['new_task'] // new_task is NOT in EXECUTION_TOOLS
        }
      }
    }
  };

  try {
     await (client as any).models.generateContent(payloadMismatch);
     console.log("✅ Success? (Surprisingly, it allowed a forced tool not in the list?)");
  } catch (e: any) {
     console.error("❌ Failed as expected:", e.message);
     if (e.message.includes("is not found in any of the Tool provided")) {
        console.log("🎯 BINGO: This causes exactly the 400 error if they mismatch!");
     }
  }
}

run().catch(console.error);
