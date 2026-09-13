import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { renderDailySite } from './daily-site.js';
import { buildDailyView } from './daily-view.js';
import { assembleTestRun } from './test-run-assembly.js';

const fixtureRoot = path.resolve('fixtures/quality-dashboard');
const readJson = async (name: string): Promise<unknown> => JSON.parse(await readFile(path.join(fixtureRoot, name), 'utf8'));

describe('production-like quality dashboard fixture', () => {
  it('integrates Vitest and Playwright facts into one TestRun and daily HTML', async () => {
    const catalog = await checkProject(path.join(fixtureRoot, 'test-manager.yaml'));
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const run = assembleTestRun({
      manifest: await readJson('manifest.json'),
      completedAt: '2026-09-13T00:01:00Z',
      unitArtifacts: await Promise.all([readJson('vitest.test-manager-unit.json'), readJson('playwright.test-manager-unit.json')]),
    }, new RegExp(catalog.catalog.rules.idPattern, 'u'));
    expect(run.success).toBe(true);
    if (!run.success) return;
    const view = buildDailyView(catalog.catalog, run.data);
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    expect(view.view.domains).toEqual([
      expect.objectContaining({ id: 'orders', planned: 5, passed: 3, failed: 1, expectedFailure: 1, unexpectedPass: 0, skipped: 0, missing: 0 }),
      expect.objectContaining({ id: 'billing', planned: 4, passed: 0, failed: 1, expectedFailure: 0, unexpectedPass: 1, skipped: 1, missing: 1 }),
    ]);
    expect(run.data.units[1]).toMatchObject({ state: 'incomplete', reason: 'runnerError', observations: [{ caseId: 'CASE-106' }, { caseId: 'CASE-107' }, { caseId: 'CASE-109' }] });
    expect(run.data.units[1]?.observations[0]?.attempts).toHaveLength(2);

    const stylesheet = await readFile(path.resolve('prototypes/quality-dashboard/assets/dashboard.css'), 'utf8');
    const files = renderDailySite(view.view, stylesheet);
    const html = files.get('index.html') ?? '';
    expect(html).toContain('stagingの日次実行');
    expect(html).toContain('1件の結果が欠損しています');
    expect(html).toContain('CASE-108');
    expect(html).toContain('注文管理');
    expect(html).toContain('請求管理');
    expect(html).not.toContain('取消可能な注文を取り消せる');
    expect(html).not.toContain('Fixture prototype');
  });
});
