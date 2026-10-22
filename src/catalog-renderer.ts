import { catalogStyles } from './catalog-assets.js';
import { catalogDocumentScript, catalogOverviewScript, catalogSearchScript } from './catalog-scripts.js';
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
  // The text a case is found by, the same on the case search and on document pages.
  const searchText = (item: ManagedCase): string => `${item.id} ${item.title} ${byId.get(item.fields.belongsTo)?.title ?? ''} ${JSON.stringify(item.fields)} ${item.source === 'vitest' ? `${item.parameters ? JSON.stringify(item.parameters) : ''} ${item.parametersSource ?? ''}`.slice(0, searchTableLimit) : ''}`;
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

  // One table for every domain: domains grow in number, so rows compare better than cards. Counts link to the narrowed case search.
  const countCells = (document: KnowledgeDocument): string => {
    const below = casesBelow(document);
    const total = below.length === 0 ? '<td class="no-cases">ケースなし</td>' : `<td><a href="cases/index.html?feature=${safeName(document.id)}">${below.length}</a></td>`;
    return `${total}${layers.length > 1 ? layers.map((layer) => { const count = below.filter((item) => item.layer === layer).length; return `<td${count === 0 ? ' class="breakdown-zero"' : ''}>${count}</td>`; }).join('') : ''}`;
  };
  const domainRows = domains.map((domain) => {
    const features = documents.filter((document) => document.parent === domain.id);
    const summary = domain.body.trim().split(/\r?\n/u).find((line) => line.trim() && !line.startsWith('#')) ?? '';
    const featureRows = features.map((feature) => `<tr data-feature-row data-search="${escapeHtml(feature.title)} ${escapeHtml(feature.id)}"><th scope="row"><a href="documents/${safeName(feature.id)}.html">${escapeHtml(feature.title)}</a></th>${countCells(feature)}</tr>`).join('');
    return `<tbody data-domain-overview="${escapeHtml(domain.id)}" data-search="${escapeHtml(`${domain.title} ${domain.id} ${summary}`)}"><tr class="domain-row"><th scope="rowgroup">${features.length > 0 ? `<button type="button" class="domain-toggle" data-domain-toggle aria-expanded="true" aria-label="${escapeHtml(domain.title)}の機能" hidden></button>` : ''}<a href="documents/${safeName(domain.id)}.html">${escapeHtml(domain.title)}</a>${summary ? `<p>${escapeHtml(summary)}</p>` : ''}</th>${countCells(domain)}</tr>${featureRows}</tbody>`;
  }).join('');
  const layerHeadings = layers.length > 1 ? layers.map((layer) => `<th scope="col">${escapeHtml(layer)}</th>`).join('') : '';
  files.set('index.html', layout('ドメイン', 'catalog', '', `<div class="catalog-intro"><h1>ドメインから確認内容をたどる</h1><label class="global-search"><span>検索</span><input id="search" type="search" placeholder="ドメイン、featureを検索"></label><strong><span>${documents.length}</span>文書</strong></div><p class="table-actions"><button type="button" id="expand-all" hidden>すべて開く</button></p><div class="domain-table-wrap"><table class="domain-table"><thead><tr><th scope="col">ドメイン・機能</th><th scope="col">ケース</th>${layerHeadings}</tr></thead>${domainRows}</table><p class="empty-results" id="empty-overview" hidden>条件に一致するドメイン・機能はありません。</p></div>${renderBreakdowns(catalog.rules, cases, documents, domainOf, pathOf)}${uncoveredSection}${layerSection}<script src="assets/overview.js"></script>`));

  const values = (select: (item: ManagedCase) => unknown): string[] => [...new Set(cases.map(select).filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String))].sort(compareText);
  // q, domain and feature are the search page's own URL parameters, so fields with those names get no filter control.
  const reservedParameters = new Set(['q', 'domain', 'feature']);
  const filterFields = Object.entries(catalog.rules.case.fields).filter(([name, rule]) => name !== 'belongsTo' && !reservedParameters.has(name) && rule.placement === 'classification' && rule.type !== 'reference-list').map(([name]) => name).sort(compareText);
  const filters = [
    { key: 'layer', label: 'テスト層', options: values((item) => item.layer).map((value) => ({ value, label: value })) },
    { key: 'source', label: '確認手段', options: values((item) => item.source).map((value) => ({ value, label: value })) },
    { key: 'status', label: '定義状態', options: values((item) => item.status).map((value) => ({ value, label: value })) },
    ...filterFields.map((key) => ({ key, label: catalog.rules.case.fields[key]?.label ?? key, options: values((item) => item.fields[key]).map((value) => { const rule = catalog.rules.case.fields[key]; return { value, label: rule?.type === 'enum' || rule?.type === 'integer-enum' ? rule.values[value]?.label ?? value : value }; }) })),
  ];
  const domainCases = domains.map((domain) => ({ domain, cases: cases.filter((item) => domainOf(item)?.id === domain.id) })).filter((entry) => entry.cases.length > 0);
  const domainNavigation = domainCases.map(({ domain, cases: items }) => `<button type="button" data-domain-filter="${escapeHtml(domain.id)}" aria-pressed="false"><span>${escapeHtml(domain.title)}</span><small>${items.length}</small></button>`).join('');
  const filterControls = filters.map((filter) => `<label><span>${escapeHtml(filter.label)}</span><select id="${escapeHtml(filter.key)}-filter" data-filter-key="${escapeHtml(filter.key)}"><option value="">すべて</option>${filter.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select></label>`).join('');
  // The rows are drawn by the script from this data, in domain order, so the page itself stays small.
  const searchEntries = domainCases.flatMap(({ domain, cases: items }) => items.map((item) => {
    const membership = byId.get(item.fields.belongsTo);
    const search = searchText(item);
    return { id: item.id, title: item.title, href: `${safeName(item.id)}.html`, layer: item.layer, source: item.source, status: item.status, domain: domain.id, domainTitle: domain.title, belongsToTitle: membership?.title ?? item.fields.belongsTo, ancestors: membership ? pathOf(membership).map((document) => document.id) : [], filters: { layer: item.layer, source: item.source, status: item.status, ...item.fields }, search };
  }));
  const featureTitles = Object.fromEntries(documents.map((document) => [document.id, document.title]));
  // JSON in a script: escape "<" so a title can never close the script element.
  const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</gu, '\\u003c');
  files.set('cases/index-data.js', `window.testManagerCases=${scriptJson(searchEntries)};\nwindow.testManagerFeatures=${scriptJson(featureTitles)};\n`);
  files.set('cases/index.html', layout('ケース検索', 'cases', '../', `<div class="catalog-intro"><h1>ケース検索</h1><label class="global-search"><span>検索</span><input id="search" type="search" placeholder="ID、ケース名、featureを検索"></label><strong><span>${cases.length}</span>ケース</strong></div><div class="catalog-layout"><aside class="domain-index"><button class="active" type="button" data-domain-filter="" aria-pressed="true"><span>すべて</span><small>${cases.length}</small></button>${domainNavigation}</aside><div class="catalog-content"><section class="filters">${filterControls}</section><p class="feature-filter" id="feature-filter" hidden>機能: <strong data-feature-label></strong> とその配下 <button type="button">解除</button></p><p class="result-summary" id="result-summary" aria-live="polite">${cases.length}ケース</p><div id="case-results"></div><button class="show-more" id="show-more" type="button" hidden></button><p class="empty-results" id="empty-results" hidden>条件に一致するケースはありません。</p></div></div><script src="index-data.js"></script><script src="../assets/search.js"></script>`));

  // Documents with children start folded, so the list reads as the top-level domains first.
  const childrenOf = new Map<string | undefined, KnowledgeDocument[]>();
  for (const document of documents) childrenOf.set(document.parent, [...(childrenOf.get(document.parent) ?? []), document]);
  const renderTree = (parent: string | undefined): string => {
    const children = childrenOf.get(parent) ?? [];
    return children.length ? `<ul>${children.map((document) => { const count = childrenOf.get(document.id)?.length ?? 0; return count > 0 ? `<li><details><summary>${linkDocument(document)}<small>配下 ${count}件</small></summary>${renderTree(document.id)}</details></li>` : `<li><div>${linkDocument(document)}</div></li>`; }).join('')}</ul>` : '';
  };
  files.set('documents/index.html', layout('仕様・判断', 'documents', '../', `<div class="page-heading"><h1>仕様・判断</h1></div><nav class="document-tree" aria-label="仕様と判断の階層">${renderTree(undefined)}</nav>`));

  // Feature pages read like a spec review: what the feature does, then its edge cases and rejections, then non-functional checks.
  // The axes are the conventional `characteristic` and `path` enum fields; a project without them gets a flat list.
  const groupingAxes = ['characteristic', 'path'].flatMap((name) => {
    const rule = catalog.rules.case.fields[name];
    return rule?.type === 'enum' ? [{ name, values: Object.entries(rule.values).map(([value, definition]) => ({ value, label: definition.label ?? value })) }] : [];
  });
  const caseItem = (item: ManagedCase): string => `<li>${linkCase(item)}<small>${escapeHtml(item.layer)} · ${escapeHtml(item.source)}</small></li>`;
  const filterableCaseItem = (item: ManagedCase): string => `<li data-case-row data-search="${escapeHtml(searchText(item))}" data-filters="${escapeHtml(JSON.stringify({ layer: item.layer, source: item.source, status: item.status, ...item.fields }))}">${linkCase(item)}<small>${escapeHtml(item.layer)} · ${escapeHtml(item.source)}</small></li>`;
  const groupedCaseList = (items: readonly ManagedCase[], axes = groupingAxes, depth = 3): string => {
    if (items.length === 0) return '<ul><li>0件</li></ul>';
    const [axis, ...rest] = axes;
    if (!axis) return `<ul>${items.map(filterableCaseItem).join('')}</ul>`;
    const groups = [...axis.values, { value: undefined, label: '未設定' }]
      .map((group) => ({ ...group, items: items.filter((item) => group.value === undefined ? !axis.values.some(({ value }) => value === item.fields[axis.name]) : item.fields[axis.name] === group.value) }))
      .filter((group) => group.items.length > 0);
    // A level where nothing has a value adds only a lone 未設定 heading, so skip it.
    if (groups.length === 1 && groups[0]?.value === undefined) return groupedCaseList(items, rest, depth);
    return groups.map((group) => `<section class="case-group" data-case-group><h${depth}>${escapeHtml(group.label)} <small data-group-count>${group.items.length}件</small></h${depth}>${groupedCaseList(group.items, rest, depth + 1)}</section>`).join('');
  };
  // Filters for the cases under one document: only fields that take two or more values there are worth a control.
  const caseFilterBar = (document: KnowledgeDocument, items: readonly ManagedCase[]): string => {
    const controls = filters.flatMap((filter) => {
      const present = new Set(items.map((item) => String(filter.key === 'layer' ? item.layer : filter.key === 'source' ? item.source : filter.key === 'status' ? item.status : item.fields[filter.key] ?? '')));
      const options = filter.options.filter((option) => present.has(option.value));
      return options.length < 2 ? [] : [`<label><span>${escapeHtml(filter.label)}</span><select data-filter-key="${escapeHtml(filter.key)}"><option value="">すべて</option>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select></label>`];
    }).join('');
    return `<div class="case-filters"><label class="case-filter-search"><span>絞り込み</span><input id="case-filter-search" type="search" placeholder="ID、ケース名"></label>${controls}</div><p class="case-filter-summary"><span id="case-filter-summary">${items.length}ケース</span><a id="open-in-search" href="../cases/index.html?feature=${safeName(document.id)}">ケース検索で開く</a></p><p class="empty-note" id="case-filter-empty" hidden>条件に一致するケースはありません。</p>`;
  };
  for (const document of documents) {
    const related = (document.refs ?? []).flatMap((id) => { const item = byId.get(id); return item ? [item] : []; });
    const referenced = cases.filter((item) => Array.isArray(item.fields.refs) && item.fields.refs.includes(document.id));
    const crumb = pathOf(document).map((item) => item.id === document.id ? escapeHtml(item.title) : linkDocument(item)).join(' › ');
    const children = documents.filter((item) => item.parent === document.id);
    const section = (title: string, body: string): string => `<section class="detail-section"><h2>${title}</h2>${body}</section>`;
    const links = (items: readonly string[]): string => items.length > 0 ? `<ul class="link-list">${items.join('')}</ul>` : '<p class="empty-note">0件</p>';
    files.set(`documents/${safeName(document.id)}.html`, layout(document.title, 'documents', '../', `<header class="detail-header"><nav class="breadcrumb" aria-label="文書の階層">${crumb}</nav><h1>${escapeHtml(document.title)}</h1><p class="detail-meta"><code>${escapeHtml(document.id)}</code><span>${escapeHtml(document.kind)}</span></p></header><article class="document-body">${renderMarkdown(document.body, { omitHeading: document.title })}</article>${children.length > 0 ? section('配下の文書', links(children.map((item) => `<li>${linkDocument(item)}<small>${escapeHtml(item.kind)}</small></li>`))) : ''}${related.length > 0 ? section('関連文書', links(related.map((item) => `<li>${linkDocument(item)}</li>`))) : ''}${section('確認定義', `<p class="case-count">${caseCount(document)}</p>${casesBelow(document).length > 0 ? `<div data-case-filter-root>${caseFilterBar(document, casesBelow(document))}<div class="case-groups">${groupedCaseList(casesBelow(document))}</div></div>` : '<div class="case-groups"><ul><li>0件</li></ul></div>'}`)}${referenced.length > 0 ? section('関連ケース', links(referenced.map(caseItem))) : ''}<p class="source-note">Source: <code>${escapeHtml(document.location.file)}</code></p><script src="../assets/document.js"></script>`));
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
  files.set('assets/style.css', `${catalogStyles}\n[hidden]{display:none!important}\n.table-actions{margin:-1rem 0 8px;text-align:right}.table-actions button{padding:4px 10px;border:1px solid #d0d5dd;border-radius:8px;background:white;font:inherit;font-size:12px;cursor:pointer}.domain-toggle{width:22px;height:22px;margin:0 6px 0 -4px;padding:0;border:0;border-radius:6px;background:transparent;color:#6e6e73;cursor:pointer;vertical-align:-3px}.domain-toggle::before{content:'▾';display:inline-block}.domain-toggle[aria-expanded=false]::before{transform:rotate(-90deg)}.domain-toggle:hover{background:#f0f0f3}tbody[data-collapsed] [data-feature-row]{display:none}.domain-table .domain-row th[scope=rowgroup]{background:#fafafc}.document-tree details>summary{padding:14px 16px;display:flex;align-items:baseline;gap:10px;background:white;border:1px solid #e4e7ec;border-radius:10px;cursor:pointer;list-style:none}.document-tree details>summary::-webkit-details-marker{display:none}.document-tree details>summary::before{content:'▸';color:#6e6e73}.document-tree details[open]>summary::before{content:'▾'}.document-tree summary small{margin-left:auto;color:#6e6e73;font-size:12px}.document-tree details>ul{margin:8px 0 0 24px;padding-left:18px;border-left:2px solid #d9d9df;list-style:none}.no-cases{color:#6e6e73;font-style:italic}.layer-breakdown{display:block;margin-top:2px}.uncovered-documents{margin-bottom:48px;padding:20px;background:white;border:1px solid #e4e7ec;border-radius:14px}.uncovered-documents h2{margin:0 0 4px;font-size:18px}.uncovered-documents>p{margin:0;color:#6e6e73;font-size:12px}.uncovered-documents ul{margin:12px 0 0;padding:0;list-style:none}.uncovered-documents li{padding:9px 0;display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;border-top:1px solid #e4e7ec}.uncovered-documents li a{color:#06c;text-decoration:none}.breakdowns{margin-bottom:48px}.breakdowns h2{margin:0 0 4px;font-size:18px}.breakdowns>p{margin:0 0 12px;color:#6e6e73;font-size:12px}.breakdown-table{margin-bottom:16px;overflow-x:auto;background:white;border:1px solid #e4e7ec;border-radius:14px}.breakdown-table table{width:100%;border-collapse:collapse;font-size:13px}.breakdown-table caption{padding:12px 16px 4px;text-align:left;font-weight:600}.breakdown-table th,.breakdown-table td{padding:8px 12px;border-top:1px solid #e4e7ec;text-align:right;white-space:nowrap}.breakdown-table th[scope=row],.breakdown-table thead th:first-child{position:sticky;left:0;background:white;text-align:left;font-weight:500}.breakdown-table small{color:#b25000}.breakdown-zero{color:#6e6e73}.breakdown-total th,.breakdown-total td{font-weight:600}.case-fields{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0 0 24px;padding:16px;background:white;border:1px solid #e4e7ec;border-radius:12px}.case-fields dt{color:#6e6e73}.case-fields dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.case-fields dd ul{margin:0;padding-left:18px}.case-fields small{color:#6e6e73;margin-left:4px}.case-procedure{width:100%;border-collapse:collapse;background:white;border:1px solid #e4e7ec;font-size:13px}.case-procedure th,.case-procedure td{padding:8px 10px;border-top:1px solid #e4e7ec;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.case-procedure th[scope=row]{width:2em;color:#6e6e73;font-weight:400}@media (max-width:640px){.case-fields{grid-template-columns:1fr}}.detail-header{margin-bottom:28px}.detail-header h1{margin:0 0 10px;font-size:clamp(24px,3vw,32px);line-height:1.25;overflow-wrap:anywhere}.breadcrumb{margin-bottom:10px;color:#6e6e73;font-size:12px}.breadcrumb a{color:#06c;text-decoration:none}.detail-meta{margin:0;display:flex;flex-wrap:wrap;gap:6px;color:#6e6e73;font-size:12px}.detail-meta code,.detail-meta span{padding:2px 8px;background:rgba(118,118,128,.1);border-radius:999px}.detail-meta code{color:#1d1d1f;overflow-wrap:anywhere}:is(.detail-header,.document-body,.detail-section) a{color:#06c;text-decoration:none}:is(.detail-header,.document-body,.detail-section) a:hover{text-decoration:underline}.document-body{margin:0 0 28px;padding:24px 28px;background:white;border:1px solid #e4e7ec;border-radius:14px;font-size:14px;line-height:1.75;overflow:visible}.document-body>:first-child{margin-top:0}.document-body>:last-child{margin-bottom:0}.document-body h1,.document-body h2{margin:28px 0 10px;font-size:18px}.document-body h3,.document-body h4{margin:20px 0 8px;font-size:15px}.document-body p,.document-body ul,.document-body ol,.document-body blockquote,.document-body .table-scroll,.document-body pre{margin:0 0 12px}.document-body ul,.document-body ol{padding-left:1.4em}.document-body li+li{margin-top:4px}.document-body li>ul,.document-body li>ol{margin:4px 0 0}.document-body :not(pre)>code,.case-fields code{padding:1px 5px;background:#f2f2f5;border-radius:5px;font-size:.92em;overflow-wrap:anywhere}.document-body blockquote{padding:4px 14px;color:#515154;border-left:3px solid #d0d5dd}.document-body hr{margin:20px 0;border:0;border-top:1px solid #e4e7ec}.table-scroll{overflow-x:auto}.document-body table{border-collapse:collapse;font-size:13px}.document-body th,.document-body td{padding:7px 10px;border:1px solid #e4e7ec;text-align:left;vertical-align:top}.document-body thead th{background:#f7f7f9}.detail-section{margin-bottom:28px}.detail-section>h2{margin:0 0 10px;font-size:17px}.detail-section pre{margin:0;padding:14px 16px;border:1px solid #e4e7ec;border-radius:12px;font-size:12px;line-height:1.55}.link-list{margin:0;padding:0;list-style:none;background:white;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden}.link-list li{padding:10px 16px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}.link-list li+li{border-top:1px solid #edf0f3}.link-list small,.case-groups small{color:#6e6e73;font-size:11px}.empty-note{margin:0;color:#6e6e73}.case-count{margin:0 0 12px}.case-groups h3{margin:22px 0 8px;font-size:15px}.case-groups>.case-group:first-child>h3{margin-top:0}.case-groups h4{margin:12px 0 6px;color:#515154;font-size:13px;font-weight:600}.case-groups h3 small,.case-groups h4 small{margin-left:4px;font-weight:400}.case-groups ul{margin:0 0 8px;padding:0;list-style:none;background:white;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden}.case-groups li{padding:9px 16px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 12px}.case-groups li+li{border-top:1px solid #edf0f3}.source-path{margin:0 0 8px;font-size:12px;overflow-wrap:anywhere}.source-note{margin:32px 0 0;color:#6e6e73;font-size:12px;overflow-wrap:anywhere}.case-fields,.case-procedure{margin:0}.domain-table-wrap{margin-bottom:48px;overflow-x:auto;background:white;border:1px solid #e4e7ec;border-radius:14px}.domain-table{width:100%;border-collapse:collapse;font-size:13px}.domain-table th,.domain-table td{padding:9px 14px;border-top:1px solid #edf0f3;text-align:right;white-space:nowrap}.domain-table thead th{border-top:0;color:#6e6e73;font-size:12px;font-weight:500}.domain-table th[scope=row],.domain-table th[scope=rowgroup],.domain-table thead th:first-child{position:sticky;left:0;z-index:1;background:white;text-align:left;white-space:normal;min-width:160px}.domain-table th[scope=row]{padding-left:32px;font-weight:400}.domain-table a{color:#06c;text-decoration:none}.domain-table a:hover{text-decoration:underline}.domain-row th,.domain-row td{padding-top:16px;background:#fafafc;font-weight:600;border-top:1px solid #e4e7ec}.domain-row th a{font-size:15px;color:#1d1d1f}.domain-row p{margin:4px 0 0;color:#6e6e73;font-size:12px;font-weight:400}.domain-table td.no-cases{font-size:12px}.domain-table-wrap .empty-results{margin:16px}.case-filters{margin:0 0 10px;display:flex;flex-wrap:wrap;gap:8px 12px}.case-filters label{display:grid;gap:4px;color:#6e6e73;font-size:11px}.case-filters input,.case-filters select{min-height:34px;padding:0 10px;border:1px solid #d0d5dd;border-radius:9px;background:white;font:inherit;font-size:13px;color:#1d1d1f}.case-filter-search{flex:1 1 220px}.case-filter-summary{margin:0 0 14px;display:flex;flex-wrap:wrap;gap:4px 16px;color:#6e6e73;font-size:12px}.feature-filter{margin:0 0 10px;padding:8px 12px;background:#eef4ff;border-radius:10px;font-size:13px}.feature-filter button,.show-more{margin-left:8px;padding:4px 10px;border:1px solid #d0d5dd;border-radius:8px;background:white;font:inherit;font-size:12px;cursor:pointer}.show-more{margin:12px 0 0;width:100%;padding:10px}@media (max-width:640px){.domain-table th[scope=row]{padding-left:20px}.document-body{padding:18px}.link-list li,.case-groups li{padding-inline:12px}}\n`);
  files.set('assets/search.js', catalogSearchScript);
  files.set('assets/overview.js', catalogOverviewScript);
  files.set('assets/document.js', catalogDocumentScript);
  files.set('catalog.json', `${JSON.stringify({ documents: publicDocuments, cases }, null, 2)}\n`);
  files.set('.test-manager-output', 'v1\n');
  return files;
};
