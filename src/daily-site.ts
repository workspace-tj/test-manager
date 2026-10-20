import type { DailyChange, DailyView } from './daily-view.js';
import { escapeHtml } from './html.js';
import { renderQualityPage } from './quality-page.js';
import type { RunHistoryView } from './run-history.js';

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

const percent = (value: number): string => `${Math.round(value * 1_000) / 10}%`;

const trendSegments = [
  ['passed', '成功'],
  ['failed', '失敗・想定外成功'],
  ['missing', '欠損'],
  ['other', 'skip・想定失敗'],
] as const;

const renderTrendChart = (history: RunHistoryView): string => {
  const height = 160;
  const barWidth = 24;
  const gap = 6;
  const width = Math.max(barWidth, history.runs.length * (barWidth + gap) - gap);
  const max = Math.max(1, ...history.runs.map((run) => trendSegments.reduce((total, [key]) => total + run[key], 0)));
  const bars = history.runs.map((run, index) => {
    const x = index * (barWidth + gap);
    let top = height;
    const rects = trendSegments.map(([key]) => {
      const size = (run[key] / max) * height;
      top -= size;
      return `<rect class="trend-${key}" x="${x}" y="${top}" width="${barWidth}" height="${size}"/>`;
    }).join('');
    return `<g aria-hidden="true">${rects}</g>`;
  }).join('');
  const rows = history.runs.map((run) => `<tr><th scope="row">${escapeHtml(run.completedAt)}</th><td><code>${escapeHtml(run.commit.slice(0, 7))}</code></td>${trendSegments.map(([key]) => `<td>${run[key]}</td>`).join('')}</tr>`).join('');
  const first = history.runs[0]?.completedAt.slice(0, 10) ?? '';
  const last = history.runs.at(-1)?.completedAt.slice(0, 10) ?? '';
  return `<figure class="trend-chart"><svg viewBox="0 0 ${width} ${height}" style="width:min(100%,${width}px)" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><figcaption>${trendSegments.map(([key, label]) => `<span class="legend trend-${key}">${label}</span>`).join('')}<span>${escapeHtml(first)} → ${escapeHtml(last)}</span></figcaption><details class="trend-table"><summary>回ごとの件数</summary><table><thead><tr><th scope="col">完了時刻</th><th scope="col">commit</th>${trendSegments.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></details></figure>`;
};

const renderHistory = (history: RunHistoryView): string => {
  const flaky = history.flaky.length > 0
    ? `<ul class="grouped-list change-list history-list">${history.flaky.map((item) => `<li><span class="status-dot attention" aria-hidden="true"></span><div class="row-copy"><h3>${escapeHtml(item.title)}</h3><p><code>${escapeHtml(item.caseId)}</code> · 成功率 ${percent(item.passRate)}</p></div><div class="row-detail"><span class="label warning">不安定 ${item.flakyRuns} / ${item.observedRuns}回</span></div></li>`).join('')}</ul>`
    : '<p class="empty-state">再試行で通った、または同じcommitで成否が分かれたケースはありません。</p>';
  const streaks = history.failingStreaks.length > 0
    ? `<ul class="grouped-list change-list history-list">${history.failingStreaks.map((item) => `<li><span class="status-dot danger" aria-hidden="true"></span><div class="row-copy"><h3>${escapeHtml(item.title)}</h3><p><code>${escapeHtml(item.caseId)}</code> · ${escapeHtml(item.since.slice(0, 10))}から</p></div><div class="row-detail"><span class="label danger">${item.streak}回連続で失敗</span></div></li>`).join('')}</ul>`
    : '<p class="empty-state">2回以上続けて失敗しているケースはありません。</p>';
  return `<section class="section history-section"><div class="section-heading"><div><h2>直近${history.runs.length}回の推移</h2><p>同じ環境・同じ実行範囲の日次実行（最大${history.window}回）</p></div></div>${renderTrendChart(history)}</section><section class="section"><div class="section-heading"><div><h2>不安定なケース</h2><p>再試行で通った回と、同じcommitの別の回では通ったのに失敗した回の合計</p></div><span class="section-meta">${history.flaky.length}件</span></div>${flaky}</section><section class="section"><div class="section-heading"><div><h2>失敗が続いているケース</h2><p>直近の結果から数えて2回以上続けて失敗</p></div><span class="section-meta">${history.failingStreaks.length}件</span></div>${streaks}</section>`;
};

