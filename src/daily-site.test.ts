import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { buildDailyView } from './daily-view.js';
import { renderDailySite } from './daily-site.js';
import { parseTestRun } from './test-run.js';

const makeRun = (runId: string, first: 'passed' | 'failed', second: 'passed' | 'failed') => {
  const parsed = parseTestRun({
    schemaVersion: 1, runId, attempt: 1, environment: 'dev', commit: runId === 'current' ? '7f3a12c' : '6e2b11a',
    scopeId: 'daily-all', startedAt: '2026-09-13T00:00:00Z', completedAt: '2026-09-13T00:01:00Z', ciUrl: `https://example.com/${runId}`,
    units: [{
      state: 'completed', unitId: 'vitest-unit', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-001', 'CASE-002'],
      observations: [['CASE-001', first], ['CASE-002', second]].map(([caseId, outcome], index) => ({
        caseId, expected: 'passed', attemptCoverage: { kind: 'complete' },
        attempts: [{ outcome, durationMs: 10, startedAt: `2026-09-13T00:00:0${index + 1}Z`, artifactRefs: [] }],
      })),
    }],
  }, /^(?:CASE-[0-9]{3})$/u);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};

describe('daily site', () => {
  it('renders facts from the daily view instead of prototype fixture text', async () => {
    const catalog = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!catalog.ok) throw new Error('fixture must be valid');
    const view = buildDailyView(catalog.catalog, makeRun('current', 'failed', 'passed'), makeRun('previous', 'passed', 'failed'));
    if (!view.ok) throw new Error('daily view must be valid');

    const stylesheet = await readFile(path.resolve('prototypes/quality-dashboard/assets/dashboard.css'), 'utf8');
    const files = renderDailySite(view.view, stylesheet);
    const html = files.get('index.html');
    expect(html).toContain('devの日次実行');
    expect(html).toContain('新規失敗 1');
    expect(html).toContain('復旧 1');
    expect(html).toContain('CASE-001');
    expect(html).toContain('orders');
    expect(html).toContain('2 / 2');
    expect(html).toContain('role="columnheader">結果取得率');
    expect(html).toContain('aria-label="結果取得率100%"');
    expect(html).toContain('aria-label="対象ケースなし"');
    expect(html).not.toContain('1,324');
    expect(files.get('assets/dashboard.css')).toContain('.domain-table-head');
  });

  it('does not describe an unavailable comparison as no change', async () => {
    const catalog = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!catalog.ok) throw new Error('fixture must be valid');
    const view = buildDailyView(catalog.catalog, makeRun('current', 'passed', 'passed'));
    if (!view.ok) throw new Error('daily view must be valid');
    const stylesheet = await readFile(path.resolve('prototypes/quality-dashboard/assets/dashboard.css'), 'utf8');

    const html = renderDailySite(view.view, stylesheet).get('index.html');

    expect(html).toContain('比較できる前回実行がありません');
    expect(html).not.toContain('前回から状態の変化はありません');
    expect(html).not.toContain('同じ環境・同じ実行範囲の前回結果と比較します');
  });
});
