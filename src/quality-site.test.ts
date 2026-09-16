import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { buildDailyView } from './daily-view.js';
import { createReleaseCatalogSnapshot } from './release-catalog.js';
import { buildReleaseDiff } from './release-diff.js';
import { renderQualitySite } from './quality-site.js';
import { assembleTestRun } from './test-run-assembly.js';

const fixtureRoot = path.resolve('fixtures/quality-dashboard');

describe('quality site', () => {
  it('composes daily, release, and catalog pages with resolvable internal navigation', async () => {
    const checked = await checkProject(path.join(fixtureRoot, 'test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const run = assembleTestRun({
      manifest: JSON.parse(await readFile(path.join(fixtureRoot, 'manifest.json'), 'utf8')),
      completedAt: '2026-09-13T00:01:00Z',
      unitArtifacts: await Promise.all(['vitest.test-manager-unit.json', 'playwright.test-manager-unit.json']
        .map(async (file) => JSON.parse(await readFile(path.join(fixtureRoot, file), 'utf8')))),
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

    const files = renderQualitySite(checked.catalog, daily.view, release.view, 'body{}');

    expect(files.has('index.html')).toBe(true);
    expect(files.has('release.html')).toBe(true);
    expect(files.has('catalog/index.html')).toBe(true);
    expect(files.has('catalog/.test-manager-output')).toBe(false);
    for (const [file, content] of files) {
      if (!file.endsWith('.html')) continue;
      expect(content.match(/aria-label="主要ナビゲーション"/gu)).toHaveLength(1);
      expect(content.match(/aria-current="page"/gu)).toHaveLength(1);
      expect(content.match(/<nav class="segmented-nav"/gu)).toHaveLength(1);
      for (const match of content.matchAll(/href="([^"]+)"/gu)) {
        const href = match[1];
        if (!href || /^[a-z]+:/u.test(href) || href.startsWith('#')) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), href));
        expect(files.has(target), `${file} links to missing ${target}`).toBe(true);
      }
    }
  });
});
