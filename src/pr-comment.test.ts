import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { prCommentMarker, renderPrComment } from './pr-comment.js';
import { createReleaseCatalogSnapshot } from './release-catalog.js';
import { buildReleaseDiff } from './release-diff.js';

const fixture = async () => {
  const checked = await checkProject(path.resolve('fixtures/quality-dashboard/test-manager.yaml'));
  if (!checked.ok) throw new Error('fixture catalog must be valid');
  return checked.catalog;
};

describe('pull request comment', () => {
  it('lists added, changed, and removed cases by group with counts and a stable marker', async () => {
    const catalog = await fixture();
    const [first, second, third] = catalog.cases;
    if (!first || !second || !third) throw new Error('fixture must contain cases');
    const base = createReleaseCatalogSnapshot({ ...catalog, cases: catalog.cases.filter((item) => item.id !== first.id).map((item) => item.id === second.id ? { ...item, layer: 'integration' } : item) }, '6e2b11a');
    const head = createReleaseCatalogSnapshot({ ...catalog, cases: catalog.cases.filter((item) => item.id !== third.id) }, '7f3a12c');
    const diff = buildReleaseDiff({ production: base, staging: { snapshot: head } });
    if (!diff.ok) throw new Error(diff.problems.join('; '));
    const comment = renderPrComment(diff.view);
    expect(comment.startsWith(`${prCommentMarker}\n### test-manager: ケースの変更\n`)).toBe(true);
    expect(comment).toContain('base `6e2b11a` → head `7f3a12c` · 追加 1 · 変更 1 · 削除 1');
    expect(comment).toContain(`- 追加 \`${first.id}\``);
    expect(comment).toContain(`- 変更 \`${second.id}\``);
    expect(comment).toContain(`· integration → ${second.layer}`);
    expect(comment).toContain(`- 削除 \`${third.id}\``);
    expect(comment).toContain('網羅性やマージ可否は判定しません。');
  });

  it('shows how each case field changed, with project labels and document titles', async () => {
    const catalog = await fixture();
    const [first] = catalog.cases;
    if (!first) throw new Error('fixture must contain a case');
    const otherDocument = catalog.documents.find((document) => document.id !== first.fields.belongsTo && document.parent !== undefined) ?? catalog.documents.find((document) => document.id !== first.fields.belongsTo);
    if (!otherDocument) throw new Error('fixture must contain another document');
    const labelled = {
      ...catalog,
      rules: { ...catalog.rules, case: { fields: { ...catalog.rules.case.fields, impact: { required: true as const, placement: 'classification' as const, type: 'integer-enum' as const, label: '影響度', values: { 1: { label: '限定的', description: 'a' }, 2: { label: '主要操作', description: 'b' }, 3: { label: '主要目的', description: 'c' } } } } } },
    };
    const before = { ...first, fields: { ...first.fields, impact: 3 }, details: { ...first.details, reason: 'old' } } as typeof first;
    const after = { ...first, fields: { ...first.fields, belongsTo: otherDocument.id, impact: 1 }, details: { ...first.details } } as typeof first;
    const base = createReleaseCatalogSnapshot({ ...labelled, cases: [before] }, '6e2b11a');
    const head = createReleaseCatalogSnapshot({ ...labelled, cases: [after] }, '7f3a12c');
    const diff = buildReleaseDiff({ production: base, staging: { snapshot: head } });
    if (!diff.ok) throw new Error(diff.problems.join('; '));
    const membership = catalog.documents.find((document) => document.id === first.fields.belongsTo);
    const comment = renderPrComment(diff.view);
    expect(comment).toContain(`\n  - belongsTo: ${membership?.title} → ${otherDocument.title}、影響度: 主要目的 → 限定的、reason: old → なし`);
  });

  it('stays under the GitHub comment limit by omitting the remaining rows', async () => {
    const catalog = await fixture();
    const template = catalog.cases[0];
    if (!template) throw new Error('fixture must contain cases');
    const many = Array.from({ length: 2_000 }, (_, index) => ({ ...template, id: `CASE-${String(index).padStart(4, '0')}` as typeof template.id, title: 'x'.repeat(40) }));
    const base = createReleaseCatalogSnapshot({ ...catalog, idPattern: '^CASE-[0-9]{4}$', cases: [] } as typeof catalog, '6e2b11a');
    const head = createReleaseCatalogSnapshot({ ...catalog, cases: many }, '7f3a12c');
    const diff = buildReleaseDiff({ production: { ...base, documents: head.documents }, staging: { snapshot: head } });
    if (!diff.ok) throw new Error(diff.problems.join('; '));
    const comment = renderPrComment(diff.view);
    expect(comment.length).toBeLessThan(65_536);
    expect(comment).toMatch(/ほか\d+件の変更は、コメントの長さの上限のため省略しました。/u);
    expect(comment).toContain('追加 2000');
  });

  it('escapes Markdown and HTML in catalog text and reports when nothing changed', async () => {
    const catalog = await fixture();
    const [first] = catalog.cases;
    if (!first) throw new Error('fixture must contain cases');
    const base = createReleaseCatalogSnapshot(catalog, '6e2b11a');
    const head = createReleaseCatalogSnapshot({ ...catalog, cases: catalog.cases.map((item) => item.id === first.id ? { ...item, title: '<img src=x> | **bold** [link](http://x) &amp; @team\n# heading' } : item) }, '7f3a12c');
    const diff = buildReleaseDiff({ production: base, staging: { snapshot: head } });
    if (!diff.ok) throw new Error(diff.problems.join('; '));
    expect(renderPrComment(diff.view)).toContain('\\<img src=x\\> \\| \\*\\*bold\\*\\* \\[link\\](http://x) \\&amp; @\u2060team \\# heading');
    const unchanged = buildReleaseDiff({ production: base, staging: { snapshot: createReleaseCatalogSnapshot(catalog, '7f3a12c') } });
    if (!unchanged.ok) throw new Error(unchanged.problems.join('; '));
    expect(renderPrComment(unchanged.view)).toContain('ケースの追加・変更・削除はありません。');
  });
});
