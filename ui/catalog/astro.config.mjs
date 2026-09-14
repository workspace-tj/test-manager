import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  build: { format: 'file' },
  compressHTML: false,
  devToolbar: { enabled: false },
});
