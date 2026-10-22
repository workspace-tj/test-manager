// Browser scripts for the catalog pages. They run as plain scripts (no modules) so the site also works from file://.

const escapeFunction = "const escapeHtml=value=>String(value).replace(/[&<>\"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'})[character]);";
const normalizeFunction = "const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase('ja');const termsOf=value=>normalize(value).trim().split(/\\s+/u).filter(Boolean);";

// Top page: a domain stays visible when its own text matches, and then shows all its features; otherwise only matching features.
export const catalogOverviewScript = `(()=>{${normalizeFunction}
const search=document.querySelector('#search');
const domains=[...document.querySelectorAll('[data-domain-overview]')].map(element=>({element,toggle:element.querySelector('[data-domain-toggle]'),open:false,text:normalize(element.dataset.search??''),features:[...element.querySelectorAll('[data-feature-row]')].map(row=>({row,text:normalize(row.dataset.search??'')}))}));
const empty=document.querySelector('#empty-overview');const expandAll=document.querySelector('#expand-all');
// Only domains with features can fold; the buttons are hidden in the HTML so a page without scripts shows no dead controls.
const foldable=domains.filter(domain=>domain.toggle);for(const domain of foldable)domain.toggle.hidden=false;if(expandAll)expandAll.hidden=foldable.length===0;
// Domains start folded; while a search term is typed, matching features show regardless of folding.
const apply=()=>{const terms=termsOf(search?.value??'');let visible=0;
for(const domain of domains){const domainMatches=terms.every(term=>domain.text.includes(term));let features=0;
for(const feature of domain.features){feature.row.hidden=!(domainMatches||terms.every(term=>feature.text.includes(term)));if(!feature.row.hidden)features+=1}
domain.element.hidden=!(domainMatches||features>0);if(!domain.element.hidden)visible+=1;
const open=domain.open||terms.length>0;if(open)delete domain.element.dataset.collapsed;else domain.element.dataset.collapsed='';
domain.toggle?.setAttribute('aria-expanded',String(open));if(domain.toggle)domain.toggle.disabled=terms.length>0}
if(empty)empty.hidden=visible!==0;if(expandAll){expandAll.textContent=foldable.every(domain=>domain.open)?'すべて閉じる':'すべて開く';expandAll.disabled=terms.length>0}};
for(const domain of domains)domain.toggle?.addEventListener('click',()=>{domain.open=!domain.open;apply()});
expandAll?.addEventListener('click',()=>{const open=!foldable.every(domain=>domain.open);for(const domain of foldable)domain.open=open;apply()});
search?.addEventListener('input',apply);apply();})();
`;