const historyCss = '.history-list>li{grid-template-columns:14px minmax(0,1fr) auto}.status-dot.attention{background:var(--orange);box-shadow:0 0 0 4px var(--orange-soft)}.trend-chart{margin:0;padding:16px;background:white;border:1px solid #e4e7ec;border-radius:14px}.trend-chart svg{height:160px;display:block}.trend-passed{fill:#12b76a}.trend-failed{fill:#f04438}.trend-missing{fill:#f79009}.trend-other{fill:#98a2b3}.trend-chart figcaption{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px 16px;color:#667085;font-size:12px}.legend::before{content:"";width:10px;height:10px;margin-right:6px;display:inline-block;border-radius:2px}.legend.trend-passed::before{background:#12b76a}.legend.trend-failed::before{background:#f04438}.legend.trend-missing::before{background:#f79009}.legend.trend-other::before{background:#98a2b3}.trend-table{margin-top:12px;font-size:12px;color:#475467}.trend-table summary{cursor:pointer}.trend-table table{width:100%;margin-top:8px;border-collapse:collapse;display:block;overflow-x:auto}.trend-table th,.trend-table td{padding:4px 8px;border-top:1px solid #e4e7ec;text-align:left;white-space:nowrap}';

const dailyDomainCss = '.daily-domain-table .domain-table-head,.daily-domain-table .domain-row{grid-template-columns:minmax(140px,1.4fr) 82px minmax(90px,1fr) repeat(5,58px)}';

export const renderDailySite = (view: DailyView, stylesheet: string, integrated = false, history?: RunHistoryView): ReadonlyMap<string, string> => {
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
  const bodyHtml = `<div class="page-intro"><div><p class="eyebrow">${escapeHtml(view.run.completedAt)} · ${escapeHtml(view.run.environment)}</p><h1>${escapeHtml(view.run.environment)}の日次実行</h1><p>${intro}</p></div></div><section class="summary-surface"><div class="summary-icon attention" aria-hidden="true">!</div><div class="summary-copy"><p class="summary-label">今回の確認</p><h2>${headline}</h2><p>${observed} / ${planned}件の結果を取得しました。</p></div><div class="summary-meta"><a href="${escapeHtml(view.run.ciUrl)}">CI実行を確認 <span aria-hidden="true">↗</span></a></div></section><section class="section"><div class="section-heading"><div><h2>${sectionTitle}</h2><p>${sectionDescription}</p></div><span class="section-meta"><b class="text-danger">新規失敗 ${newFailures}</b><span>復旧 ${recovered}</span><span>結果欠損 ${missing}</span></span></div>${renderChanges(view)}</section><section class="section domain-section"><div class="section-heading"><div><h2>domainごとの現在地</h2><p>現在の失敗と欠損がどこにあるか</p></div><span class="section-meta">設定順</span></div><div class="domain-table daily-domain-table" role="table" data-order="configured"><div class="domain-table-head" role="row"><span role="columnheader">domain</span><span role="columnheader">結果</span><span role="columnheader">結果取得率</span><span role="columnheader">成功</span><span role="columnheader">失敗</span><span role="columnheader">想定失敗</span><span role="columnheader">想定外成功</span><span role="columnheader">欠損</span></div><div class="domain-list" role="rowgroup">${renderDomains(view)}</div></div></section>${history ? renderHistory(history) : ''}`;
  const html = renderQualityPage({ active: 'daily', title: `${view.run.environment}の日次実行`, bodyHtml, integrated });
  const baseCss = stylesheet.endsWith('\n') ? stylesheet : `${stylesheet}\n`;
  return new Map([['index.html', html], ['assets/dashboard.css', `${baseCss}${dailyDomainCss}\n${history ? `${historyCss}\n` : ''}`]]);
};
