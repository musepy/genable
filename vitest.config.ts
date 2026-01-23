import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Environment
    environment: 'node',
    
    // Include patterns
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/ui/**',  // UI layer (difficult to test without DOM)
      ]
    },
    
    // Globals for cleaner test syntax
    globals: true,
  },
  resolve: {
    alias: {
      // Add aliases if needed
    }
  }
});
