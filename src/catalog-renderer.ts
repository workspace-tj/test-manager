import { catalogSearchScript, catalogStyles } from './catalog-assets.js';
import { renderMarkdown } from './markdown.js';
import { sortDocumentsForDisplay } from './documents.js';
import type { Catalog, KnowledgeDocument, ManagedCase } from './model.js';
import { escapeHtml, renderAppHeader, renderHtmlDocument } from './html.js';
import { renderBreakdowns } from './breakdowns.js';
import { renderDashboardNavigation } from './dashboard-navigation.js';
const safeName = (value: string): string => encodeURIComponent(value);
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const pretty = (value: unknown): string => escapeHtml(JSON.stringify(value, null, 2));

type Section = 'catalog' | 'cases' | 'documents';

const renderLayout = (title: string, section: Section, rootPrefix: string, body: string, integrated: boolean): string => {
  const navigation = integrated
    ? renderDashboardNavigation({ active: 'catalog', rootPrefix: `${rootPrefix}../` })
    : `<nav class="segmented-nav" aria-label="カタログナビゲーション">${(['catalog', 'cases', 'documents'] as const).map((item) => `<a href="${rootPrefix}${item === 'catalog' ? 'index.html' : `${item}/index.html`}"${section === item ? ' aria-current="page"' : ''}>${item === 'catalog' ? 'ドメイン' : item === 'cases' ? 'ケース検索' : '仕様・判断'}</a>`).join('')}</nav>`;
  return renderHtmlDocument({
    title,
    stylesheetHref: `${rootPrefix}assets/style.css`,
    headerHtml: renderAppHeader({ homeHref: integrated ? `${rootPrefix}../index.html` : `${rootPrefix}index.html`, navigationHtml: navigation, spacer: true }),
    bodyHtml: body,
  });
};

const breadcrumbs = (document: KnowledgeDocument, byId: ReadonlyMap<string, KnowledgeDocument>): ReadonlyArray<KnowledgeDocument> => {
  const result = [document];
  let current = document;
  while (current.parent) {
    const parent = byId.get(current.parent);
    if (!parent) break;
    result.unshift(parent);
    current = parent;
  }
  return result;
};

// Each tables can be long; the case list puts every case on one page, so only the start of a table is searchable there.
const searchTableLimit = 2000;

