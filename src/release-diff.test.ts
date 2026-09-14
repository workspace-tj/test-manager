import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { createReleaseCatalogSnapshot, parseReleaseCatalogSnapshot } from './release-catalog.js';
import { parseTestRun } from './test-run.js';
import { buildReleaseDiff } from './release-diff.js';

describe('release catalog difference', () => {
  it('groups added, changed, and removed cases by domain and feature with automated/manual evidence', async () => {
    const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const case102 = checked.catalog.cases.find((item) => item.id === 'CASE-102');
    const case109 = checked.catalog.cases.find((item) => item.id === 'CASE-109');
    if (!case102 || !case109) throw new Error('fixture cases must exist');
    const previous = {
      ...checked.catalog,
      cases: checked.catalog.cases
        .filter((item) => item.id !== 'CASE-101' && item.id !== 'CASE-110')
        .map((item) => item.id === 'CASE-102' ? { ...item, title: '以前の出荷済み取消ケース' } : item),
    };
    const current = {
      ...checked.catalog,
      cases: checked.catalog.cases.filter((item) => item.id !== 'CASE-109'),
    };

    const result = buildReleaseDiff({ production: createReleaseCatalogSnapshot(previous, '6e2b11a'), staging: { snapshot: createReleaseCatalogSnapshot(current, '7f3a12c') } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = result.view.groups.flatMap((group) => group.changes);
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'added', caseId: 'CASE-101', verification: { kind: 'automated', source: 'vitest', latest: { kind: 'notProvided' } } }),
      expect.objectContaining({ kind: 'changed', caseId: 'CASE-102' }),
      expect.objectContaining({ kind: 'removed', caseId: 'CASE-109' }),
      expect.objectContaining({ kind: 'added', caseId: 'CASE-110', verification: { kind: 'manual' } }),
    ]));
    expect(result.view.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ domainId: 'orders', featureId: 'order-cancellation' }),
      expect.objectContaining({ domainId: 'billing', featureId: 'invoicing' }),
    ]));
    const billing = result.view.groups.find((group) => group.featureId === 'invoicing');
    expect(billing?.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: 'CASE-104', change: 'unchanged', verification: expect.objectContaining({ kind: 'automated' }) }),
      expect.objectContaining({ caseId: 'CASE-111', definition: 'todo', change: 'unchanged' }),
      expect.objectContaining({ caseId: 'CASE-110', verification: { kind: 'manual' } }),
    ]));
  });

  it('uses semantic case content rather than location or snippet as the changed-case boundary', async () => {
    const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const relocated = { ...checked.catalog, cases: checked.catalog.cases.map((item) => ({ ...item, location: { ...item.location, line: item.location.line + 10 }, snippet: `reformatted ${item.snippet}` })) };
    const result = buildReleaseDiff({ production: createReleaseCatalogSnapshot(checked.catalog, '6e2b11a'), staging: { snapshot: createReleaseCatalogSnapshot(relocated, '7f3a12c') } });
    expect(result.ok && result.view.groups).toEqual([]);
  });

  it('rejects invalid or identical release commits', async () => {
    const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    expect(parseReleaseCatalogSnapshot({ ...createReleaseCatalogSnapshot(checked.catalog, '6e2b11a'), commit: '../main' }).success).toBe(false);
    const snapshot = createReleaseCatalogSnapshot(checked.catalog, '7f3a12c');
    expect(buildReleaseDiff({ production: snapshot, staging: { snapshot } }).ok).toBe(false);
    const base = createReleaseCatalogSnapshot(checked.catalog, '6e2b11a');
    const missingParent = { ...base, documents: base.documents.map((document) => document.id === 'invoicing' ? { ...document, parent: 'missing' } : document) };
    expect(parseReleaseCatalogSnapshot(missingParent).success).toBe(false);
    const cyclic = { ...base, documents: base.documents.map((document) => document.id === 'orders' ? { ...document, parent: 'order-cancellation' } : document) };
    expect(parseReleaseCatalogSnapshot(cyclic).success).toBe(false);
    const collision = { ...base, cases: base.cases.map((item, index) => index === 0 ? { ...item, id: 'orders' } : item) };
    expect(parseReleaseCatalogSnapshot(collision).success).toBe(false);
  });

  it('rejects unknown cases and runner/source mismatches in the declared latest staging run', async () => {
    const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const staging = createReleaseCatalogSnapshot(checked.catalog, '7f3a12c');
    const runFor = (runner: 'vitest' | 'playwright', caseId: string) => parseTestRun({
      schemaVersion: 1, runId: 'latest', attempt: 1, environment: 'staging', commit: '7f3a12c', scopeId: 'release',
      startedAt: '2026-09-13T00:00:00Z', completedAt: '2026-09-13T00:01:00Z', ciUrl: 'https://example.com/run',
      units: [{ state: 'incomplete', reason: 'runnerError', unitId: 'unit', runner, layer: 'E2E', target: 'node', plannedCaseIds: [caseId], observations: [] }],
    }, /^(?:[a-z][a-z0-9-]*|CASE-[0-9]{3})$/u);
    const mismatch = runFor('playwright', 'CASE-101');
    const unknown = runFor('vitest', 'CASE-999');
    if (!mismatch.success || !unknown.success) throw new Error('run fixture must parse');
    expect(buildReleaseDiff({ production: createReleaseCatalogSnapshot(checked.catalog, '6e2b11a'), staging: { snapshot: staging, latestRun: mismatch.data } }).ok).toBe(false);
    expect(buildReleaseDiff({ production: createReleaseCatalogSnapshot(checked.catalog, '6e2b11a'), staging: { snapshot: staging, latestRun: unknown.data } }).ok).toBe(false);
  });
});
