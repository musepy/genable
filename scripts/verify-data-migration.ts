#!/usr/bin/env npx ts-node
/**
 * @file verify-data-migration.ts
 * @description Verify that semantic-constraints.json covers all hardcoded values in layoutRules.ts
 * 
 * Run with: npx ts-node scripts/verify-data-migration.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_PATH = path.join(__dirname, '../src/config/semantic-constraints.json');
const LAYOUT_RULES_PATH = path.join(__dirname, '../src/constants/layoutRules.ts');

interface SemanticConstraint {
    hMin?: number;
    hMax?: number;
    hDefault?: number;
    hFallback?: number;
    wMin?: number;
    wMax?: number;
    wDefault?: number;
    layoutSizingHorizontal?: string;
    layoutSizingVertical?: string;
    paddingMin?: number;
    cornerRadius?: number;
    priority?: number;
}

interface ConstraintsConfig {
    constraints: Record<string, SemanticConstraint>;
}

// Known semantic types that MUST have constraints
const REQUIRED_SEMANTICS = [
    'BUTTON', 'ICON_BUTTON', 'FAB',
    'TEXT_FIELD', 'TEXT_AREA', 'SEARCH_BAR',
    'AVATAR', 'DIVIDER',
    'CARD', 'SECTION',
    'NAV_BAR', 'ACTION_BAR'
];

function main() {
    console.log('🔍 Verifying Data Migration...\n');

    // 1. Load semantic-constraints.json
    const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config: ConstraintsConfig = JSON.parse(configRaw);
    const definedTypes = Object.keys(config.constraints);

    console.log(`📦 Found ${definedTypes.length} semantic types in JSON config:\n   ${definedTypes.join(', ')}\n`);

    // 2. Check required types
    const missingTypes: string[] = [];
    for (const type of REQUIRED_SEMANTICS) {
        if (!config.constraints[type]) {
            missingTypes.push(type);
        }
    }

    if (missingTypes.length > 0) {
        console.log(`❌ Missing required semantic types in JSON:\n   ${missingTypes.join(', ')}\n`);
    } else {
        console.log(`✅ All required semantic types are defined.\n`);
    }

    // 3. Scan layoutRules.ts for hardcoded magic numbers
    const layoutRulesContent = fs.readFileSync(LAYOUT_RULES_PATH, 'utf-8');
    
    // Pattern: Look for numeric literals in function bodies
    const hardcodedPatterns = [
        { pattern: /height\s*[=<>]+\s*(\d+)/g, desc: 'height comparisons' },
        { pattern: /width\s*[=<>]+\s*(\d+)/g, desc: 'width comparisons' },
        { pattern: /padding\s*[=:]\s*(\d+)/g, desc: 'padding values' },
        { pattern: /radius\s*[=:]\s*(\d+)/g, desc: 'radius values' },
    ];

    console.log('🔎 Scanning layoutRules.ts for hardcoded values:\n');
    for (const { pattern, desc } of hardcodedPatterns) {
        const matches = layoutRulesContent.match(pattern);
        if (matches && matches.length > 0) {
            console.log(`   ⚠️ Found ${matches.length} ${desc}: ${Array.from(new Set(matches)).slice(0, 5).join(', ')}...`);
        }
    }

    // 4. Summary
    console.log('\n📊 Migration Status Summary:');
    console.log('─────────────────────────────');
    console.log(`   JSON Types Defined:    ${definedTypes.length}`);
    console.log(`   Required Types Check:  ${missingTypes.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Hardcoded Values:      ⚠️ Review recommended`);
    console.log('\n💡 Next Steps:');
    console.log('   1. Add missing semantic types to semantic-constraints.json');
    console.log('   2. Replace hardcoded values with JSON lookups');
    console.log('   3. Run tests: npm test -- --run');

    // Exit code
    process.exit(missingTypes.length > 0 ? 1 : 0);
}

main();
