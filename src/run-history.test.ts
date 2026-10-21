import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { renderDailySite } from './daily-site.js';
import { buildDailyView } from './daily-view.js';
import { buildRunHistory } from './run-history.js';
import { parseTestRun } from './test-run.js';
import type { TestRun } from './test-run.js';

type Outcome = 'passed' | 'failed' | 'retried' | 'missing' | 'skipped' | 'unexpectedPass';

const run = (day: number, commit: string, outcomes: Readonly<Record<string, Outcome>>, environment = 'dev'): TestRun => {
  const at = (minute: number) => `2026-10-${String(day).padStart(2, '0')}T00:0${minute}:00Z`;
  const attempt = (outcome: 'passed' | 'failed', minute: number) => ({ outcome, durationMs: 1, startedAt: at(minute), artifactRefs: [] });
  const parsed = parseTestRun({
    schemaVersion: 1, runId: `run-${day}`, attempt: 1, environment, commit, scopeId: 'daily-all',
    startedAt: at(0), completedAt: at(5), ciUrl: `https://example.com/${day}`,
    units: [{
      state: Object.values(outcomes).includes('missing') ? 'incomplete' : 'completed', ...(Object.values(outcomes).includes('missing') ? { reason: 'runnerError' } : {}), unitId: 'vitest-unit', runner: 'vitest', layer: 'unit', target: 'node',
      plannedCaseIds: Object.keys(outcomes),
      observations: Object.entries(outcomes).filter(([, outcome]) => outcome !== 'missing').map(([caseId, outcome]) => ({
        caseId, expected: outcome === 'unexpectedPass' ? 'failed' : outcome === 'skipped' ? 'skipped' : 'passed', attemptCoverage: { kind: 'complete' },
        attempts: outcome === 'retried' ? [attempt('failed', 1), attempt('passed', 2)] : outcome === 'skipped' ? [{ outcome: 'skipped', durationMs: 0, startedAt: at(1), artifactRefs: [] }] : [attempt(outcome === 'unexpectedPass' ? 'passed' : outcome === 'failed' ? 'failed' : 'passed', 1)],
      })),
    }],
  }, /^(?:CASE-[0-9]{3})$/u);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};

const catalog = async () => {
  const checked = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
  if (!checked.ok) throw new Error('fixture must be valid');
  return checked.catalog;
};

