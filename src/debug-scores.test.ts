
import { it } from 'vitest';
import { knowledgeHub } from './engine/llm-client/knowledge/knowledgeHub';

it('debug knowledge hub scores', () => {
    console.log('--- Reasoning (Fintech Dashboard) ---');
    console.log(JSON.stringify(knowledgeHub.searchReasoning('Fintech Dashboard', 1), null, 2));

    console.log('\n--- Typography (Fintech Dashboard) ---');
    console.log(JSON.stringify(knowledgeHub.searchTypography('Fintech Dashboard', 1), null, 2));

    console.log('\n--- Styles (modern) ---');
    console.log(JSON.stringify(knowledgeHub.searchStyles('modern', 1), null, 2));

    console.log('\n--- Landing (SaaS Mobile Landing Page) ---');
    console.log(JSON.stringify(knowledgeHub.searchLanding('SaaS Mobile Landing Page', 1), null, 2));
});
