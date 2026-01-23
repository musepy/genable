const fs = require('fs');
const path = require('path');

// Configuration
const TOKENS_PATH = path.join(__dirname, '../src/config/systems/shadcn/tokens.json');
const CSS_PATH = process.argv[2]; // Pass CSS file path as argument

if (!CSS_PATH) {
  console.log('Usage: node sync-shadcn-tokens.js <path-to-globals.css>');
  process.exit(1);
}

// Helper: HSL to Hex
function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Helper: Parse HSL string "222.2 47.4% 11.2%" or "0 0% 100%"
function parseHsl(value) {
  const parts = value.split(' ').map(v => parseFloat(v));
  if (parts.length < 3) return null;
  return hslToHex(parts[0], parts[1], parts[2]);
}

try {
  // 1. Read CSS
  const cssContent = fs.readFileSync(CSS_PATH, 'utf8');
  
  // 2. Extract Variables
  const variableRegex = /--([a-z0-9-]+):\s*([0-9.]+\s+[0-9.]+%?\s+[0-9.]+%?);/g;
  const extracted = {};
  let match;
  
  console.log('🔍 Scanning CSS for variables...');
  while ((match = variableRegex.exec(cssContent)) !== null) {
    const name = match[1]; // e.g. "primary"
    const value = match[2]; // e.g. "222.2 47.4% 11.2%"
    
    const hex = parseHsl(value);
    if (hex) {
      extracted[name] = hex;
      console.log(`   Found: --${name} -> ${hex}`);
    }
  }

  if (Object.keys(extracted).length === 0) {
    console.log('⚠️ No variables found. Check CSS format (expected: --name: h s l;).');
    process.exit(0);
  }

  // 3. Update tokens.json
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  
  // Ensure section exists
  if (!tokens.semanticFallbacks) tokens.semanticFallbacks = {};

  // Merge
  let updatedCount = 0;
  Object.entries(extracted).forEach(([key, hex]) => {
    if (tokens.semanticFallbacks[key] !== hex) {
      tokens.semanticFallbacks[key] = hex;
      updatedCount++;
    }
  });

  // 4. Write back
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\n✅ Updated ${updatedCount} tokens in ${path.basename(TOKENS_PATH)}`);

} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
