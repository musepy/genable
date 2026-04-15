
import { KnowledgeManager } from './src/engine/agent/context/knowledgeManager';
import { composeAgentSystemPrompt } from './src/engine/llm-client/context/promptComposer';


async function test() {
    console.log('--- Testing Lean Context ---');
    const km = KnowledgeManager.getInstance();
    const assets = km.listAllKnowledge();
    console.log('Available Knowledge:', assets);

    const promptDeps = {
        mode: 'PLANNING' as const,
        iteration: 0,
        selectionContext: { selectedNodes: [], pageNodes: [] },
        provider: {
            getToolSystemInstruction: () => 'Tool Calling Rules:\n- Always provide all required parameters.\n- Call complete_task when done.'
        },
        tools: [],
        behaviorConfig: {
            designStrategy: 'create',
            thinkingLevel: 'minimal'
        }
    };

    const prompt = await composeAgentSystemPrompt(
        promptDeps as any,
        promptDeps.tools as any,
        promptDeps.provider as any,
        { mode: promptDeps.mode as any }
    );

    console.log('\n--- Prompt Preview (first 500 chars) ---');
    console.log(prompt.substring(0, 500) + '...');
    
    // Estimate tokens roughly
    const words = prompt.split(/\s+/).length;
    const estimatedTokens = Math.ceil(words * 1.3);
    console.log('\nEstimated static tokens:', estimatedTokens);

    console.log('\n--- Real API Verification ---');
    const { GoogleGenAI } = require('@google/genai');
    const fs = require('fs');
    const path = require('path');
    
    // Load OAuth token
    const oauthPath = path.join(process.env.HOME || '~', '.gemini', 'oauth_creds.json');
    const oauthData = JSON.parse(fs.readFileSync(oauthPath, 'utf-8'));
    const accessToken = oauthData.access_token;
    
    if (!accessToken) {
        console.error('❌ No OAuth token found.');
        return;
    }

    // Try a simple message with the system instruction
    const client = new GoogleGenAI({ apiKey: 'oauth-mode' });
    const model = (client as any).getGenerativeModel({ 
        model: 'gemini-2.0-pro-exp-02-05',
    }, {
        baseUrl: 'https://generativelanguage.googleapis.com',
        customHeaders: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    console.log('Model: gemini-2.0-pro-exp-02-05');
    console.log('Sending prompt...');

    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: 'Respond with "System Instruction Received" and tell me the character count of your instructions.' }] }],
            systemInstruction: prompt
        });
        console.log('Total Response Tokens:', result.response.usageMetadata?.totalTokenCount);
        console.log('Prompt Tokens (Real):', result.response.usageMetadata?.promptTokenCount);
        console.log('Response:', result.response.text());
        console.log('\n✅ Verification Successful!');
    } catch (err: any) {
        console.error('❌ API Error:', err.message);
    }
}

test().catch(console.error);
