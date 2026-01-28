/**
 * @file verify_round_trip.ts
 * @description Validates that TokenParser can convert DTCG JSON to TokenData and back without loss.
 */

import { TokenParser } from '../src/engine/sync/tokenParser';

const testData = {
  "color": {
    "brand": {
      "primary": {
        "$value": "#3e63dd",
        "$type": "color"
      }
    }
  },
  "dimension": {
    "radius": {
      "small": {
        "$value": "4px",
        "$type": "dimension"
      }
    }
  },
  "status": {
    "active": {
      "$value": true,
      "$type": "boolean"
    }
  }
};

function verify() {
  console.log('🚀 Starting Round-trip Validation...');

  // 1. JSON -> Tokens
  const modes = TokenParser.parseJSON(testData);
  const flattened = modes[0].tokens;
  
  console.log('✅ Flattened into', flattened.length, 'tokens:');
  flattened.forEach(t => console.log(`   - ${t.name}: ${JSON.stringify(t.value)} (${t.type})`));

  // 2. Tokens -> JSON
  const reconstructed = TokenParser.unflattenJSON(flattened);
  
  // 3. Compare
  const originalStr = JSON.stringify(testData, null, 2);
  const reconstructedStr = JSON.stringify(reconstructed, null, 2);

  if (originalStr === reconstructedStr) {
    console.log('\n✨ SUCCESS: Round-trip is identical!');
  } else {
    console.error('\n❌ FAILURE: Round-trip mismatch!');
    console.log('Original:\n', originalStr);
    console.log('\nReconstructed:\n', reconstructedStr);
    process.exit(1);
  }
}

// In a real project, we'd use vitest, but this is a quick verification tool
verify();
