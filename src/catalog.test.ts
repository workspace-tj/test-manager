import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { loadRules } from './rules.js';
import { renderSite, writeSite } from './site.js';

const fixture = path.resolve('fixtures/valid');
const executeFile = promisify(execFile);

describe('project catalog', () => {
  it('runs the built CLI from a consumer directory without resolving consumer dependencies', async () => {
    const consumer = await mkdtemp(path.join(tmpdir(), 'test-manager-consumer-'));
    const incompatibleZod = path.join(consumer, 'node_modules/zod');
    await mkdir(incompatibleZod, { recursive: true });
    await writeFile(
      path.join(incompatibleZod, 'package.json'),
      `${JSON.stringify({ name: 'zod', version: '0.0.0', type: 'module', exports: { '.': './index.js' } })}\n`,
      'utf8',
    );
    await writeFile(path.join(incompatibleZod, 'index.js'), 'export {};\n', 'utf8');
    try {
      const output = path.join(consumer, 'site');
      await executeFile(process.execPath, [path.resolve('dist/cli-entry.js'), 'build', '--config', path.join(fixture, 'test-manager.yaml'), '--out', output], { cwd: consumer });
      expect(await readdir(consumer)).toEqual(['node_modules', 'site']);
      expect(await readdir(output)).toContain('index.html');
    } finally {
      await rm(consumer, { recursive: true, force: true });
    }
  });

  it('renders without spawning a child process or creating framework temporary output', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const workingDirectory = process.cwd();
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('test-manager-astro-')));
    const previousNodeOptions = process.env.NODE_OPTIONS;
    try {
      process.env.NODE_OPTIONS = '--test-manager-invalid-option';
      expect((await renderSite(result.catalog)).has('index.html')).toBe(true);
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
    }
    expect(process.cwd()).toBe(workingDirectory);
    expect(new Set((await readdir(tmpdir())).filter((name) => name.startsWith('test-manager-astro-')))).toEqual(before);
  });

  it('loads documents, a one-file manual case, Vitest, Playwright, and Storybook without executing source', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.documents.map((item) => item.id)).toEqual(['catalog', 'cancellation-eligibility', 'order-cancellation', 'orders']);
    expect(result.catalog.documents.map((item) => [item.id, item.kind, item.parent])).toEqual([
      ['catalog', 'domain', undefined],
      ['cancellation-eligibility', 'decision', 'order-cancellation'],
      ['order-cancellation', 'feature', 'orders'],
      ['orders', 'domain', undefined],
    ]);
    expect(result.catalog.rules.case.fields.belongsTo).toMatchObject({ type: 'reference', targetKinds: ['domain', 'feature'] });
    expect(result.catalog.rules.documents.displayOrder.domain).toEqual(['orders', 'catalog']);
    expect(result.catalog.documents.find((item) => item.id === 'orders')?.refs).toEqual(['catalog']);
    expect(result.catalog.cases.map((item) => [item.id, item.source, item.status])).toEqual([
      ['CASE-101', 'manual', 'active'],
      ['CASE-201', 'playwright', 'active'],
      ['CASE-001', 'vitest', 'active'],
      ['CASE-002', 'vitest', 'active'],
      ['CASE-003', 'vitest', 'todo'],
      ['CASE-301', 'storybook', 'skip'],
    ]);
    const eachCase = result.catalog.cases.find((item) => item.id === 'CASE-002');
    expect(eachCase?.source === 'vitest' ? eachCase.parameters : undefined).toEqual([[0, false], [1, true]]);
  });

  it('checks and renders a second project vocabulary end to end', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-alternate-project-'));
    const config = (await readFile(path.resolve('fixtures/alternate-rules.yaml'), 'utf8'))
      .replace('fixtures/none/**/*.md', 'knowledge/**/*.md')
      .replace('sources: {}', 'sources:\n    manual:\n      manual: ["knowledge/**/*.manual.yaml"]');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.join(root, 'knowledge'), { recursive: true }));
    await writeFile(path.join(root, 'test-manager.yaml'), config, 'utf8');
    await writeFile(path.join(root, 'knowledge/module.md'), `---\nid: MOD-1\nkind: module\ntitle: Module one\n---\n`, 'utf8');
    await writeFile(path.join(root, 'knowledge/module-two.md'), `---\nid: MOD-2\nkind: module\ntitle: Module two\n---\n`, 'utf8');
    await writeFile(path.join(root, 'knowledge/case.manual.yaml'), `id: CASE-1\ntitle: alternate\nbelongsTo: MOD-1\nrole: contract\nimpact: 20\nsteps:\n  - action: act\n    expected: done\n`, 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await renderSite(result.catalog)).get('cases/index.html')).toContain('>20<');
    const documentIndex = (await renderSite(result.catalog)).get('documents/index.html') ?? '';
    expect(documentIndex.indexOf('Module two')).toBeLessThan(documentIndex.indexOf('Module one'));
  });

  it.each([
    ['manual', /\.manual\.yaml$/u],
    ['vitest', /\.test\.ts$/u],
    ['playwright', /\.spec\.ts$/u],
    ['storybook', /\.stories\.tsx$/u],
  ])('requires a field only for %s cases when requiredWhen targets the source', async (source, filePattern) => {
    const root = await mkdtemp(path.join(tmpdir(), `test-manager-source-condition-${source}-`));
    await cp(fixture, root, { recursive: true });
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, (await readFile(config, 'utf8')).replace('    reason: {', `    sourceNote: { required: false, placement: detail, type: text, requiredWhen: { field: source, equals: ${source} } }\n    reason: {`), 'utf8');
    const result = await checkProject(config);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const missing = result.diagnostics.filter((item) => item.code === 'TM121' && item.subject === 'sourceNote');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((item) => filePattern.test(item.location.file))).toBe(true);
  });

  it('assigns each case the layer of the discovery source that found it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-layer-split-'));
    await cp(fixture, root, { recursive: true });
    await cp(path.join(root, 'src/cancel.test.ts'), path.join(root, 'src/cancel.integration.test.ts'));
    const integrationFile = path.join(root, 'src/cancel.integration.test.ts');
    await writeFile(integrationFile, (await readFile(integrationFile, 'utf8')).replace(/CASE-(\d{3})/gu, (_, digits: string) => `CASE-${String(Number(digits) + 500).padStart(3, '0')}`), 'utf8');
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, (await readFile(config, 'utf8')).replace(
      '    unit:\n      vitest: ["src/**/*.test.ts"]',
      '    unit:\n      vitest: ["src/**/!(*.integration).test.ts"]\n    integration:\n      vitest: ["src/**/*.integration.test.ts"]',
    ), 'utf8');
    const result = await checkProject(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const layers = new Map(result.catalog.cases.map((item) => [item.location.file, `${item.source}/${item.layer}`]));
    expect(layers.get('src/cancel.test.ts')).toBe('vitest/unit');
    expect(layers.get('src/cancel.integration.test.ts')).toBe('vitest/integration');
    expect([...layers.entries()].find(([file]) => file.endsWith('.manual.yaml'))?.[1]).toBe('manual/e2e');
  });

  it('requires a field only for cases in the layer named by requiredWhen', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-layer-condition-'));
    await cp(fixture, root, { recursive: true });
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, (await readFile(config, 'utf8')).replace('    reason: {', '    layerNote: { required: false, placement: detail, type: text, requiredWhen: { field: layer, equals: e2e } }\n    reason: {'), 'utf8');
    const result = await checkProject(config);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const missing = result.diagnostics.filter((item) => item.code === 'TM121' && item.subject === 'layerNote');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((item) => /\.(?:manual\.yaml|spec\.ts)$/u.test(item.location.file))).toBe(true);
    expect(missing.some((item) => item.location.file.endsWith('.manual.yaml'))).toBe(true);
    expect(missing.some((item) => item.location.file.endsWith('.spec.ts'))).toBe(true);
  });

  it('shows keyed notes with their labels on case pages and lets the case search filter by key', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-keyed-notes-'));
    await cp(fixture, root, { recursive: true });
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, (await readFile(config, 'utf8')).replace('    reason: {', '    todo: { required: false, placement: detail, type: keyed-text-list, label: 直すべき点, values: { spec: { label: 仕様の確認, description: 仕様を確かめる }, duplicate: { label: 重複, description: 同じことを確かめている } } }\n    reason: {'), 'utf8');
    const manual = path.join(root, 'knowledge/order-cancellation/operator.manual.yaml');
    await writeFile(manual, `${await readFile(manual, 'utf8')}todo:\n  - spec: "出荷済みの判定に返品中を含めるか確かめる"\n`, 'utf8');
    const result = await checkProject(config);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const site = await renderSite(result.catalog);
    expect(site.get('cases/CASE-101.html')).toContain('<li><span class="keyed-label">仕様の確認</span>出荷済みの判定に返品中を含めるか確かめる</li>');
    const search = site.get('cases/index.html') ?? '';
    expect(search).toContain('<span>直すべき点</span><select id="todo-filter" data-filter-key="todo"><option value="">すべて</option><option value="spec">仕様の確認</option></select>');
    expect(site.get('cases/index-data.js')).toContain('"todo":["spec"]');
  });

  it('renders configured breakdown tables that count running cases and show stopped ones apart', async () => {
    const plain = await checkProject(path.join(fixture, 'test-manager.yaml'));
    if (!plain.ok) throw new Error('fixture catalog must be valid');
    expect((await renderSite(plain.catalog)).get('index.html')).not.toContain('class="breakdowns"');
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-breakdowns-'));
    await cp(fixture, root, { recursive: true });
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, `${await readFile(config, 'utf8')}reports:\n  breakdowns:\n    - { rows: domain, columns: impact }\n    - { rows: layer, columns: role }\n`, 'utf8');
    const result = await checkProject(config);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const index = (await renderSite(result.catalog)).get('index.html') ?? '';
    const tables = [...index.matchAll(/<table>(.*?)<\/table>/gu)].map((match) => match[1] ?? '');
    expect(tables).toHaveLength(2);
    const text = (html: string) => html.replace(/<[^>]+>/gu, '|').replace(/\|+/gu, '|');
    const statuses = result.catalog.cases.map((item) => item.status);
    const stopped = statuses.filter((status) => status !== 'active').length;
    expect(stopped).toBeGreaterThan(0);
    expect(text(tables[0] ?? '')).toContain('|ドメイン × 影響度|');
    expect(text(tables[0] ?? '')).toContain(`|合計|`);
    expect(tables[0]).toContain(`<td>${result.catalog.cases.length - stopped} <small>停止 ${stopped}</small></td></tr></tbody>`);
    expect(text(tables[1] ?? '')).toContain('|テスト層 × 確認担当|');
    expect(text(tables[1] ?? '')).toContain('|プロダクト|');
  });

  it('keeps every breakdown cell consistent with its totals, and shows unset values and document paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-breakdown-cells-'));
    await cp(fixture, root, { recursive: true });
    const config = path.join(root, 'test-manager.yaml');
    const source = (await readFile(config, 'utf8')).replace('    reason: {', '    tier: { required: false, placement: classification, type: enum, values: { gold: { description: gold } } }\n    reason: {');
    await writeFile(config, `${source}reports:\n  breakdowns:\n    - { rows: belongsTo, columns: impact }\n    - { rows: tier, columns: source }\n`, 'utf8');
    const result = await checkProject(config);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const index = (await renderSite(result.catalog)).get('index.html') ?? '';
    const tables = [...index.matchAll(/<table>(.*?)<\/table>/gu)].map((match) => match[1] ?? '');
    const grid = (table: string) => [...table.matchAll(/<tr[^>]*>(.*?)<\/tr>/gu)].slice(1).map((row) => ({
      label: /<th scope="row">(.*?)<\/th>/u.exec(row[1] ?? '')?.[1] ?? '',
      counts: [...(row[1] ?? '').matchAll(/<td>(?:<span class="breakdown-zero">)?(\d+)/gu)].map((match) => Number(match[1])),
    }));
    const first = grid(tables[0] ?? '');
    expect(first.map((row) => row.label)).toContain('受注 › 注文取消');
    for (const row of first) expect(row.counts.slice(0, -1).reduce((sum, count) => sum + count, 0)).toBe(row.counts.at(-1));
    const totals = first.at(-1)?.counts ?? [];
    expect(first.slice(0, -1).reduce((sum, row) => sum + (row.counts.at(-1) ?? 0), 0)).toBe(totals.at(-1));
    const running = result.catalog.cases.filter((item) => item.status === 'active').length;
    expect(totals.at(-1)).toBe(running);
    const second = grid(tables[1] ?? '');
    expect(second.map((row) => row.label)).toEqual(['gold', '未設定', '合計']);
    expect(second[1]?.counts.at(-1)).toBe(running);
    expect(tables[1]).toContain('<th scope="col">manual</th><th scope="col">vitest</th><th scope="col">playwright</th><th scope="col">storybook</th>');
  });

  it('rejects breakdown axes that are not built in or classification enum and reference fields', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-breakdown-rules-'));
    const source = await readFile(path.join(fixture, 'test-manager.yaml'), 'utf8');
    for (const [name, breakdown, subject] of [
      ['unknown', '{ rows: domain, columns: missing }', 'reports.breakdowns.0.columns'],
      ['detail', '{ rows: reason, columns: layer }', 'reports.breakdowns.0.rows'],
      ['same', '{ rows: layer, columns: layer }', 'reports.breakdowns.0.columns'],
    ] as const) {
      const config = path.join(root, `${name}.yaml`);
      await writeFile(config, `${source}reports:\n  breakdowns:\n    - ${breakdown}\n`, 'utf8');
      const loaded = await loadRules(config);
      expect(loaded.rules, name).toBeUndefined();
      expect(loaded.diagnostics.map((item) => item.subject), name).toContain(subject);
    }
  });

  it('lists layer descriptions on the top page only when a layer has one', async () => {
    const plain = await checkProject(path.join(fixture, 'test-manager.yaml'));
    if (!plain.ok) throw new Error('fixture catalog must be valid');
    expect((await renderSite(plain.catalog)).get('index.html')).not.toContain('layer-definitions');
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-layer-description-'));
    await cp(fixture, root, { recursive: true });
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, (await readFile(config, 'utf8')).replace('    unit:\n', '    unit:\n      description: Runs <without> a database\n'), 'utf8');
    const described = await checkProject(config);
    if (!described.ok) throw new Error('described catalog must be valid');
    expect((await renderSite(described.catalog)).get('index.html')).toContain('<dl><dt>unit</dt><dd>Runs &lt;without&gt; a database</dd></dl>');
  });

  it('shows case fields by their labels and manual steps as a numbered table', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    if (!result.ok) throw new Error('fixture catalog must be valid');
    const page = (await renderSite(result.catalog)).get('cases/CASE-101.html') ?? '';
    expect(page).toContain('<dt>確認担当</dt><dd>プロダクト <small>product</small></dd>');
    expect(page).toMatch(/<dt>belongsTo<\/dt><dd><a href="\.\.\/documents\/[^"]+\.html">[^<]+<\/a><\/dd>/u);
    expect(page).toContain('<table class="case-procedure"><thead><tr><th scope="col">#</th><th scope="col">操作</th><th scope="col">期待結果</th></tr></thead><tbody><tr><th scope="row">1</th>');
    expect(page).not.toContain('&quot;belongsTo&quot;');
  });

  it('groups a document page by characteristic, then path, in the order the config lists their values', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    if (!result.ok) throw new Error('fixture catalog must be valid');
    const { catalog } = result;
    const enumRule = (values: string[]) => ({ type: 'enum' as const, placement: 'classification' as const, required: false, values: Object.fromEntries(values.map((value) => [value, { label: `L-${value}`, description: value }])) });
    const [first, second, third] = catalog.cases;
    if (!first || !second || !third) throw new Error('fixture must contain three cases');
    const document = first.fields.belongsTo;
    const fields = [{ characteristic: 'security', path: 'normal' }, { characteristic: 'functional', path: 'error' }, { path: 'normal' }];
    const grouped = { ...catalog, rules: { ...catalog.rules, case: { ...catalog.rules.case, fields: { ...catalog.rules.case.fields, characteristic: enumRule(['functional', 'security']), path: enumRule(['normal', 'error']) } } },
      cases: catalog.cases.map((item, index) => index < 3 ? { ...item, fields: { ...item.fields, belongsTo: document, ...fields[index] } } : item) } as typeof catalog;
    const page = (await renderSite(grouped)).get(`documents/${document}.html`) ?? '';
    const headings = [...page.matchAll(/<h([34])>([^<]+) <small data-group-count>(\d+)件<\/small><\/h\1>/gu)].map((match) => `${match[1]}:${match[2]}:${match[3]}`);
    expect(headings.slice(0, 4)).toEqual(['3:L-functional:1', '4:L-error:1', '3:L-security:1', '4:L-normal:1']);
    expect(headings[4]).toMatch(/^3:未設定:\d+$/u);
    expect(headings[5]).toBe('4:L-normal:1');
    const pathOnly = { ...grouped, rules: { ...grouped.rules, case: { ...grouped.rules.case, fields: { ...catalog.rules.case.fields, path: enumRule(['normal', 'error']) } } },
      cases: grouped.cases.map((item, index) => index === 1 ? { ...item, fields: { ...item.fields, path: 'unknown' } } : item) } as typeof catalog;
    const pathPage = (await renderSite(pathOnly)).get(`documents/${document}.html`) ?? '';
    expect([...pathPage.matchAll(/<h([34])>([^<]+) <small data-group-count>/gu)].map((match) => `${match[1]}:${match[2]}`)).toEqual(['3:L-normal', '3:未設定']);
    const flat = (await renderSite(catalog)).get(`documents/${document}.html`) ?? '';
    expect(flat).not.toMatch(/<h[34]>/u);
    expect(flat).toMatch(/<li data-case-row [^>]+><a href="\.\.\/cases\/[^"]+\.html">[^<]+<\/a><small>[^<]+ · [^<]+<\/small><\/li>/u);
  });

  it('escapes field values and marks references to missing documents on case pages', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    if (!result.ok) throw new Error('fixture catalog must be valid');
    const [first] = result.catalog.cases;
    if (!first) throw new Error('fixture must contain a case');
    const altered = { ...result.catalog, cases: [{ ...first, fields: { ...first.fields, refs: ['orders', 'gone'], note: '<b>&x</b>' }, details: {} } as unknown as typeof first] };
    const page = (await renderSite(altered)).get(`cases/${first.id}.html`) ?? '';
    expect(page).toMatch(/<a href="\.\.\/documents\/orders\.html">[^<]+<\/a>、<code>gone<\/code> <small>（文書なし）<\/small>/u);
    expect(page).toContain('<dt>note</dt><dd>&lt;b&gt;&amp;x&lt;/b&gt;</dd>');
    expect(page).toContain('<h2>条件・理由</h2><p class="empty-note">なし</p>');
  });

  it('renders the case layer as a search filter, in result rows, and on case pages', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    if (!result.ok) throw new Error('fixture catalog must be valid');
    const site = await renderSite(result.catalog);
    const index = site.get('cases/index.html') ?? '';
    expect(index).toMatch(/<span>テスト層<\/span><select id="layer-filter" data-filter-key="layer"><option value="">すべて<\/option><option value="e2e">e2e<\/option><option value="ui">ui<\/option><option value="unit">unit<\/option><\/select>/u);
    const unitCase = result.catalog.cases.find((item) => item.layer === 'unit');
    if (!unitCase) throw new Error('fixture must contain a unit case');
    const data = site.get('cases/index-data.js') ?? '';
    expect(data).toContain(`"id":"${unitCase.id}"`);
    expect(data).toContain('"filters":{"layer":"unit"');
    expect(site.get(`cases/${unitCase.id}.html`)).toContain(`<code>${unitCase.id}</code><span>unit</span><span>${unitCase.source}</span>`);
  });

  it('lists membership documents without cases and breaks counts down by layer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-uncovered-'));
    await cp(fixture, root, { recursive: true });
    await writeFile(path.join(root, 'knowledge/empty-domain.md'), '---\nid: empty-domain\nkind: domain\ntitle: Empty domain\n---\n', 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    if (!result.ok) throw new Error(result.diagnostics.map((item) => item.reason).join('; '));
    const { catalog } = result;
    const belongsTo = catalog.rules.case.fields.belongsTo;
    const membershipKinds = belongsTo?.type === 'reference' ? belongsTo.targetKinds : [];
    const ancestors = (id: string): ReadonlyArray<string> => {
      const document = catalog.documents.find((item) => item.id === id);
      return document ? [document.id, ...(document.parent ? ancestors(document.parent) : [])] : [];
    };
    const below = (id: string) => catalog.cases.filter((item) => ancestors(item.fields.belongsTo).includes(id));
    const site = await renderSite(catalog);
    const index = site.get('index.html') ?? '';
    const uncovered = catalog.documents.filter((document) => membershipKinds.includes(document.kind) && below(document.id).length === 0);
    expect(uncovered.map((document) => document.id)).toContain('empty-domain');
    expect(index).toContain('<h2 id="uncovered-heading">ケースのない文書</h2>');
    const section = index.slice(index.indexOf('uncovered-heading'));
    for (const document of catalog.documents) {
      expect(section.includes(`<a href="documents/${document.id}.html">`)).toBe(uncovered.includes(document));
    }
    const layers = [...new Set(catalog.rules.discovery.sources.map((source) => source.layer))];
    const feature = 'order-cancellation';
    const breakdown = layers.map((layer) => `${layer} ${below(feature).filter((item) => item.layer === layer).length}`).join(' · ');
    expect(site.get(`documents/${feature}.html`)).toContain(`<small>${below(feature).length}ケース<span class="layer-breakdown">${breakdown}</span></small>`);
    expect(site.get('documents/empty-domain.html')).toContain('<small class="no-cases">ケースなし</small>');
  });

  it('omits the layer breakdown for a single layer and the uncovered section when every document has cases', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-single-layer-'));
    const config = (await readFile(path.resolve('fixtures/alternate-rules.yaml'), 'utf8'))
      .replace('fixtures/none/**/*.md', 'knowledge/**/*.md')
      .replace('sources: {}', 'sources:\n    manual:\n      manual: ["knowledge/**/*.manual.yaml"]');
    await mkdir(path.join(root, 'knowledge'), { recursive: true });
    await writeFile(path.join(root, 'test-manager.yaml'), config, 'utf8');
    await writeFile(path.join(root, 'knowledge/module.md'), `---\nid: MOD-1\nkind: module\ntitle: Module one\n---\n`, 'utf8');
    await writeFile(path.join(root, 'knowledge/module-two.md'), `---\nid: MOD-2\nkind: module\ntitle: Module two\nparent: MOD-1\n---\n`, 'utf8');
    await writeFile(path.join(root, 'knowledge/case.manual.yaml'), `id: CASE-1\ntitle: alternate\nbelongsTo: MOD-2\nrole: contract\nimpact: 20\nsteps:\n  - action: act\n    expected: done\n`, 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    if (!result.ok) throw new Error(result.diagnostics.map((item) => item.reason).join('; '));
    const site = await renderSite(result.catalog);
    expect(site.get('index.html')).not.toContain('uncovered-heading');
    expect(site.get('documents/MOD-1.html')).toContain('<small>1ケース</small>');
  });

  it('reports missing belongsTo and does not inherit it from a parent or path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-invalid-'));
    await cp(fixture, root, { recursive: true });
    const file = path.join(root, 'src/cancel.test.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replaceAll('belongsTo: order-cancellation\n', ''), 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === 'TM121' && item.subject === 'belongsTo')).toBe(true);
  });

  it('detects self-reference, multi-node cycles, broken refs, wrong parent kinds, and duplicate IDs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-graph-'));
    await cp(fixture, root, { recursive: true });
    await writeFile(path.join(root, 'knowledge/orders.md'), `---\nid: orders\nkind: feature\ntitle: 受注\nparent: order-cancellation\n---\n`, 'utf8');
    await writeFile(path.join(root, 'knowledge/catalog.md'), `---\nid: catalog\nkind: feature\ntitle: 商品\nparent: catalog\nrefs: [missing-document]\n---\n`, 'utf8');
    await writeFile(path.join(root, 'knowledge/duplicate.md'), `---\nid: orders\nkind: domain\ntitle: 重複\n---\n`, 'utf8');
    await writeFile(path.join(root, 'knowledge/order-cancellation/eligibility.md'), `---\nid: cancellation-eligibility\nkind: decision\ntitle: 条件\nparent: cancellation-eligibility\n---\n`, 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = new Set(result.diagnostics.map((item) => item.code));
    expect(codes.has('TM110')).toBe(true);
    expect(codes.has('TM113')).toBe(true);
    expect(codes.has('TM114')).toBe(true);
    expect(codes.has('TM115')).toBe(true);
    expect(result.diagnostics.some((item) => item.code === 'TM113' && item.location.file === 'knowledge/order-cancellation/eligibility.md' && item.location.line === 5)).toBe(true);
    expect(result.diagnostics.some((item) => item.code === 'TM115' && item.location.file === 'knowledge/catalog.md' && item.location.line === 6)).toBe(true);
  });

  it('rejects missing and wrong-kind documents in configured display order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-document-order-'));
    await cp(fixture, root, { recursive: true });
    const configFile = path.join(root, 'test-manager.yaml');
    const config = await readFile(configFile, 'utf8');
    await writeFile(configFile, config.replace('domain: [orders, catalog]', 'domain: [missing, order-cancellation]'), 'utf8');
    const result = await checkProject(configFile);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === 'TM116' && item.subject === 'documents.displayOrder.domain')).toBe(true);
    expect(result.diagnostics.some((item) => item.code === 'TM117' && item.subject === 'documents.displayOrder.domain')).toBe(true);
  });

  it('detects a duplicate case ID across runners', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-duplicate-runner-'));
    await cp(fixture, root, { recursive: true });
    const file = path.join(root, 'journeys/cancellation.spec.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('CASE-201', 'CASE-001'), 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === 'TM140' && item.subject === 'CASE-001')).toBe(true);
  });

  it('fails when a configured discovery pattern matches no files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-empty-discovery-'));
    await cp(fixture, root, { recursive: true });
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, (await readFile(config, 'utf8')).replace('src/**/*.test.ts', 'src/**/*.tset.ts'), 'utf8');
    const result = await checkProject(config);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === 'TM011' && item.subject === 'src/**/*.tset.ts')).toBe(true);
  });

  it('detects discovery overlap and document/case ID collisions', async () => {
    const overlapRoot = await mkdtemp(path.join(tmpdir(), 'test-manager-overlap-'));
    await cp(fixture, overlapRoot, { recursive: true });
    const overlapConfig = path.join(overlapRoot, 'test-manager.yaml');
    await writeFile(overlapConfig, (await readFile(overlapConfig, 'utf8')).replace('vitest: ["src/**/*.test.ts"]', 'vitest: ["knowledge/**/*.manual.yaml", "src/**/*.test.ts"]'), 'utf8');
    const overlap = await checkProject(overlapConfig);
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.diagnostics.some((item) => item.code === 'TM010' && item.reason.includes('sources.e2e.manual') && item.reason.includes('sources.unit.vitest'))).toBe(true);

    const sameGroupRoot = await mkdtemp(path.join(tmpdir(), 'test-manager-same-group-overlap-'));
    await cp(fixture, sameGroupRoot, { recursive: true });
    const sameGroupConfig = path.join(sameGroupRoot, 'test-manager.yaml');
    await writeFile(sameGroupConfig, (await readFile(sameGroupConfig, 'utf8')).replace('vitest: ["src/**/*.test.ts"]', 'vitest: ["src/**/*.test.ts", "src/cancel.test.ts"]'), 'utf8');
    const sameGroup = await checkProject(sameGroupConfig);
    expect(sameGroup.ok).toBe(false);
    if (!sameGroup.ok) expect(sameGroup.diagnostics.some((item) => item.code === 'TM010' && item.reason.includes('src/cancel.test.ts'))).toBe(true);

    const collisionRoot = await mkdtemp(path.join(tmpdir(), 'test-manager-id-collision-'));
    await cp(fixture, collisionRoot, { recursive: true });
    const manual = path.join(collisionRoot, 'knowledge/order-cancellation/operator.manual.yaml');
    await writeFile(manual, (await readFile(manual, 'utf8')).replace('CASE-101', 'orders'), 'utf8');
    const collision = await checkProject(path.join(collisionRoot, 'test-manager.yaml'));
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.diagnostics.some((item) => item.code === 'TM141')).toBe(true);
  });

  it('rejects duplicate YAML keys, unknown keys, coercion, broken refs, and duplicate case IDs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-strict-'));
    await cp(fixture, root, { recursive: true });
    await writeFile(path.join(root, 'knowledge/order-cancellation/operator.manual.yaml'), `id: CASE-001\ntitle: duplicate\nbelongsTo: missing\nrole: product\nimpact: "3"\nimpact: 3\nunknown: x\nsteps:\n  - action: a\n    expected: e\n`, 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === 'TM001')).toBe(true);
  });

  it('reports independent strict manual violations after YAML parsing succeeds', async () => {
    const variants = [
      ['unknown', 'unknown: x\n', 'TM120'],
      ['wrong-type', 'impact: "3"\n', 'TM122'],
      ['broken-ref', 'belongsTo: missing\n', 'TM126'],
    ] as const;
    for (const [name, replacement, code] of variants) {
      const root = await mkdtemp(path.join(tmpdir(), `test-manager-${name}-`));
      await cp(fixture, root, { recursive: true });
      const file = path.join(root, 'knowledge/order-cancellation/operator.manual.yaml');
      const source = await readFile(file, 'utf8');
      const changed = name === 'unknown' ? `${source}${replacement}` : name === 'wrong-type' ? source.replace('impact: 3\n', replacement) : source.replace('belongsTo: order-cancellation\n', replacement);
      await writeFile(file, changed, 'utf8');
      const result = await checkProject(path.join(root, 'test-manager.yaml'));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
    }
  });

  it('reports frontmatter field errors at the actual field line', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-document-line-'));
    await cp(fixture, root, { recursive: true });
    const file = path.join(root, 'knowledge/orders.md');
    await writeFile(file, `---\nid: orders\nkind: domain\ntitle: ""\n---\n`, 'utf8');
    const result = await checkProject(path.join(root, 'test-manager.yaml'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === 'TM105' && item.location.line === 4)).toBe(true);
  });

  it('renders deterministic, escaped output with separate Story IDs and names', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = await renderSite(result.catalog);
    const second = await renderSite(result.catalog);
    expect([...first]).toEqual([...second]);
    expect(first.get('cases/index-data.js')).toContain('"href":"CASE-001.html"');
    expect(first.get('index.html')).not.toContain('id="source-filter"');
    expect(first.get('cases/index.html')).toContain('id="source-filter"');
    expect(first.get('cases/index.html')).toContain('id="status-filter"');
    expect(first.get('cases/index.html')).toContain('id="impact-filter"');
    expect(first.get('cases/index.html')).toContain('class="catalog-layout"');
    expect(first.get('index.html')).toContain('class="app-header"');
    expect(first.get('index.html')).toContain('class="brand-mark"');
    expect(first.get('index.html')).toContain('class="segmented-nav"');
    expect(first.get('index.html')).toContain('aria-current="page">ドメイン</a>');
    expect(first.get('index.html')).toContain('>ケース検索</a>');
    expect(first.get('index.html')).toContain('class="domain-table"');
    expect(first.get('index.html')?.indexOf('id="search"')).toBeLessThan(first.get('index.html')?.indexOf('class="domain-table"') ?? 0);
    expect(first.get('index.html')).toContain('data-domain-overview="orders"');
    expect(first.get('index.html')).toContain('商品カタログ');
    expect(first.get('index.html')).not.toContain('domainとfeatureから');
    expect(first.get('index.html')).not.toContain('IDや語句が分かっているとき');
    expect(first.get('index.html')).not.toContain('配下の文書はありません');
    expect(first.get('cases/index.html')).toContain('>確認担当<');
    expect(first.get('cases/index.html')).toContain('>プロダクト<');
    expect(first.has('cases/index.html')).toBe(true);
    expect(first.get('index.html')).not.toContain('data-domain-filter="orders"');
    expect(first.get('index.html')).not.toContain('data-domain-group="orders"');
    expect(first.get('index.html')).not.toContain('ケースを直接探す');
    expect(first.get('cases/index.html')).toContain('aria-current="page">ケース検索</a>');
    expect(first.get('cases/index.html')).toContain('data-domain-filter="orders"');
    expect(first.get('cases/index-data.js')).toContain('"domain":"orders"');
    expect(first.get('cases/index.html')).toContain('id="role-filter"');
    expect(first.get('index.html')).toContain('注文取消');
    expect(first.get('cases/CASE-301.html')).toContain('<code>CASE-301</code>');
    expect(first.get('cases/CASE-301.html')).toContain('<h1>出荷済み注文では取消ボタンを無効表示する</h1>');
    expect(first.get('cases/CASE-301.html')).toContain('<h2>関連する仕様・判断</h2>');
    expect(first.get('documents/cancellation-eligibility.html')).toContain('判断の理由');
    expect(first.get('documents/cancellation-eligibility.html')).toContain('&lt;script&gt;');
    expect(first.get('documents/cancellation-eligibility.html')).not.toContain("<script>alert('not executed')</script>");
    expect(first.get('documents/orders.html')).toContain('CASE-001.html');
    expect(first.get('documents/orders.html')).toContain('>配下の文書<');
    expect(first.get('documents/orders.html')).toContain('order-cancellation.html');
    expect(first.get('documents/index.html')).toContain('class="document-tree"');
    expect(first.get('documents/index.html')).toContain('<h1>仕様・判断</h1>');
    expect(first.get('index.html')).not.toContain('知識');
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-build-'));
    const out = path.join(root, 'site');
    await writeSite(result.catalog, out);
    const one = await readFile(path.join(out, 'catalog.json'), 'utf8');
    const publicCatalog = JSON.parse(one) as { documents: Array<{ id: string }>; cases: Array<{ id: string }> };
    expect(publicCatalog.documents.map((document) => document.id)).toEqual([
      'orders',
      'catalog',
      'order-cancellation',
      'cancellation-eligibility',
    ]);
    expect(publicCatalog.cases.map((managedCase) => managedCase.id)).toEqual([
      'CASE-001',
      'CASE-002',
      'CASE-003',
      'CASE-101',
      'CASE-201',
      'CASE-301',
    ]);
    await writeSite(result.catalog, out);
    expect(await readFile(path.join(out, 'catalog.json'), 'utf8')).toBe(one);
  });

  it('keeps every generated relative link resolvable and the entire disk tree deterministic', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-tree-'));
    const out = path.join(root, 'site');
    await writeSite(result.catalog, out);
    const snapshot = async (): Promise<ReadonlyArray<readonly [string, string]>> => {
      const walk = async (directory: string): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.relative(out, path.join(directory, entry.name))]))).flat().sort();
      const names = await walk(out);
      return Promise.all(names.map(async (name) => [name, await readFile(path.join(out, name), 'utf8')] as const));
    };
    const first = await snapshot();
    for (const [name, content] of first.filter(([name]) => name.endsWith('.html'))) {
      for (const match of content.matchAll(/href="([^"]+)"/gu)) {
        const href = match[1];
        if (!href || /^(?:https?:|#)/u.test(href)) continue;
        await expect(import('node:fs/promises').then(({ access }) => access(path.resolve(out, path.dirname(name), href.split('?')[0] ?? href)))).resolves.toBeUndefined();
      }
      expect(content).not.toContain(result.catalog.projectRoot);
    }
    await writeSite(result.catalog, out);
    expect(await snapshot()).toEqual(first);
  });

  it('narrows document-page cases in place and keeps the case-search link on the same conditions', async () => {
    const files = await renderSite((await checkProject(path.join(fixture, 'test-manager.yaml')) as { catalog: Parameters<typeof renderSite>[0] }).catalog);
    const listeners = new Map<object, Record<string, () => void>>();
    const listen = function (this: object, event: string, listener: () => void) { const own = listeners.get(this) ?? {}; own[event] = listener; listeners.set(this, own); };
    const search = { value: '', addEventListener: listen };
    const layer = { value: '', dataset: { filterKey: 'layer' }, addEventListener: listen };
    const row = (search: string, values: object) => ({ hidden: false, dataset: { search, filters: JSON.stringify(values) } });
    const rows = [row('case-1 取消', { layer: 'unit' }), row('case-2 取消', { layer: 'e2e' }), row('case-3 表示', { layer: 'e2e' })];
    const group = (members: typeof rows) => { const label = { textContent: '' }; return { hidden: false, label, querySelector: () => label, querySelectorAll: () => members.filter((member) => !member.hidden) }; };
    const outer = group(rows);
    const first = group([rows[0]!]);
    const second = group([rows[1]!, rows[2]!]);
    const summary = { textContent: '' };
    const empty = { hidden: true };
    const link = { href: '../cases/index.html?feature=orders', getAttribute() { return this.href; }, setAttribute(_name: string, value: string) { this.href = value; } };
    const elements: Record<string, unknown> = { '#case-filter-search': search, '#case-filter-summary': summary, '#case-filter-empty': empty, '#open-in-search': link };
    const root = { querySelector: (selector: string) => elements[selector], querySelectorAll: (selector: string) => selector === '[data-filter-key]' ? [layer] : selector === '[data-case-row]' ? rows : [outer, first, second] };
    runInNewContext(files.get('assets/document.js') ?? '', { document: { querySelector: () => root }, URLSearchParams, JSON, String });
    expect(summary.textContent).toBe('3ケース');
    layer.value = 'e2e';
    listeners.get(layer)?.change?.();
    expect(rows.map((item) => item.hidden)).toEqual([true, false, false]);
    expect([outer.hidden, first.hidden, second.hidden]).toEqual([false, true, false]);
    expect(second.label.textContent).toBe('2件');
    expect(summary.textContent).toBe('2 / 3ケース');
    expect(link.href).toBe('../cases/index.html?feature=orders&layer=e2e');
    search.value = 'nothing';
    listeners.get(search)?.input?.();
    expect(outer.hidden).toBe(true);
    expect(empty.hidden).toBe(false);
  });

  it('folds documents with children in the document list and leaves leaves as plain rows', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    if (!result.ok) throw new Error('fixture catalog must be valid');
    const page = (await renderSite(result.catalog)).get('documents/index.html') ?? '';
    const parents = new Set(result.catalog.documents.flatMap((document) => document.parent ? [document.parent] : []));
    for (const document of result.catalog.documents) {
      const link = `<a href="../documents/${document.id}.html">`;
      expect(page).toContain(parents.has(document.id) ? `<details><summary>${link}` : `<li><div>${link}`);
    }
    expect(page).not.toContain('<details open');
  });

  it('shows every feature of a matching domain on the top page, and only matching features otherwise', async () => {
    const files = await renderSite((await checkProject(path.join(fixture, 'test-manager.yaml')) as { catalog: Parameters<typeof renderSite>[0] }).catalog);
    const listeners: Record<string, () => void> = {};
    const search = { value: '', addEventListener: (event: string, listener: () => void) => { listeners[event] = listener; } };
    const feature = (search: string) => ({ hidden: false, dataset: { search } });
    const ordersFeatures = [feature('注文取消'), feature('返品')];
    const catalogFeatures = [feature('価格計算')];
    const toggleListeners = new Map<object, () => void>();
    const domain = (search: string, features: ReturnType<typeof feature>[]) => { const toggle = { expanded: '', setAttribute(_name: string, value: string) { this.expanded = value; }, addEventListener(_event: string, listener: () => void) { toggleListeners.set(toggle, listener); } }; return { hidden: false, toggle, dataset: { search } as Record<string, string>, querySelector: () => toggle, querySelectorAll: () => features }; };
    const domains = [domain('受注 orders', ordersFeatures), domain('商品カタログ catalog', catalogFeatures)];
    const lone = { hidden: false, dataset: { search: '単独' } as Record<string, string>, querySelector: () => null, querySelectorAll: () => [] };
    const empty = { hidden: true };
    const expandAll = { textContent: '', addEventListener(_event: string, listener: () => void) { listeners.expandAll = listener; } };
    runInNewContext(files.get('assets/overview.js') ?? '', { document: { querySelector: (selector: string) => selector === '#search' ? search : selector === '#expand-all' ? expandAll : empty, querySelectorAll: () => [...domains, lone] } });
    expect(domains.map((item) => 'collapsed' in item.dataset)).toEqual([true, true]);
    expect(expandAll.textContent).toBe('すべて開く');
    toggleListeners.get(domains[0]!.toggle)?.();
    toggleListeners.get(domains[1]!.toggle)?.();
    expect(expandAll.textContent).toBe('すべて閉じる');
    toggleListeners.get(domains[1]!.toggle)?.();
    expect(domains.map((item) => 'collapsed' in item.dataset)).toEqual([false, true]);
    expect(domains[0]!.toggle.expanded).toBe('true');
    listeners.expandAll?.();
    expect(domains.map((item) => 'collapsed' in item.dataset)).toEqual([false, false]);
    expect(expandAll.textContent).toBe('すべて閉じる');
    listeners.expandAll?.();
    search.value = '受注';
    listeners.input?.();
    expect(domains.map((item) => item.hidden)).toEqual([false, true]);
    expect(ordersFeatures.map((item) => item.hidden)).toEqual([false, false]);
    expect(domains.map((item) => 'collapsed' in item.dataset)).toEqual([false, false]);
    search.value = '返品';
    listeners.input?.();
    expect(ordersFeatures.map((item) => item.hidden)).toEqual([true, false]);
    search.value = 'なし';
    listeners.input?.();
    expect(empty.hidden).toBe(false);
  });

  it('applies search, project-defined filters and URL conditions together in the case search script', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const files = await renderSite(result.catalog);
    const listeners = new Map<object, Record<string, () => void>>();
    const listen = function (this: object, event: string, listener: () => void) { const own = listeners.get(this) ?? {}; own[event] = listener; listeners.set(this, own); };
    const control = (key?: string, options: string[] = []) => ({ value: '', options: options.map((value) => ({ value })), dataset: key ? { filterKey: key } : {}, addEventListener: listen });
    const search = control();
    const source = control('source', ['', 'manual', 'playwright', 'storybook', 'vitest']);
    const domainControl = (domain: string) => ({ dataset: { domainFilter: domain }, classList: { toggle() {} }, setAttribute() {}, addEventListener: listen });
    const allDomains = domainControl('');
    const orders = domainControl('orders');
    const results = { innerHTML: '' };
    const summary = { textContent: '' };
    const empty = { hidden: true };
    const more = { hidden: true, textContent: '', addEventListener: listen };
    const label = { textContent: '' };
    const clear = { addEventListener: listen };
    const featureNote = { hidden: true, querySelector: (selector: string) => selector === '[data-feature-label]' ? label : clear };
    const elements: Record<string, unknown> = { '#search': search, '#result-summary': summary, '#empty-results': empty, '#case-results': results, '#show-more': more, '#feature-filter': featureNote };
    const document = { querySelector: (selector: string) => elements[selector], querySelectorAll: (selector: string) => selector === '[data-filter-key]' ? [source] : selector === '[data-domain-filter]' ? [allDomains, orders] : [] };
    const urls: string[] = [];
    const window: Record<string, unknown> = {};
    const context = { window, document, location: { search: '?feature=order-cancellation&source=vitest&unknown=1', pathname: '/cases/index.html' }, history: { replaceState: (_state: unknown, _title: string, url: string) => urls.push(url) }, URLSearchParams, Map, JSON, String, Math };
    runInNewContext(files.get('cases/index-data.js') ?? '', context);
    const all = window.testManagerCases as ReadonlyArray<{ id: string; source: string; ancestors: string[] }>;
    runInNewContext(files.get('assets/search.js') ?? '', context);
    const shown = () => [...results.innerHTML.matchAll(/<small>([^ ]+) · /gu)].map((match) => match[1]);
    const expected = all.filter((item) => item.source === 'vitest' && item.ancestors.includes('order-cancellation')).map((item) => item.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(shown()).toEqual(expected);
    expect(source.value).toBe('vitest');
    expect(featureNote.hidden).toBe(false);
    expect(label.textContent).not.toBe('');
    expect(summary.textContent).toBe(`${expected.length}ケース`);
    search.value = 'no-such-case';
    listeners.get(search)?.input?.();
    expect(shown()).toEqual([]);
    expect(empty.hidden).toBe(false);
    expect(urls.at(-1)).toBe('?q=no-such-case&feature=order-cancellation&source=vitest');
    search.value = ''; source.value = '';
    listeners.get(clear)?.click?.();
    expect(shown()).toEqual(all.map((item) => item.id).slice(0, 200));
    listeners.get(orders)?.click?.();
    expect(urls.at(-1)).toBe('?domain=orders');
    expect(featureNote.hidden).toBe(true);
  });

  it('refuses unsafe output targets and directories without its exact marker', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(writeSite(result.catalog, result.catalog.projectRoot)).rejects.toThrow('project root');
    await expect(writeSite(result.catalog, path.dirname(result.catalog.projectRoot))).rejects.toThrow('ancestor');
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-output-safety-'));
    const unowned = path.join(root, 'unowned');
    await cp(fixture, unowned, { recursive: true });
    await expect(writeSite(result.catalog, unowned)).rejects.toThrow('not created by test-manager');
    const wrongMarker = path.join(root, 'wrong-marker');
    await cp(fixture, wrongMarker, { recursive: true });
    await writeFile(path.join(wrongMarker, '.test-manager-output'), 'v2\n', 'utf8');
    await expect(writeSite(result.catalog, wrongMarker)).rejects.toThrow('not created by test-manager');
  });
});
