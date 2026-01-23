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
    jsxInject: `import { h, Fragment } from 'preact'`
  }
})