describe('run history', () => {
  it('counts retried passes and failures on commits that also passed as flaky, separately from failing streaks', async () => {
    const history = [
      run(16, 'a1a1a1a', { 'CASE-001': 'passed' }),
      run(17, 'a1a1a1a', { 'CASE-001': 'retried' }),
      run(18, 'b2b2b2b', { 'CASE-001': 'passed' }),
      run(19, 'b2b2b2b', { 'CASE-001': 'failed' }),
    ];
    const current = run(20, 'b2b2b2b', { 'CASE-001': 'passed' });
    const result = buildRunHistory(await catalog(), current, history);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.runs.map((item) => item.runId)).toEqual(['run-16', 'run-17', 'run-18', 'run-19', 'run-20']);
    expect(result.view.flaky).toEqual([expect.objectContaining({ caseId: 'CASE-001', flakyRuns: 2, observedRuns: 5, passRate: 0.8 })]);
    expect(result.view.failingStreaks).toEqual([]);
  });

  it('reports consecutive failures without calling a consistently failing case flaky', async () => {
    const history = [run(17, 'a1a1a1a', { 'CASE-001': 'passed' }), run(18, 'b2b2b2b', { 'CASE-001': 'failed' }), run(19, 'c3c3c3c', { 'CASE-001': 'failed' })];
    const result = buildRunHistory(await catalog(), run(20, 'd4d4d4d', { 'CASE-001': 'failed' }), history);
    if (!result.ok) throw new Error(result.problems.join('; '));
    expect(result.view.flaky).toEqual([]);
    expect(result.view.failingStreaks).toEqual([expect.objectContaining({ caseId: 'CASE-001', streak: 3, since: '2026-10-18T00:05:00Z' })]);
  });

  it('keeps only the latest window, drops runs newer than the current run and duplicates, and rejects other environments', async () => {
    const days = [10, 11, 12, 13, 14, 15];
    const history = [...days.map((day) => run(day, 'a1a1a1a', { 'CASE-001': 'passed' })), run(30, 'a1a1a1a', { 'CASE-001': 'passed' }), run(15, 'a1a1a1a', { 'CASE-001': 'passed' })];
    const result = buildRunHistory(await catalog(), run(16, 'a1a1a1a', { 'CASE-001': 'passed' }), history, 3);
    if (!result.ok) throw new Error(result.problems.join('; '));
    expect(result.view.runs.map((item) => item.runId)).toEqual(['run-14', 'run-15', 'run-16']);
    expect(buildRunHistory(await catalog(), run(16, 'a1a1a1a', {}), [run(15, 'a1a1a1a', {}, 'staging')])).toEqual({
      ok: false, problems: ['history run run-15 attempt 1 uses staging/daily-all, not dev/daily-all'],
    });
  });

  it('ends a failing streak at a missing or skipped result and counts trend categories from catalog cases', async () => {
    const history = [run(16, 'a1a1a1a', { 'CASE-001': 'failed' }), run(17, 'a1a1a1a', { 'CASE-001': 'missing' }), run(18, 'b2b2b2b', { 'CASE-001': 'failed' }), run(19, 'c3c3c3c', { 'CASE-001': 'skipped' })];
    const broken = buildRunHistory(await catalog(), run(20, 'd4d4d4d', { 'CASE-001': 'failed' }), history);
    if (!broken.ok) throw new Error(broken.problems.join('; '));
    expect(broken.view.failingStreaks).toEqual([]);
    expect(broken.view.runs.map((item) => [item.failed, item.missing, item.other])).toEqual([[1, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 0, 0]]);
    const unexpected = buildRunHistory(await catalog(), run(20, 'd4d4d4d', { 'CASE-001': 'unexpectedPass', 'CASE-999': 'passed' }), []);
    if (!unexpected.ok) throw new Error(unexpected.problems.join('; '));
    expect(unexpected.view.runs).toEqual([expect.objectContaining({ passed: 0, failed: 1, missing: 0, other: 0 })]);
  });

  it('rejects history files for the same run attempt with different content', async () => {
    const result = buildRunHistory(await catalog(), run(20, 'd4d4d4d', {}), [run(19, 'c3c3c3c', { 'CASE-001': 'passed' }), run(19, 'c3c3c3c', { 'CASE-001': 'failed' })]);
    expect(result).toEqual({ ok: false, problems: ['history runs for run-19 attempt 1 have different content'] });
  });

  it('renders the trend, flaky cases, and failing streaks on the daily page', async () => {
    const fixtureCatalog = await catalog();
    const current = run(20, 'b2b2b2b', { 'CASE-001': 'failed' });
    const history = buildRunHistory(fixtureCatalog, current, [run(18, 'b2b2b2b', { 'CASE-001': 'passed' }), run(19, 'b2b2b2b', { 'CASE-001': 'failed' })]);
    const daily = buildDailyView(fixtureCatalog, current);
    if (!history.ok || !daily.ok) throw new Error('fixtures must build');
    const html = renderDailySite(daily.view, 'body{}', false, history.view).get('index.html') ?? '';
    expect(html).toContain('<h2>直近3回の推移</h2>');
    expect(html).toContain('<tr><th scope="row">2026-10-19T00:05:00Z</th><td><code>b2b2b2b</code></td><td>0</td><td>1</td><td>0</td><td>0</td></tr>');
    expect(html).toContain('<svg viewBox="0 0 84 160" style="width:min(100%,84px)" preserveAspectRatio="none" aria-hidden="true">');
    expect(html).toContain('不安定 2 / 3回');
    expect(html).toContain('2回連続で失敗');
    expect(renderDailySite(daily.view, 'body{}').get('index.html')).not.toContain('直近');
  });
});
