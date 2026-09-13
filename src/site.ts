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

const shell = (title: string, rootPrefix: string, body: string): string => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Test Manager</title><link rel="stylesheet" href="${rootPrefix}assets/style.css"></head>
<body><header><a href="${rootPrefix}index.html">Test Manager</a><nav><a href="${rootPrefix}documents/index.html">領域・仕様</a><a href="${rootPrefix}cases/index.html">ケース</a></nav></header><main>${body}</main></body></html>\n`;

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

export const renderSite = (catalog: Catalog): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  const documents = sortDocumentsForDisplay(catalog.documents, catalog.rules);
  const cases = [...catalog.cases].sort((a, b) => compareText(a.id, b.id));
  const byId = new Map(documents.map((document) => [document.id, document]));
  const values = (select: (item: ManagedCase) => unknown): string[] => [...new Set(cases.map(select).filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String))].sort(compareText);
  const options = (items: ReadonlyArray<string>): string => `<option value="">すべて</option>${items.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}`;
  const filterFields = Object.entries(catalog.rules.case.fields).filter(([, rule]) => rule.placement === 'classification' && rule.type !== 'reference-list').map(([name]) => name).sort(compareText);
  const filterControls = [['source', '情報源', values((item) => item.source)], ['status', '状態', values((item) => item.status)], ...filterFields.map((name) => [name, name, values((item) => item.fields[name])] as const)] as const;
  const caseRows = cases.map((item) => `<tr data-search="${escapeHtml(`${item.id} ${item.title} ${JSON.stringify(item.fields)}`.toLowerCase())}" data-filters="${escapeHtml(JSON.stringify({ source: item.source, status: item.status, ...item.fields }))}"><td>${escapeHtml(item.id)}</td><td>${linkCase(item, '')}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.status)}</td>${filterFields.map((name) => `<td>${escapeHtml(item.fields[name] ?? '')}</td>`).join('')}</tr>`).join('');
  files.set('index.html', shell('概要', '', `<h1>テスト知識カタログ</h1><p>領域・仕様 ${documents.length}件、ケース ${cases.length}件。実行結果は収集していません。</p><section class="filters"><label>検索 <input id="search" type="search"></label>${filterControls.map(([key, label, items]) => `<label>${escapeHtml(label)} <select id="${escapeHtml(key)}-filter" data-filter-key="${escapeHtml(key)}">${options(items)}</select></label>`).join('')}</section><table><thead><tr><th>ID</th><th>ケース</th><th>情報源</th><th>定義状態</th>${filterFields.map((name) => `<th>${escapeHtml(name)}</th>`).join('')}</tr></thead><tbody id="rows">${caseRows}</tbody></table><script src="assets/search.js"></script>`));
  files.set('documents/index.html', shell('領域・仕様', '../', `<h1>領域・仕様</h1><ul>${documents.map((document) => `<li>${linkDocument(document)} <small>${escapeHtml(document.kind)}</small></li>`).join('')}</ul>`));
  files.set('cases/index.html', shell('ケース', '../', `<h1>ケース</h1><ul>${cases.map((item) => `<li>${linkCase(item)} <small>${escapeHtml(item.id)} / ${escapeHtml(item.source)} / ${escapeHtml(item.status)}</small></li>`).join('')}</ul>`));
  for (const document of documents) {
    const belongingCases = cases.filter((item) => item.fields.belongsTo === document.id);
    const referenced = cases.filter((item) => Array.isArray(item.fields.refs) && item.fields.refs.includes(document.id));
    const crumb = breadcrumbs(document, byId).map((item) => item.id === document.id ? escapeHtml(item.title) : linkDocument(item, '../')).join(' › ');
    const relatedDocuments = (document.refs ?? []).flatMap((id) => {
      const related = byId.get(id);
      return related ? [related] : [];
    });
    files.set(`documents/${safeName(document.id)}.html`, shell(document.title, '../', `<p>${crumb}</p><h1>${escapeHtml(document.title)}</h1><p><code>${escapeHtml(document.id)}</code> · ${escapeHtml(document.kind)}</p><article>${markdown(document.body)}</article><h2>関連文書</h2><ul>${relatedDocuments.map((item) => `<li>${linkDocument(item, '../')}</li>`).join('') || '<li>0件</li>'}</ul><h2>所属ケース</h2><ul>${belongingCases.map((item) => `<li>${linkCase(item, '../')}</li>`).join('') || '<li>0件</li>'}</ul><h2>関連ケース</h2><ul>${referenced.map((item) => `<li>${linkCase(item, '../')}</li>`).join('') || '<li>0件</li>'}</ul><p>Source: <code>${escapeHtml(document.location.file)}</code></p>`));
  }
  for (const item of cases) {
    const refs = [item.fields.belongsTo, ...(item.fields.refs ?? [])];
    const parameters = item.source === 'vitest' ? item.parameters : undefined;
    files.set(`cases/${safeName(item.id)}.html`, shell(item.title, '../', `<h1>${escapeHtml(item.title)}</h1><p><code>${escapeHtml(item.id)}</code> · ${escapeHtml(item.source)} · ${escapeHtml(item.status)}</p><h2>所属・分類</h2><pre>${pretty(item.fields)}</pre><h2>条件・理由</h2><pre>${pretty(item.details)}</pre>${item.procedure ? `<h2>操作と期待結果</h2><pre>${pretty(item.procedure)}</pre>` : ''}${parameters ? `<h2>each入力表</h2><pre>${pretty(parameters)}</pre>` : ''}<h2>関連知識</h2><ul>${refs.map((id) => { const document = byId.get(id); return document ? `<li>${linkDocument(document, '../')}</li>` : ''; }).join('')}</ul><h2>ソース</h2><p><code>${escapeHtml(item.location.file)}:${item.location.line}</code></p><pre>${escapeHtml(item.snippet)}</pre>`));
  }
  files.set('assets/style.css', `:root{font-family:ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f6f7fb}body{margin:0}header{display:flex;gap:2rem;align-items:center;padding:1rem 4vw;background:#172033;color:white}header a{color:white;text-decoration:none}nav,.filters{display:flex;gap:1rem}.filters{flex-wrap:wrap;margin:1rem 0}main{max-width:72rem;margin:2rem auto;padding:0 1.5rem}table{width:100%;border-collapse:collapse;background:white}th,td{padding:.7rem;border-bottom:1px solid #ddd;text-align:left}article,pre{background:white;padding:1rem;border-radius:.4rem;overflow:auto}code{font-family:ui-monospace,monospace}small{color:#667085}`);
  files.set('assets/search.js', `const search=document.querySelector('#search');const filters=[...document.querySelectorAll('[data-filter-key]')];const rows=[...document.querySelectorAll('#rows tr')];const apply=()=>{const q=search?.value.toLowerCase()??'';for(const row of rows){const values=JSON.parse(row.dataset.filters);row.hidden=!row.dataset.search.includes(q)||filters.some(control=>control.value&&String(values[control.dataset.filterKey]??'')!==control.value)}};search?.addEventListener('input',apply);for(const filter of filters)filter.addEventListener('change',apply);\n`);
  const publicDocuments = documents.map(({ fieldLocations: _fieldLocations, ...document }) => document);
  files.set('catalog.json', `${JSON.stringify({ documents: publicDocuments, cases }, null, 2)}\n`);
  files.set('.test-manager-output', 'v1\n');
  return files;
};

export const writeSite = async (catalog: Catalog, outPath: string): Promise<void> => {
  await writeManagedFiles(renderSite(catalog), outPath, catalog.projectRoot, 'v1\n');
};
