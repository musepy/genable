#!/usr/bin/env npx tsx
/**
 * @file testRenderLogic.ts
 * @description 隔离渲染逻辑测试 - 无需 Figma 运行时
 *
 * 运行: npx tsx scripts/testRenderLogic.ts
 */

import {
    calculateLayoutSizing,
    validateLayoutResult,
    isMagicWidth,
    isButton,
    isWideComponent,
    isStatItem,
    LayoutSizingInput,
    ParentContext
} from '../src/utils/layoutCalculator';

// ============================================
// TEST UTILITIES
// ============================================

interface TestCase {
    name: string;
    run: () => boolean;
}

const testCases: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
    testCases.push({ name, run: fn });
}

function expect<T>(actual: T) {
    return {
        toBe(expected: T) {
            if (actual !== expected) {
                console.error(`    ❌ Expected ${expected}, got ${actual}`);
                return false;
            }
            return true;
        },
        toBeNull() {
            if (actual !== null) {
                console.error(`    ❌ Expected null, got ${actual}`);
                return false;
            }
            return true;
        },
        toContain(expected: string) {
            if (typeof actual !== 'string' || !actual.includes(expected)) {
                console.error(`    ❌ Expected to contain "${expected}", got "${actual}"`);
                return false;
            }
            return true;
        },
        toBeGreaterThan(expected: number) {
            if (typeof actual !== 'number' || actual <= expected) {
                console.error(`    ❌ Expected > ${expected}, got ${actual}`);
                return false;
            }
            return true;
        }
    };
}

// ============================================
// TESTS: Helper Functions
// ============================================

test('isMagicWidth - should detect 320px', () => {
    return expect(isMagicWidth(320)).toBe(true);
});

test('isMagicWidth - should detect 375px', () => {
    return expect(isMagicWidth(375)).toBe(true);
});

test('isMagicWidth - should detect 200px (equal division width)', () => {
    return expect(isMagicWidth(200)).toBe(true);
});

test('isMagicWidth - should NOT detect 500px', () => {
    return expect(isMagicWidth(500)).toBe(false);
});

test('isButton - should detect "Submit Button"', () => {
    return expect(isButton('Submit Button')).toBe(true);
});

test('isButton - should detect "save-btn"', () => {
    return expect(isButton('save-btn')).toBe(true);
});

test('isButton - should NOT detect "Card"', () => {
    return expect(isButton('Card')).toBe(false);
});

test('isWideComponent - should detect "Dashboard"', () => {
    return expect(isWideComponent('Dashboard')).toBe(true);
});

test('isWideComponent - should detect "User Card"', () => {
    return expect(isWideComponent('User Card')).toBe(true);
});

test('isStatItem - should detect "Stat Item"', () => {
    return expect(isStatItem('Stat Item')).toBe(true);
});

test('isStatItem - should NOT detect "Stats Row"', () => {
    return expect(isStatItem('Stats Row')).toBe(false);
});

// ============================================
// TESTS: calculateLayoutSizing
// ============================================

const frameParent: ParentContext = { type: 'FRAME', layoutMode: 'VERTICAL' };
const pageParent: ParentContext = { type: 'PAGE' };

test('FILL sizing should set layoutAlign to STRETCH', () => {
    const input: LayoutSizingInput = {
        name: 'Content',
        layoutSizingHorizontal: 'FILL',
        childCount: 0
    };
    const result = calculateLayoutSizing(input, frameParent);
    return expect(result.layoutAlign).toBe('STRETCH');
});

test('FILL sizing in PAGE should NOT set layoutAlign', () => {
    const input: LayoutSizingInput = {
        name: 'Content',
        layoutSizingHorizontal: 'FILL',
        childCount: 0
    };
    const result = calculateLayoutSizing(input, pageParent);
    return expect(result.layoutAlign).toBe(undefined);
});

test('Button should have height 44px', () => {
    const input: LayoutSizingInput = {
        name: 'Submit Button',
        childCount: 1
    };
    const result = calculateLayoutSizing(input, frameParent);
    return expect(result.height).toBe(44);
});

test('Button with excessive height should be capped to 44px', () => {
    const input: LayoutSizingInput = {
        name: 'Primary Button',
        height: 100,
        childCount: 1
    };
    const result = calculateLayoutSizing(input, frameParent);
    return expect(result.height).toBe(44);
});

test('Wide component without width should default to 360px', () => {
    const input: LayoutSizingInput = {
        name: 'Dashboard Card',
        childCount: 2
    };
    const result = calculateLayoutSizing(input, frameParent);
    return expect(result.width).toBe(360);
});

test('FILL component should have reasonable default width', () => {
    const input: LayoutSizingInput = {
        name: 'Content',
        layoutSizingHorizontal: 'FILL',
        childCount: 0
    };
    const result = calculateLayoutSizing(input, frameParent);
    return expect(result.width).toBeGreaterThan(100);
});

test('AutoLayout VERTICAL should enable HUG mode', () => {
    const input: LayoutSizingInput = {
        name: 'Container',
        layout: 'VERTICAL',
        childCount: 3
    };
    const result = calculateLayoutSizing(input, frameParent);
    // Removed: primaryAxisSizingMode check (property no longer exists)
    // HUG mode is indicated by height being null
    return expect(result.height).toBeNull();
});

test('Stat item in VERTICAL layout should STRETCH', () => {
    const input: LayoutSizingInput = {
        name: 'Stat Item',
        layout: 'VERTICAL',
        childCount: 2
    };
    const result = calculateLayoutSizing(input, frameParent);
    return expect(result.layoutAlign).toBe('STRETCH');
});

// ============================================
// TESTS: validateLayoutResult
// ============================================

test('1px height should trigger error (non-divider)', () => {
    const issues = validateLayoutResult('Content Frame', 320, 1);
    return issues.length > 0 &&
        expect(issues[0].type).toBe('error') &&
        expect(issues[0].message).toContain('1px');
});

test('1px height should NOT trigger error for divider', () => {
    const issues = validateLayoutResult('Line Divider', 320, 1);
    const heightIssue = issues.find(i => i.message.includes('1px'));
    return heightIssue === undefined;
});

test('Magic number width should trigger warning', () => {
    const issues = validateLayoutResult('Card', 320, 200);
    const widthIssue = issues.find(i => i.message.includes('magic number'));
    return widthIssue !== undefined &&
        expect(widthIssue.type).toBe('warning');
});

test('Zero dimension should trigger error', () => {
    const issues = validateLayoutResult('Invalid', 0, 100);
    return issues.length > 0 &&
        expect(issues[0].type).toBe('error');
});

// ============================================
// RUN ALL TESTS
// ============================================

console.log('\n🧪 Running Layout Calculator Tests\n');
console.log('='.repeat(50));

for (const tc of testCases) {
    try {
        const success = tc.run();
        if (success) {
            console.log(`  ✅ ${tc.name}`);
            passed++;
        } else {
            console.log(`  ❌ ${tc.name}`);
            failed++;
        }
    } catch (err) {
        console.log(`  ❌ ${tc.name}`);
        console.error(`    Error: ${err}`);
        failed++;
    }
}

console.log('='.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('🎉 All tests passed!\n');
}
