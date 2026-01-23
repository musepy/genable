/**
 * @file eslint.config.js
 * @description ESLint v9 flat config for "Constraints as Code"
 * 
 * Key Rules:
 * 1. forbid-component-props[style] - Ban inline style={} to force CSS classes/tokens
 */

import tsParser from '@typescript-eslint/parser';
import eslintPlugin from 'eslint-plugin-react';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: eslintPlugin,
    },
    settings: {
      react: {
        pragma: 'h', // Preact compatibility
        fragment: 'Fragment',
        version: 'detect',
      },
    },
    rules: {
      // ===== Constraints as Code =====
      
      // Ban inline styles - Force use of CSS classes/tokens
      'react/forbid-component-props': ['warn', {
        forbid: [{
          propName: 'style',
          message: '❌ Inline styles are banned. Use CSS classes or design tokens.',
        }],
      }],
      
      // ===== General Quality =====
      'no-console': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.*'],
  },
];

