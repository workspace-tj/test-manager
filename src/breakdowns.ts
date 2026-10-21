import { escapeHtml } from './html.js';
import { caseSources, type FieldRule, type KnowledgeDocument, type ManagedCase, type ProjectRules } from './model.js';

// Axes a breakdown can use besides classification fields: the domain above belongsTo, the layer, and the source kind.
export const breakdownBuiltInAxes = ['domain', 'layer', 'source'] as const;

type AxisEntry = Readonly<{ key: string; label: string }>;
type Axis = Readonly<{ label: string; entries: ReadonlyArray<AxisEntry>; keyOf: (item: ManagedCase) => string | undefined }>;

const unsetKey = '\u0000unset';

export const breakdownFieldAllowed = (rule: Readonly<{ placement: FieldRule['placement']; type: FieldRule['type'] }> | undefined): boolean =>
  rule !== undefined && rule.placement === 'classification' && (rule.type === 'enum' || rule.type === 'integer-enum' || rule.type === 'reference');

const axisFor = (
  name: string,
  rules: ProjectRules,
  documents: ReadonlyArray<KnowledgeDocument>,
  domainOf: (item: ManagedCase) => KnowledgeDocument | undefined,
  pathOf: (document: KnowledgeDocument) => ReadonlyArray<KnowledgeDocument>,
): Axis => {
  if (name === 'domain') {
    return { label: 'ドメイン', entries: documents.filter((document) => document.parent === undefined).map((document) => ({ key: document.id, label: document.title })), keyOf: (item) => domainOf(item)?.id };
  }
  if (name === 'layer') return { label: 'テスト層', entries: rules.discovery.layers.map((layer) => ({ key: layer.name, label: layer.name })), keyOf: (item) => item.layer };
  if (name === 'source') return { label: '記述方式', entries: caseSources.map((source) => ({ key: source, label: source })), keyOf: (item) => item.source };
  const rule = rules.case.fields[name];
  const label = rule?.label ?? name;
  if (rule?.type === 'enum' || rule?.type === 'integer-enum') {
    return { label, entries: Object.entries(rule.values).map(([key, value]) => ({ key, label: value.label ?? key })), keyOf: (item) => item.fields[name] === undefined ? undefined : String(item.fields[name]) };
  }
  // Every target document stays as a row, so documents without cases show up as 0; the path tells same-named levels apart.
  const targets = rule?.type === 'reference' ? rule.targetKinds : [];
  return {
    label,
    entries: documents.filter((document) => targets.includes(document.kind)).map((document) => ({ key: document.id, label: pathOf(document).map((item) => item.title).join(' › ') })),
    keyOf: (item) => typeof item.fields[name] === 'string' ? item.fields[name] : undefined,
  };
};

type Tally = { running: number; stopped: number };

const add = (tally: Tally, item: ManagedCase): void => {
  if (item.status === 'active') tally.running += 1;
  else tally.stopped += 1;
};

const cell = (tally: Tally | undefined): string => {
  const { running = 0, stopped = 0 } = tally ?? {};
  return `<td>${running === 0 && stopped === 0 ? '<span class="breakdown-zero">0</span>' : running}${stopped > 0 ? ` <small>停止 ${stopped}</small>` : ''}</td>`;
};

export const renderBreakdowns = (
  rules: ProjectRules,
  cases: ReadonlyArray<ManagedCase>,
  documents: ReadonlyArray<KnowledgeDocument>,
  domainOf: (item: ManagedCase) => KnowledgeDocument | undefined,
  pathOf: (document: KnowledgeDocument) => ReadonlyArray<KnowledgeDocument>,
): string => {
  const breakdowns = rules.reports?.breakdowns ?? [];
  if (breakdowns.length === 0) return '';
  const tables = breakdowns.map((breakdown) => {
    const rows = axisFor(breakdown.rows, rules, documents, domainOf, pathOf);
    const columns = axisFor(breakdown.columns, rules, documents, domainOf, pathOf);
    const rowKeys = new Set(rows.entries.map((entry) => entry.key));
    const columnKeys = new Set(columns.entries.map((entry) => entry.key));
    const keyIn = (axis: Axis, keys: ReadonlySet<string>, item: ManagedCase): string => {
      const key = axis.keyOf(item);
      return key !== undefined && keys.has(key) ? key : unsetKey;
    };
    const cells = new Map<string, Tally>();
    const rowTotals = new Map<string, Tally>();
    const columnTotals = new Map<string, Tally>();
    const total: Tally = { running: 0, stopped: 0 };
    const tallyOf = (map: Map<string, Tally>, key: string): Tally => {
      const existing = map.get(key);
      if (existing) return existing;
      const created = { running: 0, stopped: 0 };
      map.set(key, created);
      return created;
    };
    for (const item of cases) {
      const row = keyIn(rows, rowKeys, item);
      const column = keyIn(columns, columnKeys, item);
      add(tallyOf(cells, `${row}\u0001${column}`), item);
      add(tallyOf(rowTotals, row), item);
      add(tallyOf(columnTotals, column), item);
      add(total, item);
    }
    const unset = { key: unsetKey, label: '未設定' };
    const rowEntries = rowTotals.has(unsetKey) ? [...rows.entries, unset] : rows.entries;
    const columnEntries = columnTotals.has(unsetKey) ? [...columns.entries, unset] : columns.entries;
    const body = rowEntries.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th>${columnEntries.map((column) => cell(cells.get(`${row.key}\u0001${column.key}`))).join('')}${cell(rowTotals.get(row.key))}</tr>`).join('');
    const totals = `<tr class="breakdown-total"><th scope="row">合計</th>${columnEntries.map((column) => cell(columnTotals.get(column.key))).join('')}${cell(total)}</tr>`;
    return `<div class="breakdown-table"><table><caption>${escapeHtml(`${rows.label} × ${columns.label}`)}</caption><thead><tr><th scope="col">${escapeHtml(rows.label)}</th>${columnEntries.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join('')}<th scope="col">合計</th></tr></thead><tbody>${body}${totals}</tbody></table></div>`;
  }).join('');
  return `<section class="breakdowns" aria-labelledby="breakdowns-heading"><h2 id="breakdowns-heading">集計</h2><p>数は動いているケースです。skip・todo のケースは数に含めず「停止」として示します。</p>${tables}</section>`;
};
