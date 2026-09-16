import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { checkProject } from './catalog.js';
import { loadDashboardStyles } from './dashboard-styles.js';
import { buildDailyView } from './daily-view.js';
import { QualitySitePages } from './quality-site.e2e.pages.js';
import { createReleaseCatalogSnapshot } from './release-catalog.js';
import { buildReleaseDiff } from './release-diff.js';
import { renderQualitySite } from './quality-site.js';
import { assembleTestRun } from './test-run-assembly.js';

const fixtureRoot = path.resolve('fixtures/quality-dashboard');
const origin = 'http://test-manager.local';

const buildQualitySite = async (): Promise<ReadonlyMap<string, string>> => {
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
  return renderQualitySite(checked.catalog, daily.view, release.view, await loadDashboardStyles());
};

export const test = base.extend<Readonly<{ qualitySite: QualitySitePages }>>({
  qualitySite: async ({ context, page }, use) => {
    const files = await buildQualitySite();
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
    await use(new QualitySitePages(page, origin));
  },
});

export { expect };
