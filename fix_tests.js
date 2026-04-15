const fs = require('fs');
const files = [
  'src/engine/agent/tools/__tests__/recoveryModeTools.test.ts',
  'src/engine/agent/__tests__/agentRuntime_refactor.test.ts',
  'src/engine/agent/__tests__/gemini_signature_pos_repro.test.ts',
  'src/engine/agent/__tests__/gemini_signature_repro.test.ts',
  'src/engine/agent/__tests__/rambling_mitigation.test.ts',
  'src/engine/agent/__tests__/repro_parent_id.test.ts'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (file.includes('recoveryModeTools')) {
    content = content.replace("expect(names).not.toContain('createNode');", "expect(names).toContain('createNode');");
  } else {
    // Replace empty toolCalls or missing toolCalls in the last mockResolvedValueOnce
    content = content.replace(/toolCalls:\s*\[\]/g, "toolCalls: [{ name: 'complete_task', args: { summary: 'Done' } }]");
    // Some tests omit toolCalls entirely, meaning it returns text-only
    content = content.replace(/mockResolvedValueOnce\(\{\s*text:\s*'([^']+)'\s*\}\)/g, "mockResolvedValueOnce({ text: '$1', toolCalls: [{ name: 'complete_task', args: { summary: 'Done' } }] })");
    // Also change expected lengths since tool calls add one response 
    if (file.includes('gemini_signature_pos_repro')) {
        content = content.replace('expect(messages).toHaveLength(4);', 'expect(messages).toHaveLength(5);');
    }
    if (file.includes('gemini_signature_repro')) {
        content = content.replace('expect(messages).toHaveLength(4);', 'expect(messages).toHaveLength(5);');
    }
    if (file.includes('rambling_mitigation')) {
        // rambling test expects 6 but might be 7? Let's check when running.
    }
  }
  fs.writeFileSync(file, content, 'utf8');
});
console.log('Done');
