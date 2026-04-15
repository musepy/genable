
import { GoogleGenAI } from '@google/genai';
import { agentTools } from '../src/engine/agent/tools/index';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const client = new GoogleGenAI({ apiKey: API_KEY });

async function validateTool(tool: any) {
  console.log(`\n--- Validating Tool: ${tool.name} ---`);
  
  const functionDeclaration = {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };

  const modelName = 'gemini-2.0-flash'; // Standardized for validation

  try {
    const response = await (client as any).models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      config: {
        tools: [{ functionDeclarations: [functionDeclaration] }],
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] } }
      }
    });
    console.log(`✅ validation success for ${tool.name}`);
    return { success: true };
  } catch (error: any) {
    console.error(`❌ validation failure for ${tool.name}`);
    
    // Log detailed error if available
    if (error.response && error.response.promptFeedback) {
        console.error('Prompt Feedback:', JSON.stringify(error.response.promptFeedback, null, 2));
    }
    
    console.error('Error Message:', error.message);
    
    // Attempt to pinpoint by checking property by property if it's an object
    if (tool.parameters?.properties) {
        console.log(`Checking individual properties for ${tool.name}...`);
        for (const propName of Object.keys(tool.parameters.properties)) {
            const subParams = {
                type: 'object',
                properties: { [propName]: tool.parameters.properties[propName] },
                required: tool.parameters.required?.includes(propName) ? [propName] : []
            };
            
            try {
                await (client as any).models.generateContent({
                    model: modelName,
                    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
                    config: {
                      tools: [{ functionDeclarations: [{ ...functionDeclaration, parameters: subParams }] }],
                    }
                });
                // console.log(`  - Prop ${propName}: OK`);
            } catch (subError: any) {
                console.error(`  - ⚠️ Prop ${propName} seems to be the issue!`);
                console.error(`    Error: ${subError.message}`);
            }
        }
    }
    
    return { success: false, error: error.message };
  }
}

async function run() {
  const results = [];
  for (const tool of agentTools) {
    const res = await validateTool(tool);
    results.push({ name: tool.name, ...res });
  }

  const failures = results.filter(r => !r.success);
  console.log('\n=====================================');
  console.log(`Validation Complete. ${results.length} tools checked.`);
  console.log(`${results.length - failures.length} success, ${failures.length} failures.`);
  
  if (failures.length > 0) {
    console.log('\nFailed Tools:');
    failures.forEach(f => console.log(`- ${f.name}`));
  }
}

run().catch(console.error);
