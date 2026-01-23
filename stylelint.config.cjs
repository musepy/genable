/**
 * @file stylelint.config.cjs
 * @description Stylelint configuration for "Constraints as Code"
 * 
 * Key Rules:
 * 1. color-no-hex - Ban hardcoded hex colors to force CSS variables
 * 2. function-disallowed-list - Ban rgb/rgba to force var(--color-*)
 */

module.exports = {
  extends: ['stylelint-config-standard'],
  rules: {
    // ===== Constraints as Code =====
    
    // Ban hardcoded hex colors - Force use of CSS variables
    'color-no-hex': true,
    
    // Ban rgb/rgba functions - Force CSS variables for all colors
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    
    // ===== Relaxations (for Preact/inline-style scenarios) =====
    // If using CSS-in-JS, you may need to configure differently
    
    // Allow unknown at-rules (e.g., @keyframes from tokens)
    'at-rule-no-unknown': null,
    
    // Allow unknown functions (e.g., var())
    'function-no-unknown': null,
  },
  ignoreFiles: ['dist/**', 'node_modules/**'],
};
