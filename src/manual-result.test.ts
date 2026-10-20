import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { parseManualResultSet } from './manual-result.js';
import type { ManualResultSet } from './manual-result.js';
import { createReleaseCatalogSnapshot } from './release-catalog.js';
import { buildReleaseDiff } from './release-diff.js';
import { renderReleaseSite } from './release-site.js';

const idPattern = /^(?:[a-z][a-z0-9-]*|CASE-[0-9]{3})$/u;

const resultSet = (commit: string, results: ReadonlyArray<Readonly<{ caseId: string; executedAt: string; outcome?: string }>>, environment = 'staging'): ManualResultSet => {
  const parsed = parseManualResultSet({
    schemaVersion: 1, environment, commit, executedBy: 'qa-team',
    results: results.map((result) => ({ outcome: 'passed', ...result })),
  }, idPattern);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};

const fixture = async () => {
  const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
  if (!checked.ok) throw new Error('fixture catalog must be valid');
  const manualCase = checked.catalog.cases.find((item) => item.source === 'manual');
  const automatedCase = checked.catalog.cases.find((item) => item.source !== 'manual');
  if (!manualCase || !automatedCase) throw new Error('fixture must contain manual and automated cases');
  const previous = { ...checked.catalog, cases: checked.catalog.cases.filter((item) => item.id !== manualCase.id) };
  return {
    manualCase,
    automatedCase,
    catalog: checked.catalog,
    production: createReleaseCatalogSnapshot(previous, '6e2b11a'),
    staging: createReleaseCatalogSnapshot(checked.catalog, '7f3a12c'),
  };
};

const manualVerification = (diff: ReturnType<typeof buildReleaseDiff>, caseId: string) => {
  if (!diff.ok) throw new Error(diff.problems.join('; '));
  return diff.view.groups.flatMap((group) => group.inventory).find((item) => item.caseId === caseId)?.verification;
};

