import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
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
      await executeFile(process.execPath, [path.resolve('dist/cli.js'), 'build', '--config', path.join(fixture, 'test-manager.yaml'), '--out', output], { cwd: consumer });
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
      ['CASE-001', 'vitest', 'active'],
      ['CASE-002', 'vitest', 'active'],
      ['CASE-003', 'vitest', 'todo'],
      ['CASE-201', 'playwright', 'active'],
      ['CASE-301', 'storybook', 'skip'],
    ]);
    const eachCase = result.catalog.cases.find((item) => item.id === 'CASE-002');
    expect(eachCase?.source === 'vitest' ? eachCase.parameters : undefined).toEqual([[0, false], [1, true]]);
  });

  it('checks and renders a second project vocabulary end to end', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-alternate-project-'));
    const config = (await readFile(path.resolve('fixtures/alternate-rules.yaml'), 'utf8'))
      .replace('fixtures/none/**/*.md', 'knowledge/**/*.md')
      .replace('manualCases: []', 'manualCases: ["knowledge/**/*.manual.yaml"]');
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
    await writeFile(overlapConfig, (await readFile(overlapConfig, 'utf8')).replace('paths: ["src/**/*.test.ts"]', 'paths: ["knowledge/**/*.manual.yaml", "src/**/*.test.ts"]'), 'utf8');
    const overlap = await checkProject(overlapConfig);
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.diagnostics.some((item) => item.code === 'TM010')).toBe(true);

    const sameGroupRoot = await mkdtemp(path.join(tmpdir(), 'test-manager-same-group-overlap-'));
    await cp(fixture, sameGroupRoot, { recursive: true });
    const sameGroupConfig = path.join(sameGroupRoot, 'test-manager.yaml');
    await writeFile(sameGroupConfig, (await readFile(sameGroupConfig, 'utf8')).replace('paths: ["src/**/*.test.ts"]', 'paths: ["src/**/*.test.ts", "src/cancel.test.ts"]'), 'utf8');
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
    expect(first.get('cases/index.html')).toContain('href="../cases/CASE-001.html"');
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
    expect(first.get('index.html')).toContain('class="domain-overviews"');
    expect(first.get('index.html')?.indexOf('id="search"')).toBeLessThan(first.get('index.html')?.indexOf('class="domain-overviews"') ?? 0);
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
    expect(first.get('cases/index.html')).toContain('data-domain-group="orders"');
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
        await expect(import('node:fs/promises').then(({ access }) => access(path.resolve(out, path.dirname(name), href)))).resolves.toBeUndefined();
      }
      expect(content).not.toContain(result.catalog.projectRoot);
    }
    await writeSite(result.catalog, out);
    expect(await snapshot()).toEqual(first);
  });

  it('applies search and project-defined filters together in the generated browser script', async () => {
    const result = await checkProject(path.join(fixture, 'test-manager.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const files = await renderSite(result.catalog);
    const listeners = new Map<object, Record<string, () => void>>();
    const control = (key?: string) => ({ value: '', dataset: key ? { filterKey: key } : {}, addEventListener(event: string, listener: () => void) { const own = listeners.get(this) ?? {}; own[event] = listener; listeners.set(this, own); } });
    const search = control();
    const source = control('source');
    const role = control('role');
    const overviews = [
      { hidden: false, dataset: { domainOverview: 'orders', search: '受注 注文取消 cancellation case-1 product' } },
      { hidden: false, dataset: { domainOverview: 'catalog', search: '商品カタログ calculation case-2 engineering' } },
    ];
    const rows = [
      { hidden: false, dataset: { domain: 'orders', search: 'case-1 cancellation product', filters: JSON.stringify({ source: 'vitest', role: 'product' }) } },
      { hidden: false, dataset: { domain: 'catalog', search: 'case-2 calculation engineering', filters: JSON.stringify({ source: 'playwright', role: 'engineering' }) } },
    ];
    const groups = [{ hidden: false, dataset: { domainGroup: 'orders' } }, { hidden: false, dataset: { domainGroup: 'catalog' } }];
    const domainControl = (domain: string) => ({
      dataset: { domainFilter: domain }, classList: { toggle() {} }, setAttribute() {},
      addEventListener(event: string, listener: () => void) { const own = listeners.get(this) ?? {}; own[event] = listener; listeners.set(this, own); },
    });
    const allDomains = domainControl('');
    const orders = domainControl('orders');
    const summary = { textContent: '' };
    const empty = { hidden: true };
    const document = {
      querySelector: (selector: string) => selector === '#search' ? search : selector === '#result-summary' ? summary : selector === '#empty-results' ? empty : undefined,
      querySelectorAll: (selector: string) => selector === '[data-filter-key]' ? [source, role] : selector === '[data-domain-overview]' ? overviews : selector === '[data-case-row]' ? rows : selector === '[data-domain-group]' ? groups : [allDomains, orders],
    };
    runInNewContext(files.get('assets/search.js') ?? '', { document, JSON, String });
    search.value = 'PRODUCT case-1'; source.value = 'vitest'; role.value = 'product';
    listeners.get(role)?.change?.();
    expect(rows.map((row) => row.hidden)).toEqual([false, true]);
    expect(overviews.map((overview) => overview.hidden)).toEqual([false, true]);
    search.value = 'calculation case-2'; source.value = ''; role.value = '';
    listeners.get(search)?.input?.();
    expect(rows.map((row) => row.hidden)).toEqual([true, false]);
    search.value = '';
    listeners.get(orders)?.click?.();
    expect(rows.map((row) => row.hidden)).toEqual([false, true]);
    expect(groups.map((group) => group.hidden)).toEqual([false, true]);
    expect(summary.textContent).toBe('1ケース');
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
