/**
 * @file testPostProcessor.ts
 * @description Standalone CLI test for PostProcessor rules
 * 
 * Usage: npx tsx scripts/testPostProcessor.ts
 * 
 * Tests the PostProcessor's ability to fix common LLM output biases:
 * - 320px fixed width → FILL
 * - 60px button height → 44px
 * - Shadow opacity fixes
 * - Avatar circular corners
 */

// Import using relative paths (for CLI execution)
import { postProcess, getCorrectionRules, CorrectionLog } from '../src/skills/layout-engine';
import { NodeLayer } from '../src/schema/layerSchema';

// ==========================================
// Test Cases - Simulating Bad LLM Output
// ==========================================

interface TestCase {
    name: string;
    description: string;
    input: NodeLayer;
    expectedFixes: string[]; // Rule names that should trigger
    validation: (output: NodeLayer) => { passed: boolean; message: string };
}

const TEST_CASES: TestCase[] = [
    // ==========================================
    // TEST 1: Magic Number Width Correction
    // ==========================================
    {
        name: '320px Fixed Width in Nested Container',
        description: 'LLM outputs a 320px width card inside a VERTICAL parent',
        input: {
            type: 'FRAME',
            props: {
                name: 'PageContainer',
                layout: 'VERTICAL',
                width: 1440,
                padding: { top: 32, right: 32, bottom: 32, left: 32 }
            },
            children: [
                {
                    type: 'FRAME',
                    props: {
                        name: 'ContentCard',
                        layout: 'VERTICAL',
                        width: 320, // ← Bad: Fixed width in nested container
                        fills: ['#FFFFFF'],
                        cornerRadius: 16
                    },
                    children: [
                        { type: 'TEXT', props: { content: 'Hello World', fontSize: 16 } }
                    ]
                }
            ]
        },
        expectedFixes: ['MagicNumberWidthCorrection'],
        validation: (output) => {
            const card = output.children?.[0];
            const passed = card?.props?.layoutSizingHorizontal === 'FILL' &&
                card?.props?.width === undefined;
            return {
                passed,
                message: passed
                    ? '✅ 320px width converted to FILL'
                    : `❌ Card still has width=${card?.props?.width}, sizing=${card?.props?.layoutSizingHorizontal}`
            };
        }
    },

    // ==========================================
    // TEST 2: Button Height Correction
    // ==========================================
    {
        name: 'Button Height 60px → 44px',
        description: 'LLM outputs a button with 60px height',
        input: {
            type: 'FRAME',
            props: {
                name: 'ButtonContainer',
                layout: 'VERTICAL'
            },
            children: [
                {
                    type: 'FRAME',
                    props: {
                        name: 'SubmitButton',
                        layout: 'HORIZONTAL',
                        height: 60, // ← Bad: Too tall
                        fills: ['#3B82F6'],
                        cornerRadius: 8
                    },
                    children: [
                        { type: 'TEXT', props: { content: 'Submit', fontSize: 16, color: '#FFFFFF' } }
                    ]
                }
            ]
        },
        expectedFixes: ['ButtonHeightCorrection'],
        validation: (output) => {
            const btn = output.children?.[0];
            const passed = btn?.props?.height === 44;
            return {
                passed,
                message: passed
                    ? '✅ Button height corrected to 44px'
                    : `❌ Button height is ${btn?.props?.height}px`
            };
        }
    },

    // ==========================================
    // TEST 3: Avatar Circular Corners
    // ==========================================
    {
        name: 'Avatar Corner Radius = Width/2',
        description: 'LLM outputs avatar with 16px cornerRadius instead of circular',
        input: {
            type: 'FRAME',
            props: { name: 'Profile', layout: 'VERTICAL' },
            children: [
                {
                    type: 'FRAME',
                    props: {
                        name: 'Avatar',
                        width: 96,
                        height: 96,
                        fills: ['#E5E7EB'],
                        cornerRadius: 16 // ← Bad: Should be 48 for circular
                    }
                }
            ]
        },
        expectedFixes: ['AvatarCornerCorrection'],
        validation: (output) => {
            const avatar = output.children?.[0];
            const passed = avatar?.props?.cornerRadius === 48;
            return {
                passed,
                message: passed
                    ? '✅ Avatar cornerRadius corrected to 48 (circular)'
                    : `❌ Avatar cornerRadius is ${avatar?.props?.cornerRadius}`
            };
        }
    },

    // ==========================================
    // TEST 4: Shadow Opacity Fix
    // ==========================================
    {
        name: 'Shadow Opacity 100% → 8%',
        description: 'LLM outputs pure black shadow',
        input: {
            type: 'FRAME',
            props: {
                name: 'Card',
                layout: 'VERTICAL',
                fills: ['#FFFFFF'],
                cornerRadius: 12,
                effects: [
                    {
                        type: 'DROP_SHADOW',
                        color: '#000000', // ← Bad: 100% black shadow
                        offset: { x: 0, y: 4 },
                        blur: 16
                    }
                ]
            }
        },
        expectedFixes: ['ShadowOpacityFix'],
        validation: (output) => {
            const shadow = output.props?.effects?.[0];
            const passed = shadow?.color === '#00000014';
            return {
                passed,
                message: passed
                    ? '✅ Shadow opacity corrected to 8%'
                    : `❌ Shadow color is ${shadow?.color}`
            };
        }
    },

    // ==========================================
    // TEST 5: Line/Divider Sizing
    // ==========================================
    {
        name: 'Divider Line Height Fix',
        description: 'LLM outputs divider with FILL height instead of 1px',
        input: {
            type: 'FRAME',
            props: { name: 'Container', layout: 'VERTICAL' },
            children: [
                {
                    type: 'FRAME',
                    props: {
                        name: 'Divider Line',
                        layoutSizingVertical: 'FILL', // ← Bad
                        fills: ['#E5E7EB']
                    }
                }
            ]
        },
        expectedFixes: ['LineDividerCorrection'],
        validation: (output) => {
            const line = output.children?.[0];
            const passed = line?.props?.height === 1 &&
                line?.props?.layoutSizingVertical === 'FIXED' &&
                line?.props?.layoutSizingHorizontal === 'FILL';
            return {
                passed,
                message: passed
                    ? '✅ Divider corrected: width=FILL, height=1px'
                    : `❌ Divider: height=${line?.props?.height}, vertical=${line?.props?.layoutSizingVertical}`
            };
        }
    },

    // ==========================================
    // TEST 6: Dark Background Text Contrast
    // ==========================================
    {
        name: 'White Text on Dark Background',
        description: 'LLM outputs dark text on dark background',
        input: {
            type: 'FRAME',
            props: {
                name: 'DarkCard',
                layout: 'VERTICAL',
                fills: ['#1F2937'], // Dark background
                padding: { top: 16, right: 16, bottom: 16, left: 16 }
            },
            children: [
                {
                    type: 'TEXT',
                    props: {
                        content: 'Title',
                        fontSize: 18,
                        color: '#111827' // ← Bad: Dark text on dark bg
                    }
                }
            ]
        },
        expectedFixes: ['DarkBackgroundTextContrast'],
        validation: (output) => {
            const text = output.children?.[0];
            const passed = text?.props?.color === '#FFFFFF';
            return {
                passed,
                message: passed
                    ? '✅ Text color corrected to white for contrast'
                    : `❌ Text color is ${text?.props?.color}`
            };
        }
    },

    // ==========================================
    // TEST 7: Horizontal Child FILL
    // ==========================================
    {
        name: 'Horizontal Children Use FILL',
        description: 'Children in horizontal container should stretch',
        input: {
            type: 'FRAME',
            props: {
                name: 'StatsRow',
                layout: 'HORIZONTAL',
                layoutSizingHorizontal: 'FILL',
                gap: 0
            },
            children: [
                {
                    type: 'FRAME',
                    props: {
                        name: 'StatItem',
                        layout: 'VERTICAL',
                        width: 100, // ← Bad: Fixed width
                        layoutSizingHorizontal: 'FIXED'
                    },
                    children: [
                        { type: 'TEXT', props: { content: '248', fontSize: 20 } }
                    ]
                },
                {
                    type: 'FRAME',
                    props: {
                        name: 'StatItem2',
                        layout: 'VERTICAL',
                        width: 100 // ← Bad: Fixed width
                    },
                    children: [
                        { type: 'TEXT', props: { content: '12K', fontSize: 20 } }
                    ]
                }
            ]
        },
        expectedFixes: ['HorizontalChildFillCorrection'],
        validation: (output) => {
            const children = output.children || [];
            const allFill = children.every((c: NodeLayer) =>
                c.props?.layoutSizingHorizontal === 'FILL' &&
                c.props?.width === undefined
            );
            return {
                passed: allFill,
                message: allFill
                    ? '✅ All horizontal children use FILL sizing'
                    : `❌ Some children still have fixed width`
            };
        }
    },

    // ==========================================
    // TEST 8: 320px in HORIZONTAL Parent (P0 Fix Verification)
    // ==========================================
    {
        name: '320px Fixed Width in HORIZONTAL Container',
        description: 'LLM outputs 320px width children inside a HORIZONTAL parent (not just VERTICAL)',
        input: {
            type: 'FRAME',
            props: {
                name: 'ActionButtons',
                layout: 'HORIZONTAL', // ← Parent is HORIZONTAL, not VERTICAL
                gap: 12,
                layoutSizingHorizontal: 'FILL'
            },
            children: [
                {
                    type: 'FRAME',
                    props: {
                        name: 'FollowButton',
                        layout: 'HORIZONTAL',
                        width: 320, // ← Bad: Fixed width in HORIZONTAL parent
                        height: 44,
                        fills: ['#3B82F6'],
                        cornerRadius: 8
                    },
                    children: [
                        { type: 'TEXT', props: { content: 'Follow', fontSize: 15, color: '#FFFFFF' } }
                    ]
                },
                {
                    type: 'FRAME',
                    props: {
                        name: 'MessageButton',
                        layout: 'HORIZONTAL',
                        width: 320, // ← Bad: Fixed width in HORIZONTAL parent
                        height: 44,
                        fills: ['#FFFFFF'],
                        stroke: '#D1D5DB',
                        cornerRadius: 8
                    },
                    children: [
                        { type: 'TEXT', props: { content: 'Message', fontSize: 15, color: '#374151' } }
                    ]
                }
            ]
        },
        expectedFixes: ['MagicNumberWidthCorrection'],
        validation: (output) => {
            const children = output.children || [];
            const allFill = children.every((c: NodeLayer) =>
                c.props?.layoutSizingHorizontal === 'FILL' &&
                c.props?.width === undefined
            );
            return {
                passed: allFill,
                message: allFill
                    ? '✅ 320px width in HORIZONTAL parent converted to FILL'
                    : `❌ Some children still have fixed width in HORIZONTAL parent`
            };
        }
    }
];

