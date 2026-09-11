import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRules } from './rules.js';
import { readTestSource } from './source.js';
import { documentIdSchema } from './ids.js';

describe('unsupported source syntax', () => {
  it('ignores runner configuration APIs and unmarked Story helper objects', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-runner-api-'));
    const vitestFile = path.join(root, 'runner.test.ts');
    await writeFile(vitestFile, `import { test } from 'vitest';\ntest.describe('group', () => {});\ntest.extend({});\n`, 'utf8');
    expect(await readTestSource(vitestFile, root, 'vitest', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
    const playwrightFile = path.join(root, 'runner.spec.ts');
    await writeFile(playwrightFile, `import { test } from '@playwright/test';\ntest.describe.configure({ mode: 'parallel' });\ntest.use({ locale: 'ja' });\ntest.extend({});\n`, 'utf8');
    expect(await readTestSource(playwrightFile, root, 'playwright', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
    const storyFile = path.join(root, 'Helper.stories.tsx');
    await writeFile(storyFile, `export const helper = { timeout: 1000 };\nexport const Ordinary = { name: 'Ordinary story' };\n`, 'utf8');
    expect(await readTestSource(storyFile, root, 'storybook', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
  });

  it('rejects classification fields in @case-doc at the real source line', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-comment-placement-'));
    const file = path.join(root, 'placement.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest('case', { meta: { caseId: 'CASE-999' } }, () => {\n  /*\n  @case-doc\n  owner: orders\n  */\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'area', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', loaded.rules, documents);
    expect(result.cases).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'TM208' && item.location.line === 11)).toBe(true);
  });

  it('offsets YAML syntax diagnostics to the comment source line', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-comment-line-'));
    const file = path.join(root, 'line.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n\n/*\n@case\nowner: orders\nowner: orders\nrole: product\nimpact: 1\n*/\ntest('case', { meta: { caseId: 'CASE-999' } }, () => {});\n`, 'utf8');
    const result = await readTestSource(file, root, 'vitest', loaded.rules, []);
    expect(result.diagnostics.some((item) => item.code === 'TM001' && item.location.line === 6)).toBe(true);
  });

  it('reports @case-doc field errors at the @case-doc location', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-detail-line-'));
    const file = path.join(root, 'detail.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest('case', { meta: { caseId: 'CASE-999' } }, () => {\n  /*\n  @case-doc\n  conditions: invalid\n  */\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'area', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', loaded.rules, documents);
    expect(result.diagnostics.some((item) => item.code === 'TM122' && item.subject === 'conditions' && item.location.line === 11)).toBe(true);
  });

  it('diagnoses dynamic each and missing declaration metadata instead of silently dropping it', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    expect(loaded.rules).toBeDefined();
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-source-'));
    const file = path.join(root, 'dynamic.test.ts');
    await writeFile(file, `import { test } from 'vitest';\nconst rows = [[1]];\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest.each(rows)('dynamic %i', () => {});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'area', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', loaded.rules, documents);
    expect(result.cases).toEqual([]);
    expect(new Set(result.diagnostics.map((item) => item.code))).toEqual(new Set(['TM203', 'TM205']));
  });

  it('ignores ordinary tests from other imports', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-unmanaged-'));
    const file = path.join(root, 'unmanaged.test.ts');
    await writeFile(file, `import { test } from 'node:test';\ntest('not managed', () => {});\n`, 'utf8');
    const result = await readTestSource(file, root, 'vitest', loaded.rules, []);
    expect(result).toEqual({ cases: [], diagnostics: [] });
  });

  it('uses lexical import bindings and ignores shadowed runner names and runtime annotations', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-bindings-'));
    const vitestFile = path.join(root, 'binding.test.ts');
    await writeFile(vitestFile, `import { test as managedTest } from 'vitest';\nfunction helper(managedTest: (...args: unknown[]) => void) {\nmanagedTest('local', { meta: { caseId: 'CASE-999' } }, () => {});\n}\n`, 'utf8');
    expect(await readTestSource(vitestFile, root, 'vitest', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
    const playwrightFile = path.join(root, 'annotations.spec.ts');
    await writeFile(playwrightFile, `import { test } from '@playwright/test';\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest('managed', { annotation: { type: 'case-id', description: 'CASE-999' } }, () => {\n  test.skip(true, 'runtime annotation');\n  test.fixme(false, 'runtime annotation');\n  test.fail(true, 'runtime annotation');\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'area', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(playwrightFile, root, 'playwright', loaded.rules, documents);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases.map((item) => item.id)).toEqual(['CASE-999']);
  });

  it('rejects multiple and legacy case IDs instead of choosing one', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-case-ids-'));
    const file = path.join(root, 'ids.spec.ts');
    await writeFile(file, `import { test } from '@playwright/test';\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest('duplicate', { annotation: [{ type: 'case-id', description: 'CASE-998' }, { type: 'case-id', description: 'CASE-999' }] }, () => {});\n`, 'utf8');
    const result = await readTestSource(file, root, 'playwright', loaded.rules, []);
    expect(result.cases).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const malformed = path.join(root, 'malformed.spec.ts');
    await writeFile(malformed, `import { test } from '@playwright/test';\n/* @case */\ntest('duplicate', { annotation: [{ type: 'case-id', description: 'CASE-998' }, { type: 'case-id' }] }, () => {});\n`, 'utf8');
    expect((await readTestSource(malformed, root, 'playwright', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const vitestFile = path.join(root, 'legacy.test.ts');
    await writeFile(vitestFile, `import { test } from 'vitest';\n/* @case */\ntest('legacy', { meta: { caseIds: ['CASE-999'] } }, () => {});\n`, 'utf8');
    expect((await readTestSource(vitestFile, root, 'vitest', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const storyFile = path.join(root, 'Legacy.stories.tsx');
    await writeFile(storyFile, `/* @case */\nexport const Legacy = { name: '[CASE-999] legacy', parameters: { testManager: { caseId: 'CASE-999' } } };\n`, 'utf8');
    expect((await readTestSource(storyFile, root, 'storybook', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const spreadFile = path.join(root, 'spread-metadata.test.ts');
    await writeFile(spreadFile, `import { test } from 'vitest';\nconst extra = {};\n/* @case */\ntest('spread', { meta: { ...extra, caseId: 'CASE-999' } }, () => {});\n`, 'utf8');
    expect((await readTestSource(spreadFile, root, 'vitest', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM210')).toBe(true);
    const spreadStory = path.join(root, 'Spread.stories.tsx');
    await writeFile(spreadStory, `const extra = {};\n/* @case */\nexport const Spread = { name: '[CASE-999] spread', ...extra };\n`, 'utf8');
    expect((await readTestSource(spreadStory, root, 'storybook', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM223')).toBe(true);
    const playwrightSpread = path.join(root, 'spread-annotation.spec.ts');
    await writeFile(playwrightSpread, `import { test } from '@playwright/test';\nconst extra = [];\n/* @case */\ntest('spread', { annotation: [{ type: 'case-id', description: 'CASE-999' }, ...extra] }, () => {});\n`, 'utf8');
    expect((await readTestSource(playwrightSpread, root, 'playwright', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM210')).toBe(true);
  });

  it('rejects expressions, spreads, and computed keys inside an inline each table', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-each-values-'));
    for (const [name, cell] of [['expression', 'external'], ['spread', '...[1]'], ['computed', "{ ['key']: 1 }"]] as const) {
      const file = path.join(root, `${name}.test.ts`);
      await writeFile(file, `import { test } from 'vitest';\nconst external = 1;\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest.each([[${cell}]])('unsupported %s', { meta: { caseId: 'CASE-999' } }, () => {});\n`, 'utf8');
      const result = await readTestSource(file, root, 'vitest', loaded.rules, []);
      expect(result.cases).toEqual([]);
      expect(result.diagnostics.some((item) => item.code === 'TM203')).toBe(true);
      expect(JSON.stringify(result)).not.toContain('<expression>');
    }
  });

  it('uses field placement from project rules instead of fixed detail field names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-field-placement-'));
    const config = path.join(root, 'test-manager.yaml');
    const original = await (await import('node:fs/promises')).readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    await writeFile(config, original.replace('conditions:', 'preconditions:'), 'utf8');
    const loaded = await loadRules(config);
    if (!loaded.rules) return;
    const file = path.join(root, 'placed.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest('placed', { meta: { caseId: 'CASE-999' } }, () => {\n  /*\n  @case-doc\n  preconditions: [signed in]\n  */\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'area', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', loaded.rules, documents);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases[0]?.fields).not.toHaveProperty('preconditions');
    expect(result.cases[0]?.details).toEqual({ preconditions: ['signed in'] });
  });

  it('diagnoses tagged-template each as an unsupported managed declaration', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-tagged-each-'));
    const file = path.join(root, 'tagged.test.ts');
    await writeFile(file, "import { test } from 'vitest';\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\ntest.each`value\n${1}`('tagged $value', { meta: { caseId: 'CASE-999' } }, () => {});\n", 'utf8');
    const result = await readTestSource(file, root, 'vitest', loaded.rules, []);
    expect(result.cases).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'TM203')).toBe(true);
  });

  it('diagnoses marked wrappers, namespace calls, and Story factories instead of silently dropping them', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-unsupported-declarations-'));
    const marker = `/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/`;
    for (const [name, declaration] of [['wrapper', `const managed = () => {};\n${marker}\nmanaged('x', () => {});`], ['namespace', `import * as runner from 'vitest';\n${marker}\nrunner.test('x', () => {});`]] as const) {
      const file = path.join(root, `${name}.test.ts`);
      await writeFile(file, `${declaration}\n`, 'utf8');
      expect((await readTestSource(file, root, 'vitest', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM203')).toBe(true);
    }
    const story = path.join(root, 'Factory.stories.tsx');
    await writeFile(story, `const makeStory = () => ({});\n/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/\nexport const Factory = makeStory();\n`, 'utf8');
    expect((await readTestSource(story, root, 'storybook', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM222')).toBe(true);
  });

  it('maps supported Vitest and Playwright modifiers to definition status', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-modifiers-'));
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'area', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const comment = `/*\n@case\nowner: orders\nrole: product\nimpact: 1\n*/`;
    const vitestFile = path.join(root, 'modifiers.test.ts');
    await writeFile(vitestFile, `import { test } from 'vitest';\n${comment}\ntest.skip('skip', { meta: { caseId: 'CASE-901' } }, () => {});\n${comment}\ntest.todo('todo', { meta: { caseId: 'CASE-902' } });\n${comment}\ntest.only('only', { meta: { caseId: 'CASE-903' } }, () => {});\n${comment}\ntest.concurrent('concurrent', { meta: { caseId: 'CASE-904' } }, () => {});\n${comment}\ntest.fails('fails', { meta: { caseId: 'CASE-905' } }, () => {});\n`, 'utf8');
    const vitest = await readTestSource(vitestFile, root, 'vitest', loaded.rules, documents);
    expect(vitest.diagnostics).toEqual([]);
    expect(vitest.cases.map((item) => [item.id, item.status])).toEqual([['CASE-901', 'skip'], ['CASE-902', 'todo'], ['CASE-903', 'active'], ['CASE-904', 'active'], ['CASE-905', 'active']]);
    const playwrightFile = path.join(root, 'modifiers.spec.ts');
    await writeFile(playwrightFile, `import { test } from '@playwright/test';\n${comment}\ntest.skip('skip', { annotation: { type: 'case-id', description: 'CASE-911' } }, () => {});\n${comment}\ntest.fixme('fixme', { annotation: { type: 'case-id', description: 'CASE-912' } }, () => {});\n${comment}\ntest.only('only', { annotation: { type: 'case-id', description: 'CASE-913' } }, () => {});\n${comment}\ntest.fail('fail', { annotation: { type: 'case-id', description: 'CASE-914' } }, () => {});\n`, 'utf8');
    const playwright = await readTestSource(playwrightFile, root, 'playwright', loaded.rules, documents);
    expect(playwright.diagnostics).toEqual([]);
    expect(playwright.cases.map((item) => [item.id, item.status])).toEqual([['CASE-911', 'skip'], ['CASE-912', 'skip'], ['CASE-913', 'active'], ['CASE-914', 'active']]);
  });
});
