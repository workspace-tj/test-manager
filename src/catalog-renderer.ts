import { catalogSearchScript, catalogStyles } from './catalog-assets.js';
import { sortDocumentsForDisplay } from './documents.js';
import type { Catalog, KnowledgeDocument, ManagedCase } from './model.js';
import { escapeHtml } from './html.js';
const safeName = (value: string): string => encodeURIComponent(value);
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const pretty = (value: unknown): string => escapeHtml(JSON.stringify(value, null, 2));

type Section = 'catalog' | 'cases' | 'documents';

const layout = (title: string, section: Section, rootPrefix: string, body: string): string => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Test Manager</title><link rel="stylesheet" href="${rootPrefix}assets/style.css"></head>
<body><header class="app-header"><div class="header-inner"><a class="brand" href="${rootPrefix}index.html"><span class="brand-mark" aria-hidden="true">✓</span><span>Test Manager</span></a><nav class="segmented-nav" aria-label="カタログナビゲーション">${(['catalog', 'cases', 'documents'] as const).map((item) => `<a href="${rootPrefix}${item === 'catalog' ? 'index.html' : `${item}/index.html`}"${section === item ? ' aria-current="page"' : ''}>${item === 'catalog' ? 'ドメイン' : item === 'cases' ? 'ケース検索' : '仕様・判断'}</a>`).join('')}</nav><span class="header-spacer" aria-hidden="true"></span></div></header><main>${body}</main></body></html>\n`;

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

const markdown = (source: string): string => source.trim().split(/\r?\n/u).map((line) => {
  const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
  return heading ? `<h${heading[1]?.length}>${escapeHtml(heading[2])}</h${heading[1]?.length}>` : line ? `<p>${escapeHtml(line)}</p>` : '';
}).join('');

export const renderCatalogSite = (catalog: Catalog): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  const documents = sortDocumentsForDisplay(catalog.documents, catalog.rules);
  const cases = [...catalog.cases].sort((left, right) => compareText(left.id, right.id));
  const byId = new Map(documents.map((document) => [document.id, document]));
  const pathOf = (document: KnowledgeDocument): ReadonlyArray<KnowledgeDocument> => breadcrumbs(document, byId);
  const casesBelow = (document: KnowledgeDocument): ReadonlyArray<ManagedCase> => cases.filter((item) => {
    const membership = byId.get(item.fields.belongsTo);
    return membership ? pathOf(membership).some((ancestor) => ancestor.id === document.id) : false;
  });
  const rootOf = (document: KnowledgeDocument): KnowledgeDocument => pathOf(document)[0] ?? document;
  const domainOf = (item: ManagedCase): KnowledgeDocument | undefined => {
    const membership = byId.get(item.fields.belongsTo);
    return membership ? rootOf(membership) : undefined;
  };
  const linkDocument = (document: KnowledgeDocument): string => `<a href="../documents/${safeName(document.id)}.html">${escapeHtml(document.title)}</a>`;
  const linkCase = (item: ManagedCase): string => `<a href="../cases/${safeName(item.id)}.html">${escapeHtml(item.title)}</a>`;
  const domains = documents.filter((document) => document.parent === undefined);

  const domainCards = domains.map((domain) => {
    const features = documents.filter((document) => document.parent === domain.id);
    const summary = domain.body.trim().split(/\r?\n/u).find((line) => line.trim() && !line.startsWith('#')) ?? '';
    const search = [domain.title, summary, ...features.map((feature) => feature.title)].join(' ');
    return `<section class="domain-overview" data-domain-overview="${escapeHtml(domain.id)}" data-search="${escapeHtml(search)}"><header><h2><a href="documents/${safeName(domain.id)}.html">${escapeHtml(domain.title)}</a></h2><span>${casesBelow(domain).length}ケース</span></header><p>${escapeHtml(summary)}</p>${features.length ? `<ul>${features.map((feature) => `<li><a href="documents/${safeName(feature.id)}.html">${escapeHtml(feature.title)}</a><small>${casesBelow(feature).length}ケース</small></li>`).join('')}</ul>` : ''}</section>`;
  }).join('');
  files.set('index.html', layout('ドメイン', 'catalog', '', `<div class="catalog-intro"><h1>ドメインから確認内容をたどる</h1><label class="global-search"><span>検索</span><input id="search" type="search" placeholder="ドメイン、featureを検索"></label><strong><span>${documents.length}</span>文書</strong></div><div class="domain-overviews">${domainCards}</div><script src="assets/search.js"></script>`));

  const values = (select: (item: ManagedCase) => unknown): string[] => [...new Set(cases.map(select).filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String))].sort(compareText);
  const filterFields = Object.entries(catalog.rules.case.fields).filter(([name, rule]) => name !== 'belongsTo' && rule.placement === 'classification' && rule.type !== 'reference-list').map(([name]) => name).sort(compareText);
  const filters = [
    { key: 'source', label: '確認手段', options: values((item) => item.source).map((value) => ({ value, label: value })) },
    { key: 'status', label: '定義状態', options: values((item) => item.status).map((value) => ({ value, label: value })) },
    ...filterFields.map((key) => ({ key, label: catalog.rules.case.fields[key]?.label ?? key, options: values((item) => item.fields[key]).map((value) => { const rule = catalog.rules.case.fields[key]; return { value, label: rule?.type === 'enum' || rule?.type === 'integer-enum' ? rule.values[value]?.label ?? value : value }; }) })),
  ];
  const domainCases = domains.map((domain) => ({ domain, cases: cases.filter((item) => domainOf(item)?.id === domain.id) })).filter((entry) => entry.cases.length > 0);
  const domainNavigation = domainCases.map(({ domain, cases: items }) => `<button type="button" data-domain-filter="${escapeHtml(domain.id)}" aria-pressed="false"><span>${escapeHtml(domain.title)}</span><small>${items.length}</small></button>`).join('');
  const domainGroups = domainCases.map(({ domain, cases: items }) => `<section class="domain-group" data-domain-group="${escapeHtml(domain.id)}"><header><h2>${escapeHtml(domain.title)}</h2><span>${items.length}ケース</span></header><ul>${items.map((item) => { const membership = byId.get(item.fields.belongsTo); const search = `${item.id} ${item.title} ${membership?.title ?? ''} ${JSON.stringify(item.fields)}`; return `<li data-case-row data-domain="${escapeHtml(domain.id)}" data-search="${escapeHtml(search)}" data-filters="${escapeHtml(JSON.stringify({ source: item.source, status: item.status, ...item.fields }))}"><div><small>${escapeHtml(item.id)} · ${escapeHtml(item.source)} · ${escapeHtml(item.status)}</small>${linkCase(item)}</div><span>${escapeHtml(membership?.title ?? item.fields.belongsTo)}</span></li>`; }).join('')}</ul></section>`).join('');
  const filterControls = filters.map((filter) => `<label><span>${escapeHtml(filter.label)}</span><select id="${escapeHtml(filter.key)}-filter" data-filter-key="${escapeHtml(filter.key)}"><option value="">すべて</option>${filter.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select></label>`).join('');
  files.set('cases/index.html', layout('ケース検索', 'cases', '../', `<div class="catalog-intro"><h1>ケース検索</h1><label class="global-search"><span>検索</span><input id="search" type="search" placeholder="ID、ケース名、featureを検索"></label><strong><span>${cases.length}</span>ケース</strong></div><div class="catalog-layout"><aside class="domain-index"><button class="active" type="button" data-domain-filter="" aria-pressed="true"><span>すべて</span><small>${cases.length}</small></button>${domainNavigation}</aside><div class="catalog-content"><section class="filters">${filterControls}</section><p class="result-summary" id="result-summary" aria-live="polite">${cases.length}ケース</p><div id="domain-groups">${domainGroups}</div><p class="empty-results" id="empty-results" hidden>条件に一致するケースはありません。</p></div></div><script src="../assets/search.js"></script>`));

  const renderTree = (parent: string | undefined): string => { const children = documents.filter((document) => document.parent === parent); return children.length ? `<ul>${children.map((document) => `<li><div>${linkDocument(document)}</div>${renderTree(document.id)}</li>`).join('')}</ul>` : ''; };
  files.set('documents/index.html', layout('仕様・判断', 'documents', '../', `<div class="page-heading"><h1>仕様・判断</h1></div><nav class="document-tree" aria-label="仕様と判断の階層">${renderTree(undefined)}</nav>`));

  for (const document of documents) {
    const related = (document.refs ?? []).flatMap((id) => { const item = byId.get(id); return item ? [item] : []; });
    const referenced = cases.filter((item) => Array.isArray(item.fields.refs) && item.fields.refs.includes(document.id));
    const crumb = pathOf(document).map((item) => item.id === document.id ? escapeHtml(item.title) : linkDocument(item)).join(' › ');
    const children = documents.filter((item) => item.parent === document.id);
    files.set(`documents/${safeName(document.id)}.html`, layout(document.title, 'documents', '../', `<p>${crumb}</p><h1>${escapeHtml(document.title)}</h1><p><code>${escapeHtml(document.id)}</code> · ${escapeHtml(document.kind)}</p><article>${markdown(document.body)}</article><h2>配下の文書</h2><ul>${children.map((item) => `<li>${linkDocument(item)} <small>${escapeHtml(item.kind)}</small></li>`).join('') || '<li>0件</li>'}</ul><h2>関連文書</h2><ul>${related.map((item) => `<li>${linkDocument(item)}</li>`).join('') || '<li>0件</li>'}</ul><h2>確認定義</h2><ul>${casesBelow(document).map((item) => `<li>${linkCase(item)}</li>`).join('') || '<li>0件</li>'}</ul><h2>関連ケース</h2><ul>${referenced.map((item) => `<li>${linkCase(item)}</li>`).join('') || '<li>0件</li>'}</ul><p>Source: <code>${escapeHtml(document.location.file)}</code></p>`));
  }
  for (const item of cases) {
    const refs = [item.fields.belongsTo, ...(item.fields.refs ?? [])];
    const parameters = item.source === 'vitest' ? item.parameters : undefined;
    files.set(`cases/${safeName(item.id)}.html`, layout(item.title, 'cases', '../', `<h1>${escapeHtml(item.title)}</h1><p><code>${escapeHtml(item.id)}</code> · ${escapeHtml(item.source)} · ${escapeHtml(item.status)}</p><h2>所属・分類</h2><pre>${pretty(item.fields)}</pre><h2>条件・理由</h2><pre>${pretty(item.details)}</pre>${item.procedure ? `<h2>操作と期待結果</h2><pre>${pretty(item.procedure)}</pre>` : ''}${parameters ? `<h2>each入力表</h2><pre>${pretty(parameters)}</pre>` : ''}<h2>関連する仕様・判断</h2><ul>${refs.flatMap((id) => { const document = byId.get(id); return document ? [`<li>${linkDocument(document)}</li>`] : []; }).join('')}</ul><h2>ソース</h2><p><code>${escapeHtml(item.location.file)}:${item.location.line}</code></p><pre>${escapeHtml(item.snippet)}</pre>`));
  }
  const publicDocuments = documents.map(({ fieldLocations: _fieldLocations, ...document }) => document);
  files.set('assets/style.css', `${catalogStyles}\n[hidden]{display:none!important}\n`);
  files.set('assets/search.js', catalogSearchScript);
  files.set('catalog.json', `${JSON.stringify({ documents: publicDocuments, cases }, null, 2)}\n`);
  files.set('.test-manager-output', 'v1\n');
  return files;
};