export const renderCatalogSite = (catalog: Catalog, integrated = false): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  const layout = (title: string, section: Section, rootPrefix: string, body: string): string => renderLayout(title, section, rootPrefix, body, integrated);
  const documents = sortDocumentsForDisplay(catalog.documents, catalog.rules);
  const cases = [...catalog.cases].sort((left, right) => compareText(left.id, right.id));
  const byId = new Map(documents.map((document) => [document.id, document]));
  const pathOf = (document: KnowledgeDocument): ReadonlyArray<KnowledgeDocument> => breadcrumbs(document, byId);
  const casesByAncestor = new Map<string, ManagedCase[]>();
  for (const item of cases) {
    const membership = byId.get(item.fields.belongsTo);
    for (const ancestor of membership ? pathOf(membership) : []) casesByAncestor.set(ancestor.id, [...(casesByAncestor.get(ancestor.id) ?? []), item]);
  }
  const casesBelow = (document: KnowledgeDocument): ReadonlyArray<ManagedCase> => casesByAncestor.get(document.id) ?? [];
  const rootOf = (document: KnowledgeDocument): KnowledgeDocument => pathOf(document)[0] ?? document;
  const domainOf = (item: ManagedCase): KnowledgeDocument | undefined => {
    const membership = byId.get(item.fields.belongsTo);
    return membership ? rootOf(membership) : undefined;
  };
  const linkDocument = (document: KnowledgeDocument): string => `<a href="../documents/${safeName(document.id)}.html">${escapeHtml(document.title)}</a>`;
  const linkCase = (item: ManagedCase): string => `<a href="../cases/${safeName(item.id)}.html">${escapeHtml(item.title)}</a>`;
  const domains = documents.filter((document) => document.parent === undefined);
  const layers = catalog.rules.discovery.layers.map((layer) => layer.name);
  const describedLayers = catalog.rules.discovery.layers.filter((layer) => layer.description !== undefined);
  const layerSection = describedLayers.length > 0
    ? `<section class="layer-definitions" aria-labelledby="layer-heading"><h2 id="layer-heading">テスト層</h2><dl>${describedLayers.map((layer) => `<dt>${escapeHtml(layer.name)}</dt><dd>${escapeHtml(layer.description ?? '')}</dd>`).join('')}</dl></section>`
    : '';
  const caseCount = (document: KnowledgeDocument): string => {
    const below = casesBelow(document);
    if (below.length === 0) return '<small class="no-cases">ケースなし</small>';
    const breakdown = layers.length > 1 ? `<span class="layer-breakdown">${layers.map((layer) => `${escapeHtml(layer)} ${below.filter((item) => item.layer === layer).length}`).join(' · ')}</span>` : '';
    return `<small>${below.length}ケース${breakdown}</small>`;
  };
  const membershipKinds = new Set(catalog.rules.case.fields.belongsTo?.type === 'reference' ? catalog.rules.case.fields.belongsTo.targetKinds : []);
  const uncovered = documents.filter((document) => membershipKinds.has(document.kind) && casesBelow(document).length === 0);
  const uncoveredSection = uncovered.length > 0
    ? `<section class="uncovered-documents" aria-labelledby="uncovered-heading"><h2 id="uncovered-heading">ケースのない文書</h2><p>ケースの所属先にできる文書のうち、配下にケースが1件もないものです。</p><ul>${uncovered.map((document) => `<li><a href="documents/${safeName(document.id)}.html">${escapeHtml(document.title)}</a><small>${escapeHtml(document.kind)} · ${pathOf(document).map((item) => escapeHtml(item.title)).join(' › ')}</small></li>`).join('')}</ul></section>`
    : '';

  const domainCards = domains.map((domain) => {
    const features = documents.filter((document) => document.parent === domain.id);
    const summary = domain.body.trim().split(/\r?\n/u).find((line) => line.trim() && !line.startsWith('#')) ?? '';
    const search = [domain.title, summary, ...features.map((feature) => feature.title)].join(' ');
    return `<section class="domain-overview" data-domain-overview="${escapeHtml(domain.id)}" data-search="${escapeHtml(search)}"><header><h2><a href="documents/${safeName(domain.id)}.html">${escapeHtml(domain.title)}</a></h2><span>${casesBelow(domain).length}ケース</span></header><p>${escapeHtml(summary)}</p>${features.length ? `<ul>${features.map((feature) => `<li><a href="documents/${safeName(feature.id)}.html">${escapeHtml(feature.title)}</a>${caseCount(feature)}</li>`).join('')}</ul>` : ''}</section>`;
  }).join('');
  files.set('index.html', layout('ドメイン', 'catalog', '', `<div class="catalog-intro"><h1>ドメインから確認内容をたどる</h1><label class="global-search"><span>検索</span><input id="search" type="search" placeholder="ドメイン、featureを検索"></label><strong><span>${documents.length}</span>文書</strong></div><div class="domain-overviews">${domainCards}</div>${renderBreakdowns(catalog.rules, cases, documents, domainOf, pathOf)}${uncoveredSection}${layerSection}<script src="assets/search.js"></script>`));

  const values = (select: (item: ManagedCase) => unknown): string[] => [...new Set(cases.map(select).filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String))].sort(compareText);
  const filterFields = Object.entries(catalog.rules.case.fields).filter(([name, rule]) => name !== 'belongsTo' && rule.placement === 'classification' && rule.type !== 'reference-list').map(([name]) => name).sort(compareText);
  const filters = [
    { key: 'layer', label: 'テスト層', options: values((item) => item.layer).map((value) => ({ value, label: value })) },
    { key: 'source', label: '確認手段', options: values((item) => item.source).map((value) => ({ value, label: value })) },
    { key: 'status', label: '定義状態', options: values((item) => item.status).map((value) => ({ value, label: value })) },
    ...filterFields.map((key) => ({ key, label: catalog.rules.case.fields[key]?.label ?? key, options: values((item) => item.fields[key]).map((value) => { const rule = catalog.rules.case.fields[key]; return { value, label: rule?.type === 'enum' || rule?.type === 'integer-enum' ? rule.values[value]?.label ?? value : value }; }) })),
  ];
  const domainCases = domains.map((domain) => ({ domain, cases: cases.filter((item) => domainOf(item)?.id === domain.id) })).filter((entry) => entry.cases.length > 0);
  const domainNavigation = domainCases.map(({ domain, cases: items }) => `<button type="button" data-domain-filter="${escapeHtml(domain.id)}" aria-pressed="false"><span>${escapeHtml(domain.title)}</span><small>${items.length}</small></button>`).join('');
  const domainGroups = domainCases.map(({ domain, cases: items }) => `<section class="domain-group" data-domain-group="${escapeHtml(domain.id)}"><header><h2>${escapeHtml(domain.title)}</h2><span>${items.length}ケース</span></header><ul>${items.map((item) => { const membership = byId.get(item.fields.belongsTo); const search = `${item.id} ${item.title} ${membership?.title ?? ''} ${JSON.stringify(item.fields)} ${item.source === 'vitest' ? `${item.parameters ? JSON.stringify(item.parameters) : ''} ${item.parametersSource ?? ''}`.slice(0, searchTableLimit) : ''}`; return `<li data-case-row data-domain="${escapeHtml(domain.id)}" data-search="${escapeHtml(search)}" data-filters="${escapeHtml(JSON.stringify({ layer: item.layer, source: item.source, status: item.status, ...item.fields }))}"><div><small>${escapeHtml(item.id)} · ${escapeHtml(item.layer)} · ${escapeHtml(item.source)} · ${escapeHtml(item.status)}</small>${linkCase(item)}</div><span>${escapeHtml(membership?.title ?? item.fields.belongsTo)}</span></li>`; }).join('')}</ul></section>`).join('');
  const filterControls = filters.map((filter) => `<label><span>${escapeHtml(filter.label)}</span><select id="${escapeHtml(filter.key)}-filter" data-filter-key="${escapeHtml(filter.key)}"><option value="">すべて</option>${filter.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select></label>`).join('');
  files.set('cases/index.html', layout('ケース検索', 'cases', '../', `<div class="catalog-intro"><h1>ケース検索</h1><label class="global-search"><span>検索</span><input id="search" type="search" placeholder="ID、ケース名、featureを検索"></label><strong><span>${cases.length}</span>ケース</strong></div><div class="catalog-layout"><aside class="domain-index"><button class="active" type="button" data-domain-filter="" aria-pressed="true"><span>すべて</span><small>${cases.length}</small></button>${domainNavigation}</aside><div class="catalog-content"><section class="filters">${filterControls}</section><p class="result-summary" id="result-summary" aria-live="polite">${cases.length}ケース</p><div id="domain-groups">${domainGroups}</div><p class="empty-results" id="empty-results" hidden>条件に一致するケースはありません。</p></div></div><script src="../assets/search.js"></script>`));

  const renderTree = (parent: string | undefined): string => { const children = documents.filter((document) => document.parent === parent); return children.length ? `<ul>${children.map((document) => `<li><div>${linkDocument(document)}</div>${renderTree(document.id)}</li>`).join('')}</ul>` : ''; };
  files.set('documents/index.html', layout('仕様・判断', 'documents', '../', `<div class="page-heading"><h1>仕様・判断</h1></div><nav class="document-tree" aria-label="仕様と判断の階層">${renderTree(undefined)}</nav>`));

  // Feature pages read like a spec review: what the feature does, then its edge cases and rejections, then non-functional checks.
  // The axes are the conventional `characteristic` and `path` enum fields; a project without them gets a flat list.
  const groupingAxes = ['characteristic', 'path'].flatMap((name) => {
    const rule = catalog.rules.case.fields[name];
    return rule?.type === 'enum' ? [{ name, values: Object.entries(rule.values).map(([value, definition]) => ({ value, label: definition.label ?? value })) }] : [];
  });
  const caseItem = (item: ManagedCase): string => `<li>${linkCase(item)}<small>${escapeHtml(item.layer)} · ${escapeHtml(item.source)}</small></li>`;
  const groupedCaseList = (items: readonly ManagedCase[], axes = groupingAxes, depth = 3): string => {
    if (items.length === 0) return '<ul><li>0件</li></ul>';
    const [axis, ...rest] = axes;
    if (!axis) return `<ul>${items.map(caseItem).join('')}</ul>`;
    const groups = [...axis.values, { value: undefined, label: '未設定' }]
      .map((group) => ({ ...group, items: items.filter((item) => group.value === undefined ? !axis.values.some(({ value }) => value === item.fields[axis.name]) : item.fields[axis.name] === group.value) }))
      .filter((group) => group.items.length > 0);
    // A level where nothing has a value adds only a lone 未設定 heading, so skip it.
    if (groups.length === 1 && groups[0]?.value === undefined) return groupedCaseList(items, rest, depth);
    return groups.map((group) => `<h${depth}>${escapeHtml(group.label)} <small>${group.items.length}件</small></h${depth}>${groupedCaseList(group.items, rest, depth + 1)}`).join('');
  };
  for (const document of documents) {
    const related = (document.refs ?? []).flatMap((id) => { const item = byId.get(id); return item ? [item] : []; });
    const referenced = cases.filter((item) => Array.isArray(item.fields.refs) && item.fields.refs.includes(document.id));
    const crumb = pathOf(document).map((item) => item.id === document.id ? escapeHtml(item.title) : linkDocument(item)).join(' › ');
    const children = documents.filter((item) => item.parent === document.id);
    const section = (title: string, body: string): string => `<section class="detail-section"><h2>${title}</h2>${body}</section>`;
    const links = (items: readonly string[]): string => items.length > 0 ? `<ul class="link-list">${items.join('')}</ul>` : '<p class="empty-note">0件</p>';
    files.set(`documents/${safeName(document.id)}.html`, layout(document.title, 'documents', '../', `<header class="detail-header"><nav class="breadcrumb" aria-label="文書の階層">${crumb}</nav><h1>${escapeHtml(document.title)}</h1><p class="detail-meta"><code>${escapeHtml(document.id)}</code><span>${escapeHtml(document.kind)}</span></p></header><article class="document-body">${renderMarkdown(document.body, { omitHeading: document.title })}</article>${children.length > 0 ? section('配下の文書', links(children.map((item) => `<li>${linkDocument(item)}<small>${escapeHtml(item.kind)}</small></li>`))) : ''}${related.length > 0 ? section('関連文書', links(related.map((item) => `<li>${linkDocument(item)}</li>`))) : ''}${section('確認定義', `<p class="case-count">${caseCount(document)}</p><div class="case-groups">${groupedCaseList(casesBelow(document))}</div>`)}${referenced.length > 0 ? section('関連ケース', links(referenced.map(caseItem))) : ''}<p class="source-note">Source: <code>${escapeHtml(document.location.file)}</code></p>`));
  }
  const fieldRules = catalog.rules.case.fields;
  // Field values as the project names them: enum labels, linked documents, and lists, instead of raw JSON.
  const fieldValue = (name: string, value: unknown): string => {
    const rule = fieldRules[name];
    if ((rule?.type === 'enum' || rule?.type === 'integer-enum') && (typeof value === 'string' || typeof value === 'number')) {
      const label = rule.values[String(value)]?.label;
      return label && label !== String(value) ? `${escapeHtml(label)} <small>${escapeHtml(value)}</small>` : escapeHtml(value);
    }
    if ((rule?.type === 'reference' || rule?.type === 'reference-list') && (typeof value === 'string' || Array.isArray(value))) {
      const ids = (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string');
      return ids.map((id) => { const document = byId.get(id as KnowledgeDocument['id']); return document ? linkDocument(document) : `<code>${escapeHtml(id)}</code> <small>（文書なし）</small>`; }).join('、');
    }
    if (Array.isArray(value)) return `<ul>${value.map((entry) => `<li>${escapeHtml(typeof entry === 'string' ? entry : JSON.stringify(entry))}</li>`).join('')}</ul>`;
    return typeof value === 'string' ? escapeHtml(value) : `<code>${pretty(value)}</code>`;
  };
  const fieldList = (values: Readonly<Record<string, unknown>>): string => {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    return entries.length === 0 ? '<p class="empty-note">なし</p>' : `<dl class="case-fields">${entries.map(([name, value]) => `<dt>${escapeHtml(fieldRules[name]?.label ?? name)}</dt><dd>${fieldValue(name, value)}</dd>`).join('')}</dl>`;
  };
  const procedureTable = (steps: ReadonlyArray<Readonly<{ action: string; expected: string }>>): string =>
    `<table class="case-procedure"><thead><tr><th scope="col">#</th><th scope="col">操作</th><th scope="col">期待結果</th></tr></thead><tbody>${steps.map((step, index) => `<tr><th scope="row">${index + 1}</th><td>${escapeHtml(step.action)}</td><td>${escapeHtml(step.expected)}</td></tr>`).join('')}</tbody></table>`;
  for (const item of cases) {
    const refs = [item.fields.belongsTo, ...(item.fields.refs ?? [])];
    const parameters = item.source === 'vitest' ? item.parameters : undefined;
    const parametersSource = item.source === 'vitest' ? item.parametersSource : undefined;
    const section = (title: string, body: string): string => `<section class="detail-section"><h2>${title}</h2>${body}</section>`;
    const relatedDocuments = refs.flatMap((id) => { const document = byId.get(id); return document ? [`<li>${linkDocument(document)}</li>`] : []; });
    files.set(`cases/${safeName(item.id)}.html`, layout(item.title, 'cases', '../', `<header class="detail-header"><h1>${escapeHtml(item.title)}</h1><p class="detail-meta"><code>${escapeHtml(item.id)}</code><span>${escapeHtml(item.layer)}</span><span>${escapeHtml(item.source)}</span><span>${escapeHtml(item.status)}</span></p></header>${section('所属・分類', fieldList(item.fields))}${section('条件・理由', fieldList(item.details))}${item.procedure ? section('操作と期待結果', `<div class="table-scroll">${procedureTable(item.procedure)}</div>`) : ''}${parameters ? section('each入力表', `<pre>${pretty(parameters)}</pre>`) : ''}${parametersSource !== undefined ? section('each入力表', `<p>値を静的に読めないため、コードのまま示します。</p><pre>${escapeHtml(parametersSource)}</pre>`) : ''}${relatedDocuments.length > 0 ? section('関連する仕様・判断', `<ul class="link-list">${relatedDocuments.join('')}</ul>`) : ''}${section('ソース', `<p class="source-path"><code>${escapeHtml(item.location.file)}:${item.location.line}</code></p><pre>${escapeHtml(item.snippet)}</pre>`)}`));
  }
  const publicDocuments = documents.map(({ fieldLocations: _fieldLocations, ...document }) => document);
  files.set('assets/style.css', `${catalogStyles}\n[hidden]{display:none!important}\n.no-cases{color:#6e6e73;font-style:italic}.domain-overview li{flex-wrap:wrap;gap:2px 12px}.layer-breakdown{display:block;margin-top:2px}.uncovered-documents{margin-bottom:48px;padding:20px;background:white;border:1px solid #e4e7ec;border-radius:14px}.uncovered-documents h2{margin:0 0 4px;font-size:18px}.uncovered-documents>p{margin:0;color:#6e6e73;font-size:12px}.uncovered-documents ul{margin:12px 0 0;padding:0;list-style:none}.uncovered-documents li{padding:9px 0;display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;border-top:1px solid #e4e7ec}.uncovered-documents li a{color:#06c;text-decoration:none}.breakdowns{margin-bottom:48px}.breakdowns h2{margin:0 0 4px;font-size:18px}.breakdowns>p{margin:0 0 12px;color:#6e6e73;font-size:12px}.breakdown-table{margin-bottom:16px;overflow-x:auto;background:white;border:1px solid #e4e7ec;border-radius:14px}.breakdown-table table{width:100%;border-collapse:collapse;font-size:13px}.breakdown-table caption{padding:12px 16px 4px;text-align:left;font-weight:600}.breakdown-table th,.breakdown-table td{padding:8px 12px;border-top:1px solid #e4e7ec;text-align:right;white-space:nowrap}.breakdown-table th[scope=row],.breakdown-table thead th:first-child{position:sticky;left:0;background:white;text-align:left;font-weight:500}.breakdown-table small{color:#b25000}.breakdown-zero{color:#6e6e73}.breakdown-total th,.breakdown-total td{font-weight:600}.case-fields{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0 0 24px;padding:16px;background:white;border:1px solid #e4e7ec;border-radius:12px}.case-fields dt{color:#6e6e73}.case-fields dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.case-fields dd ul{margin:0;padding-left:18px}.case-fields small{color:#6e6e73;margin-left:4px}.case-procedure{width:100%;border-collapse:collapse;background:white;border:1px solid #e4e7ec;font-size:13px}.case-procedure th,.case-procedure td{padding:8px 10px;border-top:1px solid #e4e7ec;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.case-procedure th[scope=row]{width:2em;color:#6e6e73;font-weight:400}@media (max-width:640px){.case-fields{grid-template-columns:1fr}}.detail-header{margin-bottom:28px}.detail-header h1{margin:0 0 10px;font-size:clamp(24px,3vw,32px);line-height:1.25;overflow-wrap:anywhere}.breadcrumb{margin-bottom:10px;color:#6e6e73;font-size:12px}.breadcrumb a{color:#06c;text-decoration:none}.detail-meta{margin:0;display:flex;flex-wrap:wrap;gap:6px;color:#6e6e73;font-size:12px}.detail-meta code,.detail-meta span{padding:2px 8px;background:rgba(118,118,128,.1);border-radius:999px}.detail-meta code{color:#1d1d1f;overflow-wrap:anywhere}:is(.detail-header,.document-body,.detail-section) a{color:#06c;text-decoration:none}:is(.detail-header,.document-body,.detail-section) a:hover{text-decoration:underline}.document-body{margin:0 0 28px;padding:24px 28px;background:white;border:1px solid #e4e7ec;border-radius:14px;font-size:14px;line-height:1.75;overflow:visible}.document-body>:first-child{margin-top:0}.document-body>:last-child{margin-bottom:0}.document-body h1,.document-body h2{margin:28px 0 10px;font-size:18px}.document-body h3,.document-body h4{margin:20px 0 8px;font-size:15px}.document-body p,.document-body ul,.document-body ol,.document-body blockquote,.document-body .table-scroll,.document-body pre{margin:0 0 12px}.document-body ul,.document-body ol{padding-left:1.4em}.document-body li+li{margin-top:4px}.document-body li>ul,.document-body li>ol{margin:4px 0 0}.document-body :not(pre)>code,.case-fields code{padding:1px 5px;background:#f2f2f5;border-radius:5px;font-size:.92em;overflow-wrap:anywhere}.document-body blockquote{padding:4px 14px;color:#515154;border-left:3px solid #d0d5dd}.document-body hr{margin:20px 0;border:0;border-top:1px solid #e4e7ec}.table-scroll{overflow-x:auto}.document-body table{border-collapse:collapse;font-size:13px}.document-body th,.document-body td{padding:7px 10px;border:1px solid #e4e7ec;text-align:left;vertical-align:top}.document-body thead th{background:#f7f7f9}.detail-section{margin-bottom:28px}.detail-section>h2{margin:0 0 10px;font-size:17px}.detail-section pre{margin:0;padding:14px 16px;border:1px solid #e4e7ec;border-radius:12px;font-size:12px;line-height:1.55}.link-list{margin:0;padding:0;list-style:none;background:white;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden}.link-list li{padding:10px 16px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}.link-list li+li{border-top:1px solid #edf0f3}.link-list small,.case-groups small{color:#6e6e73;font-size:11px}.empty-note{margin:0;color:#6e6e73}.case-count{margin:0 0 12px}.case-groups>h3{margin:22px 0 8px;font-size:15px}.case-groups>h3:first-child{margin-top:0}.case-groups h4{margin:12px 0 6px;color:#515154;font-size:13px;font-weight:600}.case-groups h3 small,.case-groups h4 small{margin-left:4px;font-weight:400}.case-groups ul{margin:0 0 8px;padding:0;list-style:none;background:white;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden}.case-groups li{padding:9px 16px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 12px}.case-groups li+li{border-top:1px solid #edf0f3}.source-path{margin:0 0 8px;font-size:12px;overflow-wrap:anywhere}.source-note{margin:32px 0 0;color:#6e6e73;font-size:12px;overflow-wrap:anywhere}.case-fields,.case-procedure{margin:0}@media (max-width:640px){.document-body{padding:18px}.link-list li,.case-groups li{padding-inline:12px}}\n`);
  files.set('assets/search.js', catalogSearchScript);
  files.set('catalog.json', `${JSON.stringify({ documents: publicDocuments, cases }, null, 2)}\n`);
  files.set('.test-manager-output', 'v1\n');
  return files;
};
