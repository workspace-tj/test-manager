import type { ReleaseCaseChange, ReleaseDiffView } from './release-diff.js';
import { escapeHtml } from './html.js';

const changeLabel: Readonly<Record<ReleaseCaseChange['kind'], string>> = { added: '追加', changed: '変更', removed: '削除' };
const changeClass: Readonly<Record<ReleaseCaseChange['kind'], string>> = { added: 'success', changed: 'warning', removed: 'neutral' };
const resultLabel = (verification: ReleaseCaseChange['verification']): string => {
  if (verification.kind === 'manual') return '手動確認';
  const latest = verification.latest;
  if (latest.kind === 'observed') return `自動 · ${verification.source} · ${latest.status}`;
  const suffix: Readonly<Record<Exclude<typeof latest.kind, 'observed'>, string>> = {
    notProvided: '最新結果なし', notInRun: '今回対象外', missing: '結果欠損', notApplicable: '削除済み',
  };
  return `自動 · ${verification.source} · ${suffix[latest.kind]}`;
};

const renderGroup = (group: ReleaseDiffView['groups'][number]): string => {
  const path = group.featureId ? `${group.domainId} / ${group.featureId}` : group.domainId;
  const title = group.featureTitle ?? group.domainTitle;
  const count = (kind: ReleaseCaseChange['kind']): number => group.changes.filter((change) => change.kind === kind).length;
  const currentRows = group.inventory.map((item) => {
    const label = item.change === 'unchanged' ? '既存' : changeLabel[item.change];
    const labelClass = item.change === 'unchanged' ? 'neutral' : changeClass[item.change];
    return `<li><div class="row-copy"><h3>${escapeHtml(item.title)}</h3><p><code>${escapeHtml(item.caseId)}</code> · ${escapeHtml(resultLabel(item.verification))}</p></div><div class="row-detail"><span class="label ${labelClass}">${label}</span>${item.definition === 'todo' ? '<span class="label warning">planned</span>' : ''}</div></li>`;
  }).join('');
  const removedRows = group.changes.filter((change) => change.kind === 'removed').map((change) => `<li><div class="row-copy"><h3>${escapeHtml(change.title)}</h3><p><code>${escapeHtml(change.caseId)}</code> · ${escapeHtml(resultLabel(change.verification))}</p></div><div class="row-detail"><span class="label neutral">削除</span></div></li>`).join('');
  return `<article class="feature-card"><div class="feature-card-header"><div><p class="feature-path">${escapeHtml(path)}</p><h2>${escapeHtml(title)}</h2></div><dl class="compact-stats"><div><dt>追加</dt><dd>${count('added')}</dd></div><div><dt>変更</dt><dd>${count('changed')}</dd></div><div><dt>削除</dt><dd>${count('removed')}</dd></div></dl></div><ul class="grouped-list case-list">${currentRows}${removedRows}</ul></article>`;
};

export const renderReleaseSite = (view: ReleaseDiffView, stylesheet: string): ReadonlyMap<string, string> => {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>リリース差分 · Test Manager</title><link rel="stylesheet" href="assets/dashboard.css"></head><body><header class="app-header"><div class="header-inner"><a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">✓</span><span>Test Manager</span></a><nav class="segmented-nav" aria-label="主要ナビゲーション"><a href="index.html">日次実行</a><a href="release.html" aria-current="page">リリース差分</a><a href="catalog.html">ケース探索</a></nav></div></header><main><div class="page-intro"><div><p class="eyebrow">リリース前の確認材料</p><h1>前回productionからの変更</h1><p>登録済みのケースと確認手段を示します。網羅性やリリース判断を代行しません。</p></div></div><section class="comparison-surface" aria-label="比較するリリース"><div><span>比較元</span><strong>production</strong><small><code>${escapeHtml(view.productionCommit)}</code></small></div><span class="comparison-arrow" aria-hidden="true">→</span><div><span>比較先</span><strong>staging</strong><small><code>${escapeHtml(view.stagingCommit)}</code></small></div></section><section class="section"><div class="section-heading"><div><h2>ケース差分</h2><p>catalogの意味的な差分をdomain・featureごとに表示</p></div><span class="section-meta">${view.groups.length} groups</span></div>${view.groups.length > 0 ? view.groups.map(renderGroup).join('') : '<p class="empty-state">ケースの追加・変更・削除はありません。</p>'}</section></main></body></html>\n`;
  const css = stylesheet.endsWith('\n') ? stylesheet : `${stylesheet}\n`;
  return new Map([['release.html', html], ['assets/dashboard.css', css]]);
};
