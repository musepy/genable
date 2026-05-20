import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://genable.design',
  trailingSlash: 'never',
  build: { format: 'file' },
});
