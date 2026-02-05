const { findBestComponentMatch } = require('./src/knowledge/semanticMap');

const mockComponents = [
  { name: 'Button', type: 'COMPONENT' },
  { name: 'Primary Button', type: 'COMPONENT' },
  { name: 'UserAvatar', type: 'COMPONENT' },
  { name: 'BaseCard', type: 'COMPONENT' },
  { name: 'InfoBadge', type: 'COMPONENT' }
];

function testMatch(token) {
  const match = findBestComponentMatch(token, mockComponents);
  console.log(`Token: [${token}] -> Match: ${match ? match.name : 'NONE'}`);
}

console.log('🧪 Testing Semantic Matching Logic...\n');
testMatch('BUTTON');
testMatch('AVATAR');
testMatch('CARD');
testMatch('BADGE');
testMatch('UNKNOWN');