// ==========================================
// Test Runner
// ==========================================

function runTests(): void {
    console.log('\n🧪 PostProcessor Test Suite\n');
    console.log('='.repeat(60));

    const rules = getCorrectionRules();
    console.log(`📋 Available rules: ${rules.length}`);
    rules.forEach(r => console.log(`   - ${r.name}`));
    console.log('='.repeat(60));
    console.log('\n');

    let passed = 0;
    let failed = 0;

    for (const test of TEST_CASES) {
        console.log(`\n📝 Test: ${test.name}`);
        console.log(`   ${test.description}`);

        try {
            // Run PostProcessor with logging
            const output = postProcess(test.input, true);

            // Validate result
            const result = test.validation(output);

            if (result.passed) {
                console.log(`   ${result.message}`);
                passed++;
            } else {
                console.log(`   ${result.message}`);
                failed++;
            }

            // Check if expected rules were triggered (from console logs)
            console.log(`   Expected fixes: ${test.expectedFixes.join(', ')}`);

        } catch (error) {
            console.log(`   ❌ Error: ${error}`);
            failed++;
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 Results: ${passed}/${passed + failed} tests passed`);

    if (failed === 0) {
        console.log('✅ All tests passed! PostProcessor is working correctly.\n');
    } else {
        console.log(`⚠️  ${failed} test(s) failed. Review the PostProcessor rules.\n`);
    }
}

// Run if called directly
runTests();
