import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { resolve } from 'path'

/**
 * Vite config for standalone UI preview
 * 
 * Usage: npx vite --config vite.preview.config.ts
 */
export default defineConfig({
  plugins: [preact()],
  
  root: resolve(__dirname, 'preview'),
  
  resolve: {
    alias: {
      // Mock Figma utilities
      '@create-figma-plugin/utilities': resolve(__dirname, 'preview/mocks/figma-utilities.ts'),
      '@create-figma-plugin/ui': resolve(__dirname, 'preview/mocks/figma-ui.ts'),
      // Alias React 17+ JSX runtime to Preact
      'react/jsx-runtime': resolve(__dirname, 'node_modules/preact/compat/jsx-runtime.mjs'),
      'react/jsx-dev-runtime': resolve(__dirname, 'node_modules/preact/compat/jsx-dev-runtime.js'),
    }
  },
  
  server: {
    port: 5173,
    open: true,
  },
  
  // Handle .tsx files
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  }
})
