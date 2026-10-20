import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { buildReleaseDiff } from './release-diff.js';
import { createReleaseCatalogSnapshot } from './release-catalog.js';
import { renderReleaseSite } from './release-site.js';

describe('release difference site', () => {
  it('renders grouped catalog facts without claiming coverage or release readiness', async () => {
    const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const previous = { ...checked.catalog, cases: checked.catalog.cases.filter((item) => item.id !== 'CASE-101' && item.id !== 'CASE-110' && item.id !== 'CASE-111') };
    const diff = buildReleaseDiff({ production: createReleaseCatalogSnapshot(previous, '6e2b11a'), staging: { snapshot: createReleaseCatalogSnapshot(checked.catalog, '7f3a12c') } });
    if (!diff.ok) throw new Error('release diff must be valid');
    const html = renderReleaseSite(diff.view, 'body{}').get('release.html') ?? '';
    expect(html).toContain('production');
    expect(html).toContain('staging');
    expect(html).toContain('注文取消');
    expect(html).toContain('自動 · vitest');
    expect(html).toContain('手動確認');
    expect(html).toContain('<span class="label success">追加</span><span class="label warning">planned</span>');
    expect(html).not.toContain('必要なテストをすべて網羅');
    expect(html).not.toContain('リリース可能');
    expect(html).not.toContain('Issueにする');
  });

  it('shows each case layer and the previous layer when a case moved between layers', async () => {
    const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const moved = checked.catalog.cases.find((item) => item.source === 'vitest');
    if (!moved) throw new Error('fixture must contain a vitest case');
    const previous = { ...checked.catalog, cases: checked.catalog.cases.map((item) => item.id === moved.id ? { ...item, layer: 'integration' } : item) };
    const diff = buildReleaseDiff({ production: createReleaseCatalogSnapshot(previous, '6e2b11a'), staging: { snapshot: createReleaseCatalogSnapshot(checked.catalog, '7f3a12c') } });
    if (!diff.ok) throw new Error('release diff must be valid');
    const change = diff.view.groups.flatMap((group) => group.changes).find((item) => item.caseId === moved.id);
    expect(change).toEqual(expect.objectContaining({ kind: 'changed', layer: moved.layer, previousLayer: 'integration' }));
    const inventory = diff.view.groups.flatMap((group) => group.inventory);
    expect(inventory.find((item) => item.caseId === moved.id)).toEqual(expect.objectContaining({ change: 'changed', previousLayer: 'integration' }));
    expect(inventory.filter((item) => item.caseId !== moved.id).every((item) => item.previousLayer === undefined)).toBe(true);
    const removed = buildReleaseDiff({ production: createReleaseCatalogSnapshot(checked.catalog, '6e2b11a'), staging: { snapshot: createReleaseCatalogSnapshot({ ...checked.catalog, cases: checked.catalog.cases.filter((item) => item.id !== moved.id) }, '7f3a12c') } });
    if (!removed.ok) throw new Error('release diff must be valid');
    expect(removed.view.groups.flatMap((group) => group.changes).find((item) => item.caseId === moved.id)).toEqual(expect.objectContaining({ kind: 'removed', layer: moved.layer }));
    expect(removed.view.groups.flatMap((group) => group.changes).every((item) => item.previousLayer === undefined)).toBe(true);
    const html = renderReleaseSite(diff.view, 'body{}').get('release.html') ?? '';
    expect(html).toContain(`<code>${moved.id}</code> · integration → ${moved.layer} · 自動 · vitest`);
  });

  it('escapes catalog-controlled titles', async () => {
    const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
    if (!checked.ok) throw new Error('fixture catalog must be valid');
    const previous = createReleaseCatalogSnapshot({ ...checked.catalog, cases: checked.catalog.cases.filter((item) => item.id !== 'CASE-101') }, '6e2b11a');
    const staging = createReleaseCatalogSnapshot(checked.catalog, '7f3a12c');
    const tainted = { ...staging, cases: staging.cases.map((item) => item.id === 'CASE-101' ? { ...item, title: '<script>alert("x")</script> & case' } : item) };
    const diff = buildReleaseDiff({ production: previous, staging: { snapshot: tainted } });
    if (!diff.ok) throw new Error('release diff must be valid');
    const html = renderReleaseSite(diff.view, '').get('release.html') ?? '';
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; case');
    expect(html).not.toContain('<script>alert');
  });
});
