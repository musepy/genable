/**
 * Figma Console Import Engine V5
 * ------------------------------
 * Features: 
 * 1. Metadata Sync: Scopes, Descriptions, hiddenFromPublishing.
 * 2. Robust Case-Insensitive Matching.
 */

window.FigmaImporter = {
    async run(datasets, options = {}) {
        const { dryRun = false } = options;
        console.group("🚀 Figma Importer V5 Running");
        
        const TYPE_MAP = { 'color': 'COLOR', 'dimension': 'FLOAT', 'number': 'FLOAT', 'boolean': 'BOOLEAN', 'string': 'STRING' };
        const allVars = await figma.variables.getLocalVariablesAsync();
        const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
        const collectionMap = new Map();

        function standardize(path) { 
            return path.replace(/\./g, '/'); 
        }

        async function ensureCollection(name) {
            if (collectionMap.has(name)) return collectionMap.get(name);
            let c = allCollections.find(x => x.name === name);
            if (!c && !dryRun) {
                console.log(`➕ Creating Collection: ${name}`);
                c = figma.variables.createVariableCollection(name);
                allCollections.push(c);
            }
            collectionMap.set(name, c);
            return c;
        }

        async function ensureMode(collection, modeName) {
            if (!collection || dryRun) return null;
            let mode = collection.modes.find(m => m.name === modeName);
            if (!mode) {
                try {
                    if (collection.modes.length === 1 && collection.modes[0].name === "Mode 1") collection.renameMode(collection.modes[0].modeId, modeName);
                    else collection.addMode(modeName);
                    console.log(`➕ Mode Added: ${modeName} in ${collection.name}`);
                } catch (e) { console.warn(`⚠️ Mode error: ${modeName}:`, e.message); }
            }
            return collection.modes.find(m => m.name === modeName)?.modeId;
        }

        // Pass 1: Creation
        console.log("🛠️ Pass 1: Structure...");
        for (const ds of datasets) {
            const collection = await ensureCollection(ds.config.defaultCollection);
            const modeName = ds.config.modeName || "Default";
            await ensureMode(collection, modeName);

            for (const token of ds.tokens) {
                const figmaType = TYPE_MAP[token.type] || 'STRING';
                let variable = allVars.find(v => v.name === token.name && v.variableCollectionId === collection?.id);
                if (!variable && !dryRun) {
                    try {
                        variable = figma.variables.createVariable(token.name, collection, figmaType);
                        allVars.push(variable);
                    } catch (e) { console.error(`❌ Create failed: ${token.name}`, e.message); }
                }
            }
        }

        // Pass 2: Metadata & Values
        console.log("🔄 Pass 2: Metadata, Values & Aliases...");
        for (const ds of datasets) {
            const collection = collectionMap.get(ds.config.defaultCollection);
            const modeId = collection?.modes.find(m => m.name === (ds.config.modeName || "Default"))?.modeId;
            if (!modeId && !dryRun) continue;

            for (const token of ds.tokens) {
                const variable = allVars.find(v => v.name === token.name && v.variableCollectionId === collection?.id);
                if (!variable || dryRun) continue;

                try {
                    // Apply Metadata
                    if (token.scopes) variable.scopes = token.scopes;
                    if (token.description) variable.description = token.description;
                    if (token.hidden !== undefined) variable.hiddenFromPublishing = token.hidden;

                    let val = token.value;

                    // Alias resolving
                    if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                        const originalPath = val.slice(1, -1);
                        const stdPath = standardize(originalPath);
                        let targetVar = allVars.find(v => v.name === originalPath || standardize(v.name) === stdPath);

                        if (targetVar) {
                            variable.setValueForMode(modeId, figma.variables.createVariableAlias(targetVar));
                            continue;
                        } else { console.warn(`🔗 Alias NOT found: "${originalPath}"`); }
                    }

                    // Value setting
                    if (token.type === 'color') {
                        let c = null;
                        if (typeof val === 'string' && val.startsWith('#')) {
                            const hex = val.replace('#', '');
                            c = { r: parseInt(hex.substring(0, 2), 16) / 255, g: parseInt(hex.substring(2, 4), 16) / 255, b: parseInt(hex.substring(4, 6), 16) / 255, a: 1 };
                        } else if (typeof val === 'object' && val !== null) {
                            if (val.components) c = { r: val.components[0], g: val.components[1], b: val.components[2], a: val.alpha ?? 1 };
                            else if (val.r !== undefined) c = { r: val.r, g: val.g, b: val.b, a: val.a ?? 1 };
                        }
                        if (c) variable.setValueForMode(modeId, c);
                    } else {
                        variable.setValueForMode(modeId, val);
                    }
                } catch (e) { console.error(`❌ Error on ${token.name}:`, e.message); }
            }
        }
        console.groupEnd();
        console.log("🏁 V5 Import Finished.");
    }
};
console.log("✅ FigmaImporter V5 Optimized.");