describe('manual result sets', () => {
  it('rejects duplicate cases, unknown outcomes, and non-HTTP evidence', () => {
    const base = { schemaVersion: 1, environment: 'staging', commit: '7f3a12c' };
    expect(parseManualResultSet({ ...base, results: [{ caseId: 'CASE-110', executedAt: '2026-10-20T10:00:00Z', outcome: 'passed' }, { caseId: 'CASE-110', executedAt: '2026-10-20T11:00:00Z', outcome: 'failed' }] }, idPattern).success).toBe(false);
    expect(parseManualResultSet({ ...base, results: [{ caseId: 'CASE-110', executedAt: '2026-10-20T10:00:00Z', outcome: 'skipped' }] }, idPattern).success).toBe(false);
    expect(parseManualResultSet({ ...base, results: [{ caseId: 'CASE-110', executedAt: '2026-10-20T10:00:00Z', outcome: 'passed', evidenceUrl: 'file:///tmp/a.png' }] }, idPattern).success).toBe(false);
  });

  it('reports the latest manual result and whether the case changed after it was executed', async () => {
    const { manualCase, catalog, production, staging } = await fixture();
    const older = createReleaseCatalogSnapshot({ ...catalog, cases: catalog.cases.map((item) => item.id === manualCase.id ? { ...item, title: `${item.title}（旧）` } : item) }, '5d1a00b');
    const unchanged = buildReleaseDiff({ production, staging: { snapshot: staging }, manual: { resultSets: [resultSet('7f3a12c', [{ caseId: manualCase.id, executedAt: '2026-10-20T10:00:00Z' }])], snapshots: [] } });
    expect(manualVerification(unchanged, manualCase.id)).toEqual({ kind: 'manual', latest: { kind: 'recorded', outcome: 'passed', commit: '7f3a12c', executedAt: '2026-10-20T10:00:00Z', executedBy: 'qa-team', changedSinceExecution: false } });

    const stale = buildReleaseDiff({
      production, staging: { snapshot: staging },
      manual: {
        resultSets: [
          resultSet('7f3a12c', [{ caseId: manualCase.id, executedAt: '2026-10-18T10:00:00Z', outcome: 'failed' }]),
          resultSet('5d1a00b', [{ caseId: manualCase.id, executedAt: '2026-10-19T10:00:00Z' }]),
        ],
        snapshots: [older],
      },
    });
    expect(manualVerification(stale, manualCase.id)).toEqual(expect.objectContaining({ latest: expect.objectContaining({ commit: '5d1a00b', outcome: 'passed', changedSinceExecution: true }) }));
    if (!stale.ok) return;
    const html = renderReleaseSite(stale.view, 'body{}').get('release.html') ?? '';
    expect(html).toContain('手動 · passed · 5d1a00b · 2026-10-19 · qa-team');
    expect(html).toContain('<span class="label warning">確認後に変更あり</span>');
  });

  it('distinguishes manual cases without a result from a release built without manual input', async () => {
    const { manualCase, automatedCase, production, staging } = await fixture();
    const recordedOther = buildReleaseDiff({ production, staging: { snapshot: staging }, manual: { resultSets: [], snapshots: [] } });
    expect(manualVerification(recordedOther, manualCase.id)).toEqual({ kind: 'manual', latest: { kind: 'notRecorded' } });
    expect(automatedCase.source).not.toBe('manual');
  });

  it('accepts production results by unique commit prefix and marks removed cases as not applicable', async () => {
    const { manualCase, catalog, staging } = await fixture();
    const production = createReleaseCatalogSnapshot(catalog, '6e2b11a0c4d5');
    const removedStaging = createReleaseCatalogSnapshot({ ...catalog, cases: catalog.cases.filter((item) => item.id !== manualCase.id) }, '7f3a12c');
    const recorded = buildReleaseDiff({ production, staging: { snapshot: staging }, manual: { resultSets: [resultSet('6e2b11a', [{ caseId: manualCase.id, executedAt: '2026-10-20T10:00:00Z' }])], snapshots: [] } });
    if (!recorded.ok) throw new Error(recorded.problems.join('; '));
    const removed = buildReleaseDiff({ production, staging: { snapshot: removedStaging }, manual: { resultSets: [resultSet('6e2b11a', [{ caseId: manualCase.id, executedAt: '2026-10-20T10:00:00Z' }])], snapshots: [] } });
    if (!removed.ok) throw new Error(removed.problems.join('; '));
    expect(removed.view.groups.flatMap((group) => group.changes).find((item) => item.caseId === manualCase.id)).toEqual(expect.objectContaining({ kind: 'removed', verification: { kind: 'manual', latest: { kind: 'notApplicable' } } }));
  });

  it('rejects manual results that cannot be tied to a staging manual case at their commit', async () => {
    const { manualCase, automatedCase, production, staging } = await fixture();
    const problems = (resultSets: ReadonlyArray<ManualResultSet>) => {
      const diff = buildReleaseDiff({ production, staging: { snapshot: staging }, manual: { resultSets, snapshots: [] } });
      return diff.ok ? [] : diff.problems;
    };
    expect(problems([resultSet('5d1a00b', [{ caseId: manualCase.id, executedAt: '2026-10-20T10:00:00Z' }])])).toEqual(['manual result set for 5d1a00b has no catalog snapshot for that commit']);
    expect(problems([resultSet('7f3a12c', [{ caseId: manualCase.id, executedAt: '2026-10-20T10:00:00Z' }], 'dev')])).toEqual(['manual result set for 7f3a12c must use the staging environment']);
    expect(problems([resultSet('7f3a12c', [{ caseId: automatedCase.id, executedAt: '2026-10-20T10:00:00Z' }])])).toEqual([`manual result for ${automatedCase.id} targets a ${automatedCase.source} case at 7f3a12c`]);
    expect(problems([resultSet('7f3a12c', [{ caseId: 'CASE-999', executedAt: '2026-10-20T10:00:00Z' }])])).toEqual(['manual result for CASE-999 does not exist in the catalog at 7f3a12c']);
    expect(problems([
      resultSet('7f3a12c', [{ caseId: manualCase.id, executedAt: '2026-10-20T10:00:00Z', outcome: 'passed' }]),
      resultSet('7f3a12c', [{ caseId: manualCase.id, executedAt: '2026-10-20T19:00:00+09:00', outcome: 'failed' }]),
    ])).toEqual([`manual results for ${manualCase.id} at 2026-10-20T19:00:00+09:00 disagree`]);
    const conflicting = { ...staging, cases: staging.cases.map((item) => item.id === manualCase.id ? { ...item, title: 'other' } : item) };
    const diff = buildReleaseDiff({ production, staging: { snapshot: staging }, manual: { resultSets: [], snapshots: [conflicting] } });
    expect(diff.ok ? [] : diff.problems).toEqual(['catalog snapshots for 7f3a12c have different content']);
  });
});
