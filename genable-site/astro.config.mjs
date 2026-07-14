import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://genable.pages.dev',
  trailingSlash: 'never',
  build: { format: 'file' },
});
