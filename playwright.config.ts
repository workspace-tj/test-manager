import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
