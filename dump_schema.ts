import { agentTools } from './src/engine/agent/tools';
import fs from 'fs';

const trueAgentTools = agentTools.filter(t => 
  ['generateDesign', 'patchNode', 'inspectDesign', 'complete_task', 'batchOperations'].includes(t.name)
);

const clientTools = [
  {
    functionDeclarations: trueAgentTools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }))
  }
];

fs.writeFileSync('schema_dump.json', JSON.stringify(clientTools, null, 2));
console.log('Schema dumped to schema_dump.json');