// Case search: every case lives in index-data.js; only the first matches are drawn, so thousands of cases stay responsive.
// The conditions are kept in the URL, so a feature page (or a person) can link to an already narrowed list.
export const catalogSearchScript = `(()=>{${escapeFunction}${normalizeFunction}
const cases=window.testManagerCases??[];const features=window.testManagerFeatures??{};const pageSize=200;
const search=document.querySelector('#search');const filters=[...document.querySelectorAll('[data-filter-key]')];
const domainControls=[...document.querySelectorAll('[data-domain-filter]')];const summary=document.querySelector('#result-summary');
const empty=document.querySelector('#empty-results');const results=document.querySelector('#case-results');const more=document.querySelector('#show-more');
const featureNote=document.querySelector('#feature-filter');
const index=cases.map(item=>normalize(item.search));
const params=new URLSearchParams(location.search);
let domain=params.get('domain')??'';let feature=params.get('feature')??'';let limit=pageSize;
if(!domainControls.some(control=>control.dataset.domainFilter===domain))domain='';
if(!Object.hasOwn(features,feature))feature='';
if(search)search.value=params.get('q')??'';
for(const control of filters){const value=params.get(control.dataset.filterKey);if(value!==null&&[...control.options].some(option=>option.value===value))control.value=value}
const syncUrl=()=>{const next=new URLSearchParams();if(search?.value)next.set('q',search.value);if(domain)next.set('domain',domain);if(feature)next.set('feature',feature);
for(const control of filters)if(control.value)next.set(control.dataset.filterKey,control.value);const query=next.toString();
try{history.replaceState(null,'',query?'?'+query:location.pathname)}catch{}};
const row=item=>'<li data-case-row data-domain="'+escapeHtml(item.domain)+'" data-filters="'+escapeHtml(JSON.stringify(item.filters))+'"><div><small>'+escapeHtml(item.id)+' · '+escapeHtml(item.layer)+' · '+escapeHtml(item.source)+' · '+escapeHtml(item.status)+'</small><a href="'+escapeHtml(item.href)+'">'+escapeHtml(item.title)+'</a></div><span>'+escapeHtml(item.belongsToTitle)+'</span></li>';
const render=()=>{const terms=termsOf(search?.value??'');const matches=[];
cases.forEach((item,position)=>{if(domain&&item.domain!==domain)return;if(feature&&!item.ancestors.includes(feature))return;
if(filters.some(control=>control.value&&String(item.filters[control.dataset.filterKey]??'')!==control.value))return;
if(!terms.every(term=>index[position].includes(term)))return;matches.push(item)});
const totals=new Map();for(const item of matches)totals.set(item.domain,(totals.get(item.domain)??0)+1);
const groups=[];for(const item of matches.slice(0,limit)){let group=groups.at(-1);if(!group||group.domain!==item.domain){group={domain:item.domain,title:item.domainTitle,items:[]};groups.push(group)}group.items.push(item)}
if(results)results.innerHTML=groups.map(group=>'<section class="domain-group" data-domain-group="'+escapeHtml(group.domain)+'"><header><h2>'+escapeHtml(group.title)+'</h2><span>'+totals.get(group.domain)+'ケース</span></header><ul>'+group.items.map(row).join('')+'</ul></section>').join('');
if(summary)summary.textContent=matches.length+'ケース';if(empty)empty.hidden=matches.length!==0;
if(more){const rest=matches.length-limit;more.hidden=rest<=0;more.textContent='さらに'+Math.min(rest,pageSize)+'件を表示（残り'+Math.max(rest,0)+'件）'}
if(featureNote){featureNote.hidden=!feature;const label=featureNote.querySelector('[data-feature-label]');if(label)label.textContent=features[feature]??''}
for(const control of domainControls){const active=(control.dataset.domainFilter??'')===domain;control.classList.toggle('active',active);control.setAttribute('aria-pressed',String(active))}};
const reset=()=>{limit=pageSize;render();syncUrl()};
search?.addEventListener('input',reset);for(const control of filters)control.addEventListener('change',reset);
// A domain button starts over from that domain, so it never combines with a feature of another domain.
for(const control of domainControls)control.addEventListener('click',()=>{domain=control.dataset.domainFilter??'';feature='';reset()});
more?.addEventListener('click',()=>{limit+=pageSize;render()});
featureNote?.querySelector('button')?.addEventListener('click',()=>{feature='';reset()});
render();})();
`;

// Feature pages: narrow the cases under the headings in place; headings show their visible count and hide when empty.
export const catalogDocumentScript = `(()=>{${normalizeFunction}
const root=document.querySelector('[data-case-filter-root]');if(!root)return;
const search=root.querySelector('#case-filter-search');const filters=[...root.querySelectorAll('[data-filter-key]')];
const rows=[...root.querySelectorAll('[data-case-row]')].map(row=>({row,text:normalize(row.dataset.search??''),values:JSON.parse(row.dataset.filters??'{}')}));
const groups=[...root.querySelectorAll('[data-case-group]')].reverse();const summary=root.querySelector('#case-filter-summary');const empty=root.querySelector('#case-filter-empty');const link=root.querySelector('#open-in-search');
const base=link?.getAttribute('href')??'';
const apply=()=>{const terms=termsOf(search?.value??'');let visible=0;
for(const item of rows){item.row.hidden=!(terms.every(term=>item.text.includes(term))&&!filters.some(control=>control.value&&String(item.values[control.dataset.filterKey]??'')!==control.value));if(!item.row.hidden)visible+=1}
for(const group of groups){const count=group.querySelectorAll('[data-case-row]:not([hidden])').length;group.hidden=count===0;const label=group.querySelector('[data-group-count]');if(label)label.textContent=count+'件'}
if(empty)empty.hidden=visible!==0;if(summary)summary.textContent=visible===rows.length?rows.length+'ケース':visible+' / '+rows.length+'ケース';
if(link){const params=new URLSearchParams(base.split('?')[1]??'');if(search?.value)params.set('q',search.value);for(const control of filters)if(control.value)params.set(control.dataset.filterKey,control.value);link.setAttribute('href',base.split('?')[0]+'?'+params.toString())}};
search?.addEventListener('input',apply);for(const control of filters)control.addEventListener('change',apply);apply();})();
`;
