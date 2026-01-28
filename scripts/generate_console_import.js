const fs = require('fs');
const path = require('path');

// Simple TokenParser logic for the generator (simplified for JS)
class TokenProcessor {
    static flattenJSON(obj, path = '') {
        let tokens = [];
        for (const [key, value] of Object.entries(obj)) {
            if (key.startsWith('$') && key !== '$value' && key !== '$type') continue;
            const currentPath = path ? `${path}/${key}` : key;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                let dv = value['$value'] ?? value['value'];
                let dt = value['$type'] ?? value['type'];

                // Support Figma native extensions
                const extensions = value['$extensions'] || {};
                const aliasData = extensions['com.figma.aliasData'];
                const scopes = extensions['com.figma.scopes'];
                const hidden = extensions['com.figma.hiddenFromPublishing'];
                const description = value['$description'] || value['description'];

                if (aliasData && aliasData.targetVariableName) {
                    dv = `{${aliasData.targetVariableName}}`;
                }

                if (dv !== undefined) {
                    // Normalize Dimensions: "32px" -> 32
                    if (typeof dv === 'string' && dv.endsWith('px')) {
                        dv = parseFloat(dv);
                        dt = 'dimension';
                    }
                    // Auto-detect color objects
                    if (typeof dv === 'object' && dv !== null && (dv.hex || dv.components)) {
                        dt = 'color';
                    }
                    const tokenEntry = { name: currentPath, value: dv, type: dt || 'string' };
                    if (scopes) tokenEntry.scopes = scopes;
                    if (hidden !== undefined) tokenEntry.hidden = hidden;
                    if (description) tokenEntry.description = description;

                    tokens.push(tokenEntry);
                } else {
                    tokens.push(...this.flattenJSON(value, currentPath));
                }
            } else {
                let dv = value;
                let dt = 'string';
                if (typeof dv === 'string' && dv.endsWith('px')) {
                    dv = parseFloat(dv);
                    dt = 'dimension';
                }
                tokens.push({ name: currentPath.replace(/-/g, '/'), value: dv, type: dt });
            }
        }
        return tokens;
    }
}

// Configuration
const FILES = [
    { name: "light.json", path: "assets/tokens/radix/light.json", defaultCollection: "Color scheme", modeName: "Light" },
    { name: "dark.json", path: "assets/tokens/radix/dark.json", defaultCollection: "Color scheme", modeName: "Dark" },
    { name: "radius.json", path: "assets/tokens/radix/radius.json", defaultCollection: "Radius", modeName: "Default" },
    { name: "scaling.json", path: "assets/tokens/radix/scaling.json", defaultCollection: "Scaling", modeName: "Default" },
    { name: "theme_a.json", path: "assets/tokens/brand/theme_a.json", defaultCollection: "Theme ✦", modeName: "Theme A" }
];

const OUTPUT_FILE = "combined_import.js";
const ARGS = process.argv.slice(2);
const SLICE = ARGS.find(a => a.startsWith('--slice='))?.split('=')[1];

function generate() {
    console.log("🚀 Generating Token Manifest...");
    if (SLICE) console.log(`🎯 Slicing by path: ${SLICE}`);

    let manifest = [];

    FILES.forEach(cfg => {
        const filePath = path.resolve(process.cwd(), cfg.path);
        if (!fs.existsSync(filePath)) return;

        const content = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(content);
        
        let tokens = TokenProcessor.flattenJSON(json);

        // Apply Slicing
        if (SLICE) {
            tokens = tokens.filter(t => t.name.toLowerCase().includes(SLICE.toLowerCase()));
        }

        if (tokens.length > 0) {
            manifest.push({
                name: cfg.name,
                config: cfg,
                tokens: tokens
            });
            console.log(`✅ Included ${tokens.length} tokens from ${cfg.name}`);
        }
    });

    const output = `
/**
 * Figma Token Manifest
 * Generated: ${new Date().toISOString()}
 * ${SLICE ? `Slice: ${SLICE}` : 'Full Import'}
 */

const DATASETS = ${JSON.stringify(manifest, null, 2)};

if (window.FigmaImporter) {
    FigmaImporter.run(DATASETS, { dryRun: false });
} else {
    console.error("❌ FigmaImporter not found! Please paste the engine script first.");
}
`;

    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`🎉 Generated ${OUTPUT_FILE} (${manifest.reduce((acc, d) => acc + d.tokens.length, 0)} total tokens)`);
}

generate();
