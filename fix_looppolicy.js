const fs = require('fs');
const files = [
  'src/engine/agent/__tests__/agentRuntime_refactor.test.ts',
  'src/engine/agent/__tests__/gemini_signature_pos_repro.test.ts',
  'src/engine/agent/__tests__/gemini_signature_repro.test.ts',
  'src/engine/agent/__tests__/rambling_mitigation.test.ts',
  'src/engine/agent/__tests__/repro_parent_id.test.ts'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace new AgentRuntime({ ... }) to include loopPolicy if not present
  content = content.replace(/new AgentRuntime\(\s*\{/g, "new AgentRuntime({\n      loopPolicy: { useSkillSystem: false } as any,");
  
  // For the retry test, change the assertion from 2 to 3 if we nudged?
  // Actually, wait, the retry test uses `expect(callCount).toBe(2)`. 
  // Wait, my previous script injected toolCalls: [{name: 'complete_task'...}] into the retry success.
  // Let's ensure it does.

  fs.writeFileSync(file, content, 'utf8');
});
console.log('Done');
