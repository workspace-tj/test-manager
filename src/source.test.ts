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
    expect(await readTestSource(vitestFile, root, 'vitest', 'unit', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
    const playwrightFile = path.join(root, 'runner.spec.ts');
    await writeFile(playwrightFile, `import { test } from '@playwright/test';\ntest.describe.configure({ mode: 'parallel' });\ntest.use({ locale: 'ja' });\ntest.extend({});\n`, 'utf8');
    expect(await readTestSource(playwrightFile, root, 'playwright', 'unit', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
    const storyFile = path.join(root, 'Helper.stories.tsx');
    await writeFile(storyFile, `export const helper = { timeout: 1000 };\nexport const Ordinary = { name: 'Ordinary story' };\n`, 'utf8');
    expect(await readTestSource(storyFile, root, 'storybook', 'unit', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
  });

  it('reads generic arrow functions in .ts files and JSX in .tsx files', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-ts-generics-'));
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const body = `/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest('case', { meta: { caseId: 'CASE-999' } }, () => {});\n`;
    const generic = path.join(root, 'generic.test.ts');
    await writeFile(generic, `import { test } from 'vitest';\nconst identity = <T,>(value: T): T => value;\nconst cast = <T>(value: unknown) => value as T;\n${body}`, 'utf8');
    const typed = await readTestSource(generic, root, 'vitest', 'unit', loaded.rules, documents);
    expect(typed.diagnostics).toEqual([]);
    expect(typed.cases.map((item) => item.id)).toEqual(['CASE-999']);
    const component = path.join(root, 'component.test.tsx');
    await writeFile(component, `import { test } from 'vitest';\nconst view = <div>ok</div>;\n${body}`, 'utf8');
    const tsx = await readTestSource(component, root, 'vitest', 'unit', loaded.rules, documents);
    expect(tsx.diagnostics).toEqual([]);
    expect(tsx.cases.map((item) => item.id)).toEqual(['CASE-999']);
    const misplaced = path.join(root, 'misplaced.test.ts');
    await writeFile(misplaced, `import { test } from 'vitest';\nconst view = <div>ok</div>;\n${body}`, 'utf8');
    expect((await readTestSource(misplaced, root, 'vitest', 'unit', loaded.rules, documents)).diagnostics.map((item) => item.code)).toEqual(['TM200']);
  });

  it('rejects classification fields in @case-doc at the real source line', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-comment-placement-'));
    const file = path.join(root, 'placement.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest('case', { meta: { caseId: 'CASE-999' } }, () => {\n  /*\n  @case-doc\n  belongsTo: orders\n  */\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, documents);
    expect(result.cases).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'TM208' && item.location.line === 11)).toBe(true);
  });

  it('offsets YAML syntax diagnostics to the comment source line', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-comment-line-'));
    const file = path.join(root, 'line.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n\n/*\n@case\nbelongsTo: orders\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest('case', { meta: { caseId: 'CASE-999' } }, () => {});\n`, 'utf8');
    const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, []);
    expect(result.diagnostics.some((item) => item.code === 'TM001' && item.location.line === 6)).toBe(true);
  });

  it('reports @case-doc field errors at the @case-doc location', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-detail-line-'));
    const file = path.join(root, 'detail.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest('case', { meta: { caseId: 'CASE-999' } }, () => {\n  /*\n  @case-doc\n  conditions: invalid\n  */\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, documents);
    expect(result.diagnostics.some((item) => item.code === 'TM122' && item.subject === 'conditions' && item.location.line === 11)).toBe(true);
  });

  it('keeps an each table it cannot read as source text, and still diagnoses missing declaration metadata', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    expect(loaded.rules).toBeDefined();
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-source-'));
    const file = path.join(root, 'dynamic.test.ts');
    await writeFile(file, `import { test } from 'vitest';\nimport { rows } from './rows';\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest.each(rows)('dynamic %i', () => {});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, documents);
    expect(result.cases).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toEqual(['TM205']);
  });

  it('ignores ordinary tests from other imports', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-unmanaged-'));
    const file = path.join(root, 'unmanaged.test.ts');
    await writeFile(file, `import { test } from 'node:test';\ntest('not managed', () => {});\n`, 'utf8');
    const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, []);
    expect(result).toEqual({ cases: [], diagnostics: [] });
  });

  it('uses lexical import bindings and ignores shadowed runner names and runtime annotations', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-bindings-'));
    const vitestFile = path.join(root, 'binding.test.ts');
    await writeFile(vitestFile, `import { test as managedTest } from 'vitest';\nfunction helper(managedTest: (...args: unknown[]) => void) {\nmanagedTest('local', { meta: { caseId: 'CASE-999' } }, () => {});\n}\n`, 'utf8');
    expect(await readTestSource(vitestFile, root, 'vitest', 'unit', loaded.rules, [])).toEqual({ cases: [], diagnostics: [] });
    const playwrightFile = path.join(root, 'annotations.spec.ts');
    await writeFile(playwrightFile, `import { test } from '@playwright/test';\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest('managed', { annotation: { type: 'case-id', description: 'CASE-999' } }, () => {\n  test.skip(true, 'runtime annotation');\n  test.fixme(false, 'runtime annotation');\n  test.fail(true, 'runtime annotation');\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(playwrightFile, root, 'playwright', 'unit', loaded.rules, documents);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases.map((item) => item.id)).toEqual(['CASE-999']);
  });

  it('rejects multiple and legacy case IDs instead of choosing one', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-case-ids-'));
    const file = path.join(root, 'ids.spec.ts');
    await writeFile(file, `import { test } from '@playwright/test';\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest('duplicate', { annotation: [{ type: 'case-id', description: 'CASE-998' }, { type: 'case-id', description: 'CASE-999' }] }, () => {});\n`, 'utf8');
    const result = await readTestSource(file, root, 'playwright', 'unit', loaded.rules, []);
    expect(result.cases).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const malformed = path.join(root, 'malformed.spec.ts');
    await writeFile(malformed, `import { test } from '@playwright/test';\n/* @case */\ntest('duplicate', { annotation: [{ type: 'case-id', description: 'CASE-998' }, { type: 'case-id' }] }, () => {});\n`, 'utf8');
    expect((await readTestSource(malformed, root, 'playwright', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const vitestFile = path.join(root, 'legacy.test.ts');
    await writeFile(vitestFile, `import { test } from 'vitest';\n/* @case */\ntest('legacy', { meta: { caseIds: ['CASE-999'] } }, () => {});\n`, 'utf8');
    expect((await readTestSource(vitestFile, root, 'vitest', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const storyFile = path.join(root, 'Legacy.stories.tsx');
    await writeFile(storyFile, `/* @case */\nexport const Legacy = { name: '[CASE-999] legacy', parameters: { testManager: { caseId: 'CASE-999' } } };\n`, 'utf8');
    expect((await readTestSource(storyFile, root, 'storybook', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM209')).toBe(true);
    const spreadFile = path.join(root, 'spread-metadata.test.ts');
    await writeFile(spreadFile, `import { test } from 'vitest';\nconst extra = {};\n/* @case */\ntest('spread', { meta: { ...extra, caseId: 'CASE-999' } }, () => {});\n`, 'utf8');
    expect((await readTestSource(spreadFile, root, 'vitest', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM210')).toBe(true);
    const spreadStory = path.join(root, 'Spread.stories.tsx');
    await writeFile(spreadStory, `const extra = {};\n/* @case */\nexport const Spread = { name: '[CASE-999] spread', ...extra };\n`, 'utf8');
    expect((await readTestSource(spreadStory, root, 'storybook', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM223')).toBe(true);
    const playwrightSpread = path.join(root, 'spread-annotation.spec.ts');
    await writeFile(playwrightSpread, `import { test } from '@playwright/test';\nconst extra = [];\n/* @case */\ntest('spread', { annotation: [{ type: 'case-id', description: 'CASE-999' }, ...extra] }, () => {});\n`, 'utf8');
    expect((await readTestSource(playwrightSpread, root, 'playwright', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM210')).toBe(true);
  });

  it('reads each tables wrapped in type assertions and same-file const tables', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-each-static-'));
    const marker = '/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/';
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const read = async (name: string, body: string) => {
      const file = path.join(root, `${name}.test.ts`);
      await writeFile(file, `import { test } from 'vitest';\n${body}\n`, 'utf8');
      return readTestSource(file, root, 'vitest', 'unit', loaded.rules!, documents);
    };
    const asConst = await read('as-const', `${marker}\ntest.each(['approved', 'rejected'] as const)('kind %s', { meta: { caseId: 'CASE-961' } }, () => {});`);
    expect(asConst.diagnostics).toEqual([]);
    expect(asConst.cases.map((item) => item.source === 'vitest' ? item.parameters : undefined)).toEqual([['approved', 'rejected']]);
    const satisfies = await read('satisfies', `${marker}\ntest.each([[null, false] as const, ['x', true]] satisfies ReadonlyArray<readonly [string | null, boolean]>)('row %s', { meta: { caseId: 'CASE-962' } }, () => {});`);
    expect(satisfies.cases.map((item) => item.source === 'vitest' ? item.parameters : undefined)).toEqual([[[null, false], ['x', true]]]);
    const constTable = await read('const-table', `const codes = ['A', 'B'] as const;\n${marker}\ntest.each(codes)('code %s', { meta: { caseId: 'CASE-963' } }, () => {});`);
    expect(constTable.diagnostics).toEqual([]);
    expect(constTable.cases.map((item) => item.source === 'vitest' ? item.parameters : undefined)).toEqual([['A', 'B']]);
    const destructured = await read('destructured', `const [rows] = [[1, 2]];\n${marker}\ntest.each(rows)('row %s', { meta: { caseId: 'CASE-967' } }, () => {});`);
    expect(destructured.cases.map((item) => item.source === 'vitest' ? [item.parameters, item.parametersSource] : undefined)).toEqual([[undefined, 'rows']]);
    const mutated = await read('mutated', `const rows = [1];\nrows.push(2);\n${marker}\ntest.each(rows)('row %s', { meta: { caseId: 'CASE-968' } }, () => {});`);
    expect(mutated.cases.map((item) => item.source === 'vitest' ? [item.parameters, item.parametersSource] : undefined)).toEqual([[undefined, 'rows']]);
    const sharedByTwo = await read('shared', `const rows = ['a'];\n${marker}\ntest.each(rows)('one %s', { meta: { caseId: 'CASE-969' } }, () => {});\n${marker}\ntest.each(rows)('two %s', { meta: { caseId: 'CASE-970' } }, () => {});`);
    expect(sharedByTwo.cases.map((item) => item.source === 'vitest' ? item.parameters : undefined)).toEqual([['a'], ['a']]);
    const followedSource = await read('followed', `const account = () => ({});\nconst rows = [\r\n  [account()],\r\n];\n${marker}\ntest.each(rows)('row %s', { meta: { caseId: 'CASE-971' } }, () => {});`);
    expect(followedSource.cases.map((item) => item.source === 'vitest' ? item.parametersSource : undefined)).toEqual(['[\n  [account()],\n]']);
    const letTable = await read('let-table', `let codes = ['A'];\n${marker}\ntest.each(codes)('code %s', { meta: { caseId: 'CASE-964' } }, () => {});`);
    expect(letTable.diagnostics).toEqual([]);
    expect(letTable.cases.map((item) => item.source === 'vitest' ? [item.parameters, item.parametersSource] : undefined)).toEqual([[undefined, 'codes']]);
    const computed = await read('computed', `const account = (code: string | null) => ({ code });\n${marker}\ntest.each([\n  ['null', null],\n  ['missing', account(null)],\n])('row %s', { meta: { caseId: 'CASE-965' } }, () => {});`);
    expect(computed.diagnostics).toEqual([]);
    expect(computed.cases.map((item) => item.source === 'vitest' ? item.parametersSource : undefined)).toEqual(["[\n  ['null', null],\n  ['missing', account(null)],\n]"]);
    const template = await read('template', `${marker}\ntest.each\`\n  a | b\n  \${1} | \${2}\n\`('row $a', { meta: { caseId: 'CASE-966' } }, () => {});`);
    expect(template.diagnostics).toEqual([]);
    expect(template.cases.map((item) => item.source === 'vitest' ? item.parametersSource : undefined)).toEqual(['`\n  a | b\n  ${1} | ${2}\n`']);
  });

  it('keeps expressions, spreads, and computed keys inside an inline each table as source text', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-each-values-'));
    for (const [name, cell] of [['expression', 'external'], ['spread', '...[1]'], ['computed', "{ ['key']: 1 }"]] as const) {
      const file = path.join(root, `${name}.test.ts`);
      await writeFile(file, `import { test } from 'vitest';\nconst external = 1;\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest.each([[${cell}]])('unsupported %s', { meta: { caseId: 'CASE-999' } }, () => {});\n`, 'utf8');
      const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
      const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, documents);
      expect(result.diagnostics).toEqual([]);
      expect(result.cases.map((item) => item.source === 'vitest' ? [item.parameters, item.parametersSource] : undefined)).toEqual([[undefined, `[[${cell}]]`]]);
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
    await writeFile(file, `import { test } from 'vitest';\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\ntest('placed', { meta: { caseId: 'CASE-999' } }, () => {\n  /*\n  @case-doc\n  preconditions: [signed in]\n  */\n});\n`, 'utf8');
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, documents);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases[0]?.fields).not.toHaveProperty('preconditions');
    expect(result.cases[0]?.details).toEqual({ preconditions: ['signed in'] });
  });

  it('diagnoses marked wrappers, namespace calls, and Story factories instead of silently dropping them', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-unsupported-declarations-'));
    const marker = `/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/`;
    for (const [name, declaration] of [['wrapper', `const managed = () => {};\n${marker}\nmanaged('x', () => {});`], ['namespace', `import * as runner from 'vitest';\n${marker}\nrunner.test('x', () => {});`]] as const) {
      const file = path.join(root, `${name}.test.ts`);
      await writeFile(file, `${declaration}\n`, 'utf8');
      expect((await readTestSource(file, root, 'vitest', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM203')).toBe(true);
    }
    const story = path.join(root, 'Factory.stories.tsx');
    await writeFile(story, `const makeStory = () => ({});\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/\nexport const Factory = makeStory();\n`, 'utf8');
    expect((await readTestSource(story, root, 'storybook', 'unit', loaded.rules, [])).diagnostics.some((item) => item.code === 'TM222')).toBe(true);
  });

  it('maps supported Vitest and Playwright modifiers to definition status', async () => {
    const loaded = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    if (!loaded.rules) return;
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-modifiers-'));
    const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
    const comment = `/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/`;
    const vitestFile = path.join(root, 'modifiers.test.ts');
    await writeFile(vitestFile, `import { test } from 'vitest';\n${comment}\ntest.skip('skip', { meta: { caseId: 'CASE-901' } }, () => {});\n${comment}\ntest.todo('todo', { meta: { caseId: 'CASE-902' } });\n${comment}\ntest.only('only', { meta: { caseId: 'CASE-903' } }, () => {});\n${comment}\ntest.concurrent('concurrent', { meta: { caseId: 'CASE-904' } }, () => {});\n${comment}\ntest.fails('fails', { meta: { caseId: 'CASE-905' } }, () => {});\n`, 'utf8');
    const vitest = await readTestSource(vitestFile, root, 'vitest', 'unit', loaded.rules, documents);
    expect(vitest.diagnostics).toEqual([]);
    expect(vitest.cases.map((item) => [item.id, item.status])).toEqual([['CASE-901', 'skip'], ['CASE-902', 'todo'], ['CASE-903', 'active'], ['CASE-904', 'active'], ['CASE-905', 'active']]);
    const playwrightFile = path.join(root, 'modifiers.spec.ts');
    await writeFile(playwrightFile, `import { test } from '@playwright/test';\n${comment}\ntest.skip('skip', { annotation: { type: 'case-id', description: 'CASE-911' } }, () => {});\n${comment}\ntest.fixme('fixme', { annotation: { type: 'case-id', description: 'CASE-912' } }, () => {});\n${comment}\ntest.only('only', { annotation: { type: 'case-id', description: 'CASE-913' } }, () => {});\n${comment}\ntest.fail('fail', { annotation: { type: 'case-id', description: 'CASE-914' } }, () => {});\n`, 'utf8');
    const playwright = await readTestSource(playwrightFile, root, 'playwright', 'unit', loaded.rules, documents);
    expect(playwright.diagnostics).toEqual([]);
    expect(playwright.cases.map((item) => [item.id, item.status])).toEqual([['CASE-911', 'skip'], ['CASE-912', 'skip'], ['CASE-913', 'active'], ['CASE-914', 'active']]);
  });
});
