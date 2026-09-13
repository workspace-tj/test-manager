import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { buildDailyView } from './daily-view.js';
import { parseTestRun } from './test-run.js';
import type { TestRun } from './test-run.js';

const attempt = (outcome: 'passed' | 'failed') => ({ outcome, durationMs: 10, startedAt: '2026-09-13T00:00:01Z', artifactRefs: [] });

const run = (
  runId: string,
  observations: ReadonlyArray<Readonly<{ caseId: string; outcome: 'passed' | 'failed' }>>,
  incomplete: ReadonlyArray<string> = [],
  environment = 'dev',
): TestRun => {
  const parsed = parseTestRun({
    schemaVersion: 1,
    runId,
    attempt: 1,
    environment,
    commit: runId === 'current' ? '7f3a12c' : '6e2b11a',
    scopeId: 'daily-all',
    startedAt: '2026-09-13T00:00:00Z',
    completedAt: '2026-09-13T00:01:00Z',
    ciUrl: `https://example.com/${runId}`,
    units: [
      {
        state: 'completed', unitId: 'vitest-unit', runner: 'vitest', layer: 'unit', target: 'node',
        plannedCaseIds: observations.map((item) => item.caseId),
        observations: observations.map((item) => ({ caseId: item.caseId, expected: 'passed', attemptCoverage: { kind: 'complete' }, attempts: [attempt(item.outcome)] })),
      },
      ...(incomplete.length === 0 ? [] : [{
        state: 'incomplete' as const, unitId: 'playwright-e2e', runner: 'playwright' as const, layer: 'E2E', target: 'chromium', reason: 'runnerError' as const,
        plannedCaseIds: incomplete, observations: [],
      }]),
    ],
  }, /^(?:CASE-[0-9]{3})$/u);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};

describe('daily view', () => {
  it('derives changes and fixed domain positions from catalog and two compatible runs', async () => {
    const catalog = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!catalog.ok) throw new Error('fixture must be valid');
    const current = run('current', [{ caseId: 'CASE-001', outcome: 'failed' }, { caseId: 'CASE-002', outcome: 'passed' }], ['CASE-201']);
    const previous = run('previous', [{ caseId: 'CASE-001', outcome: 'passed' }, { caseId: 'CASE-002', outcome: 'failed' }, { caseId: 'CASE-201', outcome: 'passed' }]);

    const result = buildDailyView(catalog.catalog, current, previous);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.comparison).toEqual({ state: 'available', previousRunId: previous.runId });
    expect(result.view.changes.map((change) => [change.caseId, change.kind])).toEqual([
      ['CASE-001', 'newFailure'],
      ['CASE-002', 'recovered'],
      ['CASE-201', 'resultMissing'],
    ]);
    expect(result.view.domains.map((domain) => domain.id)).toEqual(['orders', 'catalog']);
    expect(result.view.domains[0]).toMatchObject({ planned: 3, passed: 1, failed: 1, missing: 1 });
  });

  it('does not compare runs from a different environment or scope', async () => {
    const catalog = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!catalog.ok) throw new Error('fixture must be valid');
    const current = run('current', [{ caseId: 'CASE-001', outcome: 'passed' }]);
    const previous = run('previous', [{ caseId: 'CASE-001', outcome: 'failed' }], [], 'staging');
    const result = buildDailyView(catalog.catalog, current, previous);
    expect(result.ok && result.view.comparison).toEqual({ state: 'unavailable', reason: 'differentEnvironment' });
  });

  it('rejects run cases that do not exist in the catalog', async () => {
    const catalog = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!catalog.ok) throw new Error('fixture must be valid');
    const result = buildDailyView(catalog.catalog, run('current', [{ caseId: 'CASE-999', outcome: 'passed' }]));
    expect(result).toEqual({ ok: false, problems: [{ kind: 'unknownCase', caseId: 'CASE-999' }] });
  });

  it('rejects a run unit whose runner does not match the catalog source', async () => {
    const catalog = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!catalog.ok) throw new Error('fixture must be valid');
    const result = buildDailyView(catalog.catalog, run('current', [], ['CASE-001']));
    expect(result).toEqual({
      ok: false,
      problems: [{ kind: 'runnerMismatch', caseId: 'CASE-001', runner: 'playwright', source: 'vitest' }],
    });
  });

  it('does not call a failure new when there is no comparable previous observation', async () => {
    const catalog = await checkProject(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!catalog.ok) throw new Error('fixture must be valid');
    const result = buildDailyView(catalog.catalog, run('current', [{ caseId: 'CASE-001', outcome: 'failed' }]));
    expect(result.ok && result.view.changes).toEqual([]);
  });
});
