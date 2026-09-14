import type { Catalog, KnowledgeDocument, ManagedCase } from './model.js';
import { sortDocumentsForDisplay } from './documents.js';
import { writeManagedFiles } from './managed-output.js';

const escapeHtml = (value: unknown): string => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const safeName = (value: string): string => encodeURIComponent(value);
const pretty = (value: unknown): string => escapeHtml(JSON.stringify(value, null, 2));
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const markdown = (source: string): string => source.trim().split(/\r?\n/u).map((line) => {
  const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
  if (heading) return `<h${heading[1]?.length}>${escapeHtml(heading[2])}</h${heading[1]?.length}>`;
  return line ? `<p>${escapeHtml(line)}</p>` : '';
}).join('\n');

type SiteSection = 'catalog' | 'documents';

const shell = (title: string, rootPrefix: string, section: SiteSection, body: string): string => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Test Manager</title><link rel="stylesheet" href="${rootPrefix}assets/style.css"></head>
<body><header class="app-header"><div class="header-inner"><a class="brand" href="${rootPrefix}index.html"><span class="brand-mark" aria-hidden="true">✓</span><span>Test Manager</span></a><nav class="segmented-nav" aria-label="カタログナビゲーション"><a href="${rootPrefix}index.html"${section === 'catalog' ? ' aria-current="page"' : ''}>ドメイン</a><a href="${rootPrefix}documents/index.html"${section === 'documents' ? ' aria-current="page"' : ''}>仕様・判断</a></nav><span class="header-spacer" aria-hidden="true"></span></div></header><main>${body}</main></body></html>\n`;

const linkDocument = (document: KnowledgeDocument, prefix = '../'): string => `<a href="${prefix}documents/${safeName(document.id)}.html">${escapeHtml(document.title)}</a>`;
const linkCase = (managedCase: ManagedCase, prefix = '../'): string => `<a href="${prefix}cases/${safeName(managedCase.id)}.html">${escapeHtml(managedCase.title)}</a>`;

const breadcrumbs = (document: KnowledgeDocument, byId: ReadonlyMap<string, KnowledgeDocument>): ReadonlyArray<KnowledgeDocument> => {
  const result: KnowledgeDocument[] = [document];
  let current = document;
  while (current.parent) {
    const parent = byId.get(current.parent);
    if (!parent) break;
    result.unshift(parent);
    current = parent;
  }
  return result;
};

const rootDocument = (document: KnowledgeDocument, byId: ReadonlyMap<string, KnowledgeDocument>): KnowledgeDocument => {
  let current = document;
  while (current.parent) {
    const parent = byId.get(current.parent);
    if (!parent) break;
    current = parent;
  }
  return current;
};

export const renderSite = (catalog: Catalog): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  const documents = sortDocumentsForDisplay(catalog.documents, catalog.rules);
  const cases = [...catalog.cases].sort((a, b) => compareText(a.id, b.id));
  const byId = new Map(documents.map((document) => [document.id, document]));
  const values = (select: (item: ManagedCase) => unknown): string[] => [...new Set(cases.map(select).filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String))].sort(compareText);
  const options = (items: ReadonlyArray<Readonly<{ value: string; label: string }>>): string => `<option value="">すべて</option>${items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('')}`;
  const filterFields = Object.entries(catalog.rules.case.fields).filter(([name, rule]) => name !== 'belongsTo' && rule.placement === 'classification' && rule.type !== 'reference-list').map(([name]) => name).sort(compareText);
  const rawOptions = (items: ReadonlyArray<string>): ReadonlyArray<Readonly<{ value: string; label: string }>> => items.map((value) => ({ value, label: value }));
  const fieldOptions = (name: string): ReadonlyArray<Readonly<{ value: string; label: string }>> => {
    const rule = catalog.rules.case.fields[name];
    return values((item) => item.fields[name]).map((value) => ({
      value,
      label: rule?.type === 'enum' || rule?.type === 'integer-enum' ? rule.values[value]?.label ?? value : value,
    }));
  };
  const filterControls = [
    { key: 'source', label: '確認手段', options: rawOptions(values((item) => item.source)) },
    { key: 'status', label: '定義状態', options: rawOptions(values((item) => item.status)) },
    ...filterFields.map((name) => ({ key: name, label: catalog.rules.case.fields[name]?.label ?? name, options: fieldOptions(name) })),
  ];
  const domainOf = (item: ManagedCase): KnowledgeDocument | undefined => {
    const membership = byId.get(item.fields.belongsTo);
    return membership ? rootDocument(membership, byId) : undefined;
  };
  const rootDocuments = documents
    .filter((document) => document.parent === undefined)
    .map((domain) => ({ domain, cases: cases.filter((item) => domainOf(item)?.id === domain.id) }));
  const domainEntries = rootDocuments
    .filter(({ cases: domainCases }) => domainCases.length > 0);
  const domainNavigation = domainEntries.map(({ domain, cases: domainCases }) => `<button type="button" data-domain-filter="${escapeHtml(domain.id)}" aria-pressed="false"><span>${escapeHtml(domain.title)}</span><small>${domainCases.length}</small></button>`).join('');
  const domainOverview = rootDocuments.map(({ domain, cases: domainCases }) => {
    const features = documents.filter((document) => document.parent === domain.id);
    const summary = domain.body.trim().split(/\r?\n/u).find((line) => line.trim() && !line.startsWith('#')) ?? '';
    const featureItems = features.map((feature) => {
      const featureCases = cases.filter((item) => {
        const membership = byId.get(item.fields.belongsTo);
        return membership ? breadcrumbs(membership, byId).some((document) => document.id === feature.id) : false;
      });
      return `<li>${linkDocument(feature, '')}<small>${featureCases.length}ケース</small></li>`;
    }).join('');
    const searchText = [domain.title, summary, ...features.map((feature) => feature.title), ...domainCases.flatMap((item) => [item.id, item.title])].join(' ');
    return `<section class="domain-overview" data-domain-overview="${escapeHtml(domain.id)}" data-search="${escapeHtml(searchText)}"><header><h2>${linkDocument(domain, '')}</h2><span>${domainCases.length}ケース</span></header><p>${escapeHtml(summary)}</p>${featureItems ? `<ul>${featureItems}</ul>` : ''}</section>`;
  }).join('');
  const domainGroups = domainEntries.map(({ domain, cases: domainCases }) => {
    const rows = domainCases.map((item) => {
      const membership = byId.get(item.fields.belongsTo);
      const path = membership ? breadcrumbs(membership, byId).map((document) => document.title).join(' ') : '';
      const searchText = `${item.id} ${item.title} ${path} ${JSON.stringify(item.fields)}`;
      return `<li data-case-row data-domain="${escapeHtml(domain.id)}" data-search="${escapeHtml(searchText)}" data-filters="${escapeHtml(JSON.stringify({ source: item.source, status: item.status, ...item.fields }))}"><div><small>${escapeHtml(item.id)} · ${escapeHtml(item.source)} · ${escapeHtml(item.status)}</small>${linkCase(item, '')}</div><span>${escapeHtml(membership?.title ?? item.fields.belongsTo)}</span></li>`;
    }).join('');
    return `<section class="domain-group" data-domain-group="${escapeHtml(domain.id)}"><header><h2>${escapeHtml(domain.title)}</h2><span>${domainCases.length}ケース</span></header><ul>${rows}</ul></section>`;
  }).join('');
  const renderDocumentTree = (parent: string | undefined): string => {
    const children = documents.filter((document) => document.parent === parent);
    if (children.length === 0) return '';
    return `<ul>${children.map((document) => `<li><div>${linkDocument(document)}</div>${renderDocumentTree(document.id)}</li>`).join('')}</ul>`;
  };
  files.set('index.html', shell('ドメイン', '', 'catalog', `<div class="catalog-intro"><h1>ドメインから確認内容をたどる</h1><label class="global-search"><span>検索</span><input id="search" type="search" placeholder="ドメイン、feature、ケースを検索"></label><strong><span>${documents.length}</span>文書 <span>${cases.length}</span>ケース</strong></div><div class="domain-overviews">${domainOverview}</div><section class="case-finder"><div class="finder-heading"><h2>ケースを直接探す</h2></div><div class="catalog-layout"><aside class="domain-index"><button class="active" type="button" data-domain-filter="" aria-pressed="true"><span>すべて</span><small>${cases.length}</small></button>${domainNavigation}</aside><div class="catalog-content"><section class="filters">${filterControls.map(({ key, label, options: items }) => `<label><span>${escapeHtml(label)}</span><select id="${escapeHtml(key)}-filter" data-filter-key="${escapeHtml(key)}">${options(items)}</select></label>`).join('')}</section><p class="result-summary" id="result-summary" aria-live="polite">${cases.length}ケース</p><div id="domain-groups">${domainGroups}</div><p class="empty-results" id="empty-results" hidden>条件に一致するケースはありません。</p></div></div></section><script src="assets/search.js"></script>`));
  files.set('documents/index.html', shell('仕様・判断', '../', 'documents', `<div class="page-heading"><h1>仕様・判断</h1></div><nav class="document-tree" aria-label="仕様と判断の階層">${renderDocumentTree(undefined)}</nav>`));
  for (const document of documents) {
    const descendantCases = cases.filter((item) => {
      const membership = byId.get(item.fields.belongsTo);
      return membership ? breadcrumbs(membership, byId).some((ancestor) => ancestor.id === document.id) : false;
    });
    const referenced = cases.filter((item) => Array.isArray(item.fields.refs) && item.fields.refs.includes(document.id));
    const crumb = breadcrumbs(document, byId).map((item) => item.id === document.id ? escapeHtml(item.title) : linkDocument(item, '../')).join(' › ');
    const relatedDocuments = (document.refs ?? []).flatMap((id) => {
      const related = byId.get(id);
      return related ? [related] : [];
    });
    const childDocuments = documents.filter((item) => item.parent === document.id);
    files.set(`documents/${safeName(document.id)}.html`, shell(document.title, '../', 'documents', `<p>${crumb}</p><h1>${escapeHtml(document.title)}</h1><p><code>${escapeHtml(document.id)}</code> · ${escapeHtml(document.kind)}</p><article>${markdown(document.body)}</article><h2>配下の文書</h2><ul>${childDocuments.map((item) => `<li>${linkDocument(item, '../')} <small>${escapeHtml(item.kind)}</small></li>`).join('') || '<li>0件</li>'}</ul><h2>関連文書</h2><ul>${relatedDocuments.map((item) => `<li>${linkDocument(item, '../')}</li>`).join('') || '<li>0件</li>'}</ul><h2>確認定義</h2><ul>${descendantCases.map((item) => `<li>${linkCase(item, '../')}</li>`).join('') || '<li>0件</li>'}</ul><h2>関連ケース</h2><ul>${referenced.map((item) => `<li>${linkCase(item, '../')}</li>`).join('') || '<li>0件</li>'}</ul><p>Source: <code>${escapeHtml(document.location.file)}</code></p>`));
  }
  for (const item of cases) {
    const refs = [item.fields.belongsTo, ...(item.fields.refs ?? [])];
    const parameters = item.source === 'vitest' ? item.parameters : undefined;
    files.set(`cases/${safeName(item.id)}.html`, shell(item.title, '../', 'catalog', `<h1>${escapeHtml(item.title)}</h1><p><code>${escapeHtml(item.id)}</code> · ${escapeHtml(item.source)} · ${escapeHtml(item.status)}</p><h2>所属・分類</h2><pre>${pretty(item.fields)}</pre><h2>条件・理由</h2><pre>${pretty(item.details)}</pre>${item.procedure ? `<h2>操作と期待結果</h2><pre>${pretty(item.procedure)}</pre>` : ''}${parameters ? `<h2>each入力表</h2><pre>${pretty(parameters)}</pre>` : ''}<h2>関連する仕様・判断</h2><ul>${refs.map((id) => { const document = byId.get(id); return document ? `<li>${linkDocument(document, '../')}</li>` : ''; }).join('')}</ul><h2>ソース</h2><p><code>${escapeHtml(item.location.file)}:${item.location.line}</code></p><pre>${escapeHtml(item.snippet)}</pre>`));
  }
  files.set('assets/style.css', `:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;color:#1d1d1f;background:#f5f5f7}*{box-sizing:border-box}body{margin:0}.app-header{height:60px;padding:0 24px;background:rgba(250,250,252,.92);border-bottom:1px solid #d9d9df}.header-inner{width:min(1120px,100%);min-height:60px;margin:auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:24px}.brand{width:max-content;display:inline-flex;align-items:center;gap:9px;color:#1d1d1f;font-size:14px;font-weight:600;text-decoration:none}.brand-mark{width:25px;height:25px;display:grid;place-items:center;color:white;background:#1d1d1f;border-radius:7px;font-size:13px}.segmented-nav{padding:3px;display:flex;gap:2px;background:rgba(118,118,128,.12);border-radius:10px}.segmented-nav a{min-width:90px;padding:6px 13px;color:#6e6e73;border-radius:8px;font-size:12px;font-weight:500;text-align:center;text-decoration:none}.segmented-nav a[aria-current="page"]{color:#1d1d1f;background:white;box-shadow:0 1px 3px rgba(0,0,0,.08),0 .5px 0 rgba(0,0,0,.05)}main{max-width:76rem;margin:3rem auto;padding:0 1.5rem}.catalog-intro{display:flex;justify-content:space-between;align-items:end;gap:2rem;margin-bottom:2rem}.catalog-intro h1{margin:0;font-size:2rem}.global-search{width:min(28rem,45vw);display:grid;gap:.35rem;color:#667085;font-size:.7rem}.global-search input{height:2.6rem;padding:0 .8rem;border:1px solid #d0d5dd;border-radius:.55rem;background:white;color:#172033}.catalog-intro p,.page-heading p{margin:0;color:#667085}.catalog-intro strong{display:flex;gap:.4rem;align-items:baseline;color:#667085;font-size:.78rem;font-weight:500;white-space:nowrap}.catalog-intro strong span{color:#172033;font-size:1.4rem}.domain-overviews{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:48px}.domain-overview{padding:20px;background:white;border:1px solid #e4e7ec;border-radius:14px}.domain-overview header{display:flex;justify-content:space-between;align-items:end}.domain-overview h2{margin:3px 0;font-size:20px}.domain-overview h2 a{color:#1d1d1f;text-decoration:none}.domain-overview header small,.domain-overview header span,.domain-overview>p,.domain-overview li small,.finder-heading p{color:#6e6e73;font-size:12px}.domain-overview ul{margin:16px 0 0;padding:0;list-style:none}.domain-overview li{padding:9px 0;display:flex;justify-content:space-between;border-top:1px solid #e4e7ec}.domain-overview li a{color:#06c;text-decoration:none}.case-finder{padding-top:32px;border-top:1px solid #d9d9df}.finder-heading{margin-bottom:18px}.finder-heading h2{margin:0 0 4px}.finder-heading p{margin:0}.catalog-layout{display:grid;grid-template-columns:13rem minmax(0,1fr);gap:2rem;align-items:start}.domain-index{position:sticky;top:1.5rem;padding:.65rem;background:#e9edf3;border-radius:.8rem}.domain-index p{margin:.45rem .65rem .55rem;color:#667085;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.domain-index button{width:100%;padding:.7rem .75rem;display:flex;justify-content:space-between;border:0;border-radius:.55rem;color:#475467;background:transparent;text-align:left;cursor:pointer}.domain-index button.active{color:#172033;background:white;box-shadow:0 1px 3px #17203318}.domain-index small{color:#8791a2}.filters{display:grid;grid-template-columns:minmax(16rem,1fr) repeat(4,minmax(7rem,auto));gap:.65rem;padding:1rem;background:white;border:1px solid #e4e7ec;border-radius:.8rem}.filters label{display:grid;gap:.35rem;color:#667085;font-size:.7rem}.filters input,.filters select{height:2.35rem;padding:0 .7rem;border:1px solid #d0d5dd;border-radius:.45rem;background:white;color:#172033}.global-search input:focus,.filters select:focus,.domain-index button:focus-visible{outline:2px solid #1570ef;outline-offset:2px}.result-summary{margin:1rem .2rem;color:#667085;font-size:.78rem}.domain-group{margin-bottom:1.25rem;overflow:hidden;background:white;border:1px solid #e4e7ec;border-radius:.8rem}.domain-group>header{padding:1rem 1.15rem;display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid #e4e7ec}.domain-group h2{margin:.15rem 0 0;font-size:1.15rem}.domain-group header small,.domain-group header span{color:#667085;font-size:.72rem}.domain-group ul{margin:0;padding:0;list-style:none}.domain-group li{min-height:4rem;padding:.75rem 1.15rem;display:grid;grid-template-columns:minmax(0,1fr) minmax(8rem,auto);gap:1rem;align-items:center}.domain-group li+li{border-top:1px solid #edf0f3}.domain-group li div{display:grid;gap:.25rem}.domain-group li small,.domain-group li>span{color:#667085;font-size:.7rem}.domain-group li a{overflow:hidden;color:#172033;text-decoration:none;text-overflow:ellipsis;white-space:nowrap}.domain-group li a:hover{text-decoration:underline}.empty-results{padding:2.5rem;text-align:center;color:#667085;background:white;border:1px dashed #cbd1db;border-radius:.8rem}.page-heading{margin-bottom:24px}.page-heading h1{margin:0 0 6px}.document-tree>ul{margin:0;padding:0;list-style:none}.document-tree li{margin-top:8px}.document-tree li>div{padding:14px 16px;display:flex;justify-content:space-between;background:white;border:1px solid #e4e7ec;border-radius:10px}.document-tree li a{color:#1d1d1f;font-weight:600;text-decoration:none}.document-tree li>ul{margin:8px 0 0 24px;padding-left:18px;border-left:2px solid #d9d9df;list-style:none}article,pre{background:white;padding:1rem;border-radius:.4rem;overflow:auto}code{font-family:ui-monospace,monospace}small{color:#667085}@media(max-width:800px){.domain-overviews{grid-template-columns:1fr}.app-header{padding-inline:14px}.header-inner{grid-template-columns:auto 1fr}.header-spacer{display:none}.segmented-nav{justify-self:end}.segmented-nav a{min-width:0;padding-inline:10px}main{margin-top:2rem}.catalog-layout{grid-template-columns:1fr}.domain-index{position:static;display:flex;gap:.35rem;overflow-x:auto}.domain-index p{display:none}.domain-index button{width:auto;min-width:max-content;gap:.8rem}.filters{grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}}@media(max-width:520px){.header-inner{display:flex;flex-wrap:wrap;padding:8px 0}.app-header{height:auto}.brand{flex:1}.segmented-nav{width:100%;order:3}.segmented-nav a{flex:1}.catalog-intro{align-items:stretch;flex-direction:column}.global-search{width:100%}.filters{grid-template-columns:1fr}.search-field{grid-column:auto}.domain-group li{grid-template-columns:1fr}.domain-group li>span{grid-row:1;font-size:.68rem}.catalog-intro strong{display:none}.document-tree li>ul{margin-left:10px;padding-left:10px}}`);
  files.set('assets/search.js', `const search=document.querySelector('#search');const filters=[...document.querySelectorAll('[data-filter-key]')];const overviews=[...document.querySelectorAll('[data-domain-overview]')];const rows=[...document.querySelectorAll('[data-case-row]')];const groups=[...document.querySelectorAll('[data-domain-group]')];const domainControls=[...document.querySelectorAll('[data-domain-filter]')];const summary=document.querySelector('#result-summary');const empty=document.querySelector('#empty-results');let domain='';const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase('ja');const overviewIndex=new Map(overviews.map(overview=>[overview,normalize(overview.dataset.search??'')]));const searchIndex=new Map(rows.map(row=>[row,normalize(row.dataset.search??'')]));const filterIndex=new Map(rows.map(row=>[row,JSON.parse(row.dataset.filters)]));const apply=()=>{const terms=normalize(search?.value??'').trim().split(/\\s+/u).filter(Boolean);for(const overview of overviews){const haystack=overviewIndex.get(overview)??'';overview.hidden=Boolean(domain&&overview.dataset.domainOverview!==domain)||!terms.every(term=>haystack.includes(term))}const visibleDomains=new Set();let visible=0;for(const row of rows){const values=filterIndex.get(row);const haystack=searchIndex.get(row)??'';const matchesDomain=!domain||row.dataset.domain===domain;const matchesTerms=terms.every(term=>haystack.includes(term));const matchesFilters=!filters.some(control=>control.value&&String(values?.[control.dataset.filterKey]??'')!==control.value);row.hidden=!(matchesDomain&&matchesTerms&&matchesFilters);if(!row.hidden){visible+=1;visibleDomains.add(row.dataset.domain)}}for(const group of groups)group.hidden=!visibleDomains.has(group.dataset.domainGroup);if(summary)summary.textContent=visible+'ケース';if(empty)empty.hidden=visible!==0};search?.addEventListener('input',apply);for(const filter of filters)filter.addEventListener('change',apply);for(const control of domainControls)control.addEventListener('click',()=>{domain=control.dataset.domainFilter??'';for(const item of domainControls){const active=item===control;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))}apply()});apply();\n`);
  const publicDocuments = documents.map(({ fieldLocations: _fieldLocations, ...document }) => document);
  files.set('catalog.json', `${JSON.stringify({ documents: publicDocuments, cases }, null, 2)}\n`);
  files.set('.test-manager-output', 'v1\n');
  return files;
};

export const writeSite = async (catalog: Catalog, outPath: string): Promise<void> => {
  await writeManagedFiles(renderSite(catalog), outPath, catalog.projectRoot, 'v1\n');
};
