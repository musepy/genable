import { agentTools } from '../src/engine/agent/tools/index';
import * as fs from 'fs';

const schemas = agentTools.map(t => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
  modes: t.modes,
  executionStrategy: t.executionStrategy
}));

fs.writeFileSync('all_tool_schemas.json', JSON.stringify(schemas, null, 2));
console.log('Successfully wrote ' + schemas.length + ' schemas to all_tool_schemas.json');
