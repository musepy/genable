// @ts-nocheck

/**
 * @file test_token_roundtrip.ts
 * @description Mocked Environment Test for Token Logic (Parse -> Sync -> Export)
 */

// --- Mocks ---
const mockVariables: any[] = [];
const mockCollections: any[] = [];

// Minimal Figma Variable implementation for testing
class MockVariable {
    id: string;
    name: string;
    variableCollectionId: string;
    resolvedType: string;
    valuesByMode: { [modeId: string]: any } = {};

    constructor(name: string, collectionId: string, type: string) {
        this.id = `var-${Math.random().toString(36).substr(2, 9)}`;
        this.name = name;
        this.variableCollectionId = collectionId;
        this.resolvedType = type;
        mockVariables.push(this);
    }

    setValueForMode(modeId: string, value: any) {
        this.valuesByMode[modeId] = value;
    }
}

class MockCollection {
    id: string;
    name: string;
    modes: { modeId: string, name: string }[] = [];
    pluginData: { [key: string]: string } = {};

    constructor(name: string) {
        this.id = `col-${Math.random().toString(36).substr(2, 9)}`;
        this.name = name;
        this.addMode('Mode 1'); // Default mode
        mockCollections.push(this);
    }

    addMode(name: string) {
        const modeId = `mode-${Math.random().toString(36).substr(2, 9)}`;
        this.modes.push({ modeId, name });
        return modeId;
    }

    renameMode(modeId: string, name: string) {
        const mode = this.modes.find(m => m.modeId === modeId);
        if (mode) mode.name = name;
    }

    setPluginData(key: string, value: string) {
        this.pluginData[key] = value;
    }

    getPluginData(key: string) {
        return this.pluginData[key];
    }
}

// Global Figma Object Mock
(global as any).figma = {
    variables: {
        getLocalVariableCollectionsAsync: async () => mockCollections,
        createVariableCollection: (name: string) => new MockCollection(name),
        getLocalVariablesAsync: async () => mockVariables,
        createVariable: (name: string, collection: any, type: string) => new MockVariable(name, collection.id, type),
        createVariableAlias: (variable: any) => ({ type: 'VARIABLE_ALIAS', id: variable.id })
    },
    util: {
        rgba: (color: string) => {
            // Very basic mock for parseColor
            if (color.startsWith('#')) return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
            if (color.startsWith('rgba')) return { r: 0.5, g: 0.5, b: 0.5, a: 0.5 };
            return { r: 0, g: 0, b: 0, a: 1 };
        }
    }
};

// --- Logic Imports (We need to use ts-node to run this effectively, identifying imports might be tricky if not compiled)
// For simplicity in this script, we will copy the RELEVANT logic methods here to test them in isolation 
// OR assume we can import them if running via ts-node in the project context.
// Let's try importing first.
import { DesignSystemManager } from '../src/engine/sync/DesignSystemManager';
import { FigmaSync } from '../src/engine/sync/figmaSync';
import { TokenParser, TokenMode, TokenData } from '../src/engine/sync/tokenParser';

// --- Test Data ---
const CSS_INPUT = `
:root {
    --gray-1: #ffffff; 
    --blue-9: #0091ff;
    
    /* Semantic Colors - Should be preserved */
    --accent-1: var(--blue-9);
    --accent-surface: rgba(0, 145, 255, 0.15);

    /* Spacing - Should be preserved */
    --space-4: 16px;

    /* Radius - Should be FLOAT, not COLOR */
    --radius-sm: 4px;
    --radius-md: var(--space-4); 
}
`;

