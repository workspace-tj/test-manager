import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { loadDashboardStyles } from './dashboard-styles.js';
import { buildDailyView } from './daily-view.js';
import { createReleaseCatalogSnapshot } from './release-catalog.js';
import { buildReleaseDiff } from './release-diff.js';
import { renderQualitySite } from './quality-site.js';
import { assembleTestRun } from './test-run-assembly.js';

const fixtureRoot = path.resolve('fixtures/quality-dashboard');

describe('generated quality site in a browser', () => {
  const origin = 'http://test-manager.local';
  let files: ReadonlyMap<string, string>;

  beforeAll(async () => {
    const checked = await checkProject(path.join(fixtureRoot, 'test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(path.join(fixtureRoot, file), 'utf8'));
    const run = assembleTestRun({
      manifest: await readJson('manifest.json'),
      completedAt: '2026-09-13T00:01:00Z',
      unitArtifacts: await Promise.all([readJson('vitest.test-manager-unit.json'), readJson('playwright.test-manager-unit.json')]),
    }, new RegExp(checked.catalog.rules.idPattern, 'u'));
    if (!run.success) throw new Error('fixture run must be valid');
    const daily = buildDailyView(checked.catalog, run.data);
    if (!daily.ok) throw new Error('daily view must be valid');
    const production = { ...checked.catalog, cases: checked.catalog.cases.filter((managedCase) => managedCase.id !== 'CASE-101') };
    const release = buildReleaseDiff({
      production: createReleaseCatalogSnapshot(production, '6e2b11a'),
      staging: { snapshot: createReleaseCatalogSnapshot(checked.catalog, '7f3a12c') },
    });
    if (!release.ok) throw new Error('release view must be valid');
    files = renderQualitySite(checked.catalog, daily.view, release.view, await loadDashboardStyles());
  });

  const newPage = async (browser: Browser, options: BrowserContextOptions = {}): Promise<Page> => {
    const context = await browser.newContext(options);
    await context.route(`${origin}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const requested = decodeURIComponent(pathname).replace(/^\//u, '');
      const file = requested === '' || requested.endsWith('/') ? `${requested}index.html` : requested;
      const content = files.get(file);
      if (content === undefined) {
        await route.fulfill({ status: 404, body: 'not found' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html',
        body: content,
      });
    });
    return context.newPage();
  };

  it('navigates between daily, release, and direct case search', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await newPage(browser);
      await page.goto(origin);
      expect(await page.getByRole('heading', { name: 'stagingの日次実行', exact: true }).isVisible()).toBe(true);
      expect(await page.locator('[role="rowgroup"] [role="row"]').evaluateAll((rows) => rows.every((row) => [...row.children].every((cell) => cell.getAttribute('role') === 'rowheader' || cell.getAttribute('role') === 'cell')))).toBe(true);
      expect(await page.getByRole('progressbar').count()).toBeGreaterThan(0);
      await page.getByRole('link', { name: 'リリース差分' }).click();
      expect(await page.getByRole('heading', { name: '前回productionからの変更' }).isVisible()).toBe(true);
      await page.getByRole('link', { name: 'ケース探索' }).click();
      expect(await page.getByRole('heading', { name: 'ケース検索' }).isVisible()).toBe(true);
      await page.getByRole('searchbox').fill('CASE-108');
      expect(await page.locator('#result-summary').textContent()).toBe('1ケース');
      expect(await page.locator('[data-case-row]:visible').count()).toBe(1);
    } finally {
      await browser.close();
    }
  });

  it('keeps search and navigation usable at a mobile viewport', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await newPage(browser, { viewport: { width: 390, height: 844 } });
      for (const [url, heading] of [
        [origin, 'stagingの日次実行'],
        [`${origin}/release.html`, '前回productionからの変更'],
        [`${origin}/catalog/cases/index.html`, 'ケース検索'],
      ] as const) {
        await page.goto(url);
        expect(await page.getByRole('heading', { name: heading, exact: true }).isVisible()).toBe(true);
        expect(await page.getByRole('navigation', { name: '主要ナビゲーション' }).isVisible()).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      expect(await page.getByRole('searchbox').isVisible()).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
