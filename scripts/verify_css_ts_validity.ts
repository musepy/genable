
/**
 * @file verify_css_ts_validity.ts
 * @description Verifies that src/ui/design-system/tokens/css.ts is valid and parsable.
 */

// We need to import the css string. 
// Since it's a TS file exporting a string, we can try to import it using ts-node/tsx.

import { cssTokens } from '../src/ui/design-system/tokens/css';
import { TokenParser } from '../src/engine/sync/tokenParser';

console.log("Validating css.ts content...");

try {
    let modes = TokenParser.parse(cssTokens);
    modes = TokenParser.resolveLinks(modes);
    console.log(`Successfully parsed and resolved ${modes.length} modes.`);
    const lightMode = modes.find(m => m.name === ':root' || m.name === 'Light'); // TokenParser usually names default as ':root' or 'Mode 1'? 
    // Actually TokenParser.parse returns an array of TokenMode.
    // Let's inspect the first mode.
    
    if (modes.length > 0) {
        const tokens = modes[0].tokens;
        console.log(`Found ${tokens.length} tokens in first mode.`);
        console.log("Token Names Sample:", tokens.map(t => t.name).slice(0, 20));
        
        // Check for key tokens we added
        const accent1 = tokens.find(t => t.name === 'accent/1');
        const gray1 = tokens.find(t => t.name === 'gray/1');
        const radius2 = tokens.find(t => t.name === 'radius/2');
        
        if (accent1) console.log(`✅ accent/1 found: ${accent1.value}`);
        else console.error("❌ accent/1 MISSING");

        if (gray1) console.log(`✅ gray/1 found: ${gray1.value}`);
        else console.error("❌ gray/1 MISSING");
        
        if (radius2) console.log(`✅ radius/2 found: ${radius2.value}`);
        else console.error("❌ radius/2 MISSING");

    } else {
        console.error("❌ No modes parsed!");
        process.exit(1);
    }
    
} catch (e: any) {
    console.error("❌ Parsing FAILED:", e);
    process.exit(1);
}