// --- Test Runner ---
async function runTest() {
    console.log("--------------- STARTING ROUNDTRIP TEST ---------------");
    let errors: string[] = [];

    // 1. Parse
    console.log("[1] Parsing CSS...");
    const parsedModes = TokenParser.parse(CSS_INPUT);
    const resolvedModes = TokenParser.resolveLinks(parsedModes, true);
    
    console.log("Parsed Tokens:", resolvedModes[0].tokens.map(t => `${t.name} (${t.value})`));

    // 2. Import (Sync to Mock Figma)
    console.log("\n[2] Syncing to Mock Figma...");
    await DesignSystemManager.sync(resolvedModes);

    // 3. Inspect "Figma" State (Check for Data Loss)
    console.log("\n[3] Inspecting Figma State (Variables)...");


    const themeCollection = mockCollections.find(c => c.name === 'Theme ✦');
    const primitivesCollection = mockCollections.find(c => c.name === 'Color scheme');
    const radiusCollection = mockCollections.find(c => c.name === 'Radius');
    const scalingCollection = mockCollections.find(c => c.name === 'Scaling');

    if (!themeCollection) errors.push("FAIL: Theme ✦ Collection not created!");
    if (!primitivesCollection) errors.push("FAIL: Color scheme Collection not created!");
    if (!radiusCollection) errors.push("FAIL: Radius Collection not created!");
    if (!scalingCollection) errors.push("FAIL: Scaling Collection not created!");

    const themeVars = mockVariables.filter(v => v.variableCollectionId === themeCollection?.id);
    const radiusVars = mockVariables.filter(v => v.variableCollectionId === radiusCollection?.id);
    const scalingVars = mockVariables.filter(v => v.variableCollectionId === scalingCollection?.id);
    
    // Helper to print vars
    const printVars = (name: string, vars: any[]) => {
        console.log(`${name} (${vars.length}):`, vars.map(v => v.name));
    };

    printVars('Theme', themeVars);
    printVars('Radius', radiusVars);
    printVars('Scaling', scalingVars);

    // ASSERTIONS
    // ASSERTIONS
    // let errors: string[] = []; // Removed from here


    // Update semanticVars reference for assertions below
    // In our new test logic, 'semanticVars' loosely refers to the non-primitive vars we're checking
    // We will check specific vars in specific buckets now.
    
    // Check Loss: accent-1 (should be in Theme ✦)
    const accentVar = themeVars.find(v => v.name === 'accent/1');
    if (!accentVar) {
        errors.push("FAIL: 'accent/1' is MISSING in Theme ✦ Collection.");
    } else {
        // Check if it is an alias
        // We need to access valuesByMode. Since we don't know the exact modeId, we take the first one.
        const modeId = Object.keys(accentVar.valuesByMode)[0];
        const value = accentVar.valuesByMode[modeId];
        
        if (!value || value.type !== 'VARIABLE_ALIAS') {
             errors.push(`FAIL: 'accent/1' is NOT an alias. Value: ${JSON.stringify(value)}`);
        } else {
            // Check if it points to blue/9
            // We need to find the variable it points to.
            // In our mock, createVariableAlias returns { type: 'VARIABLE_ALIAS', id: variable.id }
            // So we find the variable with that ID.
            const targetVar = mockVariables.find(v => v.id === value.id);
            if (!targetVar || targetVar.name !== 'blue/9') {
                errors.push(`FAIL: 'accent/1' alias target is WRONG. Points to: ${targetVar ? targetVar.name : 'Unknown'}`);
            } else {
                 console.log("PASS: 'accent/1' is correctly aliased to 'blue/9'");
            }
        }
    }

    // Check Loss: space-4 (should be in Scaling)
    if (!scalingVars.find(v => v.name === 'space/4')) {
        errors.push("FAIL: 'space/4' is MISSING in Scaling Collection.");
    }

    // Check Type: radius-sm (should be in Radius)
    const radiusVar = radiusVars.find(v => v.name === 'radius/sm');
    if (!radiusVar) {
         errors.push("FAIL: 'radius/sm' is MISSING in Radius Collection.");
    } else if (radiusVar.resolvedType === 'COLOR') {
        errors.push(`FAIL: 'radius/sm' determined as COLOR. Expected FLOAT.`);
    }

    // Check Type: radius-md (radius/md) - aliased to space-4
    // Should be in Radius
    const radiusMd = radiusVars.find(v => v.name === 'radius/md');
    if (!radiusMd) {
        errors.push("FAIL: 'radius/md' is MISSING in Radius Collection.");
    } else if (radiusMd.resolvedType === 'COLOR') {
        errors.push(`FAIL: 'radius/md' (alias) determined as COLOR. Expected FLOAT.`);
    }

    // 4. Export (Roundtrip)
    console.log("\n[4] Exporting back to Tokens...");
    // Update export call to expect ability to pass collection name, or default behavior
    // For now, let's just see if it works with default or improved logic
    // We will assume that FigmaSync.exportTokens will be updated to take an optional collectionName
    // or we're testing the failure of the default behavior.
    
    // We expect export from 'Theme ✦' to work.
    const exportedTokens = await FigmaSync.exportTokens('Theme ✦'); 
    
    console.log("Exported Tokens Count:", exportedTokens.length);
    if (exportedTokens.length === 0) {
        errors.push("FAIL: ZERO tokens exported. Roundtrip failed.");
    } else {
        const tokenNames = exportedTokens[0].tokens.map(t => t.name);
        console.log("Exported Token Names:", tokenNames);
    }

    // 5. Final Report
    if (exportedTokens.length > 0) {
         const tokenNames = exportedTokens[0].tokens.map(t => t.name);
         if (!tokenNames.includes('accent/1')) errors.push("FAIL: Exported tokens missing 'accent/1'");
    }

    if (errors.length > 0) {
        console.error("\n❌ TEST FAILED WITH ERRORS:");
        errors.forEach(e => console.error(` - ${e}`));
        process.exit(1);
    } else {
        console.log("\n✅ TEST PASSED! All semantic tokens preserved and typed correctly.");
        process.exit(0);
    }
}

runTest().catch(e => console.error(e));
