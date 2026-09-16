import type { DailyChange, DailyView } from './daily-view.js';
import { escapeHtml } from './html.js';
import { renderQualityPage } from './quality-page.js';

const changeLabel: Readonly<Record<DailyChange['kind'], string>> = {
  newFailure: '新規失敗',
  recovered: '復旧',
  resultMissing: '結果欠損',
};

const changeClass: Readonly<Record<DailyChange['kind'], string>> = {
  newFailure: 'danger',
  recovered: 'success',
  resultMissing: 'warning',
};

const countChanges = (view: DailyView, kind: DailyChange['kind']): number => view.changes.filter((change) => change.kind === kind).length;

const comparisonText: Readonly<Record<Extract<DailyView['comparison'], { state: 'unavailable' }>['reason'], string>> = {
  noPrevious: '比較できる前回実行がありません',
  differentEnvironment: '同じ環境の前回実行がないため比較できません',
  differentScope: '同じ実行範囲の前回実行がないため比較できません',
  previousIsNewer: '指定された前回実行が今回より新しいため比較できません',
};

const renderChanges = (view: DailyView): string => {
  if (view.changes.length > 0) return `<ul class="grouped-list change-list">${view.changes.map((change) => `<li><span class="status-dot ${changeClass[change.kind]}" aria-hidden="true"></span><div class="row-copy"><h3>${escapeHtml(change.title)}</h3><p><code>${escapeHtml(change.caseId)}</code> · ${escapeHtml(change.domainId)}</p></div><div class="row-detail"><span class="label ${changeClass[change.kind]}">${changeLabel[change.kind]}</span></div></li>`).join('')}</ul>`;
  const message = view.comparison.state === 'available' ? '前回から状態が変わったケースはありません。' : comparisonText[view.comparison.reason];
  return `<p class="empty-state">${message}</p>`;
};

const renderDomains = (view: DailyView): string => view.domains.map((domain) => {
  const observed = domain.planned - domain.missing;
  const acquisitionRate = domain.planned === 0 ? undefined : Math.round((observed / domain.planned) * 1_000) / 10;
  const acquisitionLabel = acquisitionRate === undefined ? '対象ケースなし' : `結果取得率${acquisitionRate}%`;
  const progressValue = acquisitionRate === undefined ? '' : ` aria-valuenow="${acquisitionRate}"`;
  return `<div class="domain-row" role="row"><strong role="rowheader">${escapeHtml(domain.title)}</strong><span role="cell" class="result-count">${observed} / ${domain.planned}</span><div role="cell"><div class="progress" role="progressbar" aria-label="${acquisitionLabel}" aria-valuemin="0" aria-valuemax="100"${progressValue}><span style="width:${acquisitionRate ?? 0}%"></span></div></div><span role="cell" class="metric">${domain.passed}</span><span role="cell" class="metric text-danger">${domain.failed}</span><span role="cell" class="metric text-warning">${domain.expectedFailure}</span><span role="cell" class="metric text-danger">${domain.unexpectedPass}</span><span role="cell" class="metric text-warning">${domain.missing}</span></div>`;
}).join('');

const dailyDomainCss = '.daily-domain-table .domain-table-head,.daily-domain-table .domain-row{grid-template-columns:minmax(140px,1.4fr) 82px minmax(90px,1fr) repeat(5,58px)}';

export const renderDailySite = (view: DailyView, stylesheet: string, integrated = false): ReadonlyMap<string, string> => {
  const newFailures = countChanges(view, 'newFailure');
  const recovered = countChanges(view, 'recovered');
  const missing = view.domains.reduce((total, domain) => total + domain.missing, 0);
  const planned = view.domains.reduce((total, domain) => total + domain.planned, 0);
  const observed = planned - missing;
  const hasComparison = view.comparison.state === 'available';
  const headline = missing > 0
    ? `${missing}件の結果が欠損しています`
    : hasComparison
      ? view.changes.length > 0 ? `状態が変わったケースが${view.changes.length}件あります` : '前回から状態の変化はありません'
      : comparisonText[view.comparison.reason];
  const intro = hasComparison ? '同じ環境・同じ実行範囲の前回結果と比較します。' : comparisonText[view.comparison.reason];
  const sectionTitle = hasComparison ? '前回からの変化' : '今回の確認事項';
  const sectionDescription = hasComparison ? '比較可能な前回実行から状態が変わったケース' : '前回比較を使わず、今回の結果だけを表示します';
  const bodyHtml = `<div class="page-intro"><div><p class="eyebrow">${escapeHtml(view.run.completedAt)} · ${escapeHtml(view.run.environment)}</p><h1>${escapeHtml(view.run.environment)}の日次実行</h1><p>${intro}</p></div></div><section class="summary-surface"><div class="summary-icon attention" aria-hidden="true">!</div><div class="summary-copy"><p class="summary-label">今回の確認</p><h2>${headline}</h2><p>${observed} / ${planned}件の結果を取得しました。</p></div><div class="summary-meta"><a href="${escapeHtml(view.run.ciUrl)}">CI実行を確認 <span aria-hidden="true">↗</span></a></div></section><section class="section"><div class="section-heading"><div><h2>${sectionTitle}</h2><p>${sectionDescription}</p></div><span class="section-meta"><b class="text-danger">新規失敗 ${newFailures}</b><span>復旧 ${recovered}</span><span>結果欠損 ${missing}</span></span></div>${renderChanges(view)}</section><section class="section domain-section"><div class="section-heading"><div><h2>domainごとの現在地</h2><p>現在の失敗と欠損がどこにあるか</p></div><span class="section-meta">設定順</span></div><div class="domain-table daily-domain-table" role="table" data-order="configured"><div class="domain-table-head" role="row"><span role="columnheader">domain</span><span role="columnheader">結果</span><span role="columnheader">結果取得率</span><span role="columnheader">成功</span><span role="columnheader">失敗</span><span role="columnheader">想定失敗</span><span role="columnheader">想定外成功</span><span role="columnheader">欠損</span></div><div class="domain-list" role="rowgroup">${renderDomains(view)}</div></div></section>`;
  const html = renderQualityPage({ active: 'daily', title: `${view.run.environment}の日次実行`, bodyHtml, integrated });
  const baseCss = stylesheet.endsWith('\n') ? stylesheet : `${stylesheet}\n`;
  return new Map([['index.html', html], ['assets/dashboard.css', `${baseCss}${dailyDomainCss}\n`]]);
};
