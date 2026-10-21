import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentIdSchema } from './ids.js';
import { loadRules } from './rules.js';
import { readTestSource } from './source.js';

const rankField = "    rank: { required: true, placement: classification, type: enum, playwrightTag: '@rank-{value}', values: { S: { description: s }, A: { description: a } } }\n";
const suiteField = "    suite: { required: false, placement: classification, type: enum, playwrightTag: '@{value}', values: { smoke: { description: smoke }, regression: { description: regression } } }\n";
const documents = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'domain', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];
const marker = '/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\n*/';

const setup = async (fields: string) => {
  const root = await mkdtemp(path.join(tmpdir(), 'test-manager-playwright-tags-'));
  const config = path.join(root, 'test-manager.yaml');
  await writeFile(config, (await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8')).replace('    reason: {', `${fields}    reason: {`), 'utf8');
  const loaded = await loadRules(config);
  expect(loaded.diagnostics).toEqual([]);
  if (!loaded.rules) throw new Error('rules did not load');
  const rules = loaded.rules;
  return {
    read: async (body: string) => {
      const file = path.join(root, 'tags.spec.ts');
      await writeFile(file, `import { test } from '@playwright/test';\n${body}\n`, 'utf8');
      return readTestSource(file, root, 'playwright', 'e2e', rules, documents);
    },
    config,
  };
};

describe('Playwright tags as case fields', () => {
  it('reads tag fields from the test and every enclosing describe, ignoring unrelated tags', async () => {
    const { read } = await setup(rankField + suiteField);
    const result = await read(`test.describe('outer', { tag: '@regression' }, () => {\n  test.describe('inner', () => {\n    ${marker}\n    test('tagged', { tag: ['@rank-A', '@pagination'], annotation: { type: 'case-id', description: 'CASE-901' } }, async () => {});\n  });\n});`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases.map((item) => [item.id, item.fields.rank, item.fields.suite])).toEqual([['CASE-901', 'A', 'regression']]);
  });

  it('applies required rules to tag fields', async () => {
    const { read } = await setup(rankField);
    const result = await read(`${marker}\ntest('untagged', { annotation: { type: 'case-id', description: 'CASE-902' } }, async () => {});`);
    expect(result.cases).toEqual([]);
    expect(result.diagnostics.map((item) => [item.code, item.subject])).toEqual([['TM121', 'rank']]);
  });

  it('rejects tags that set one field twice, dynamic tags, and tag fields written in @case', async () => {
    const { read } = await setup(rankField);
    const twice = await read(`${marker}\ntest('twice', { tag: ['@rank-S', '@rank-A'], annotation: { type: 'case-id', description: 'CASE-903' } }, async () => {});`);
    expect(twice.diagnostics.map((item) => [item.code, item.reason])).toEqual([['TM212', 'tags set rank to several values: S, A']]);
    const dynamic = await read(`const rank = '@rank-A';\n${marker}\ntest('dynamic', { tag: [rank], annotation: { type: 'case-id', description: 'CASE-904' } }, async () => {});`);
    expect(dynamic.diagnostics.map((item) => item.code)).toEqual(['TM211']);
    const inMarker = await read(`/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\nrank: A\n*/\ntest('marker', { tag: '@rank-A', annotation: { type: 'case-id', description: 'CASE-905' } }, async () => {});`);
    expect(inMarker.diagnostics.map((item) => item.code)).toEqual(['TM213']);
    expect([twice, dynamic, inMarker].flatMap((result) => result.cases)).toEqual([]);
  });

  it('keeps a repeated tag on the test and its describe as one value', async () => {
    const { read } = await setup(rankField);
    const result = await read(`test.describe('group', { tag: '@rank-S' }, () => {\n  ${marker}\n  test('repeated', { tag: '@rank-S', annotation: { type: 'case-id', description: 'CASE-906' } }, async () => {});\n});`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases.map((item) => item.fields.rank)).toEqual(['S']);
  });

  it('reads describe variants and tags on skipped tests, but not describes of another root', async () => {
    const { read } = await setup(rankField + suiteField);
    const result = await read(`import { test as base } from '@playwright/test';\nbase.describe('other', { tag: '@smoke' }, () => {\n  test.describe.serial('serial', { tag: '@regression' }, () => {\n    test.describe('plain', () => {\n      ${marker}\n      test.fixme('fixme', { tag: '@rank-S', annotation: { type: 'case-id', description: 'CASE-911' } }, async () => {});\n    });\n  });\n});`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases.map((item) => [item.id, item.status, item.fields.rank, item.fields.suite])).toEqual([['CASE-911', 'skip', 'S', 'regression']]);
  });

  it('diagnoses options that cannot be read statically, but not methods that cannot hold tags', async () => {
    const { read } = await setup(rankField);
    const codes = async (body: string) => (await read(body)).diagnostics.map((item) => item.code);
    const id = (value: string) => `annotation: { type: 'case-id', description: '${value}' }`;
    expect(await codes(`const options = { tag: '@rank-A' };\n${marker}\ntest('variable', options, async () => {});`)).toContain('TM211');
    expect(await codes(`const base = { tag: '@rank-A' };\n${marker}\ntest('spread', { ...base, ${id('CASE-912')} }, async () => {});`)).toContain('TM211');
    expect(await codes(`const more = {};\n${marker}\ntest('spread after', { tag: '@rank-A', ${id('CASE-913')}, ...more }, async () => {});`)).toContain('TM211');
    expect(await codes(`const group = { tag: '@rank-A' };\ntest.describe('group', group, () => {\n  ${marker}\n  test('inside', { tag: '@rank-A', ${id('CASE-914')} }, async () => {});\n});`)).toContain('TM211');
    expect(await codes(`${marker}\ntest('method', { tag: '@rank-A', ${id('CASE-915')}, toString() { return ''; } }, async () => {});`)).not.toContain('TM211');
  });

  it('lets overlapping templates each take only their own enum values', async () => {
    const { read } = await setup(rankField + suiteField);
    const result = await read(`${marker}\ntest('overlap', { tag: ['@rank-A', '@smoke'], annotation: { type: 'case-id', description: 'CASE-916' } }, async () => {});`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases.map((item) => [item.fields.rank, item.fields.suite])).toEqual([['A', 'smoke']]);
  });

  it('ignores playwrightTag for Vitest cases, which keep the value in @case', async () => {
    const { config } = await setup(rankField);
    const loaded = await loadRules(config);
    if (!loaded.rules) throw new Error('rules did not load');
    const root = path.dirname(config);
    const file = path.join(root, 'tags.test.ts');
    await writeFile(file, `import { test } from 'vitest';\n/*\n@case\nbelongsTo: orders\nrole: product\nimpact: 1\nrank: S\n*/\ntest('vitest', { meta: { caseId: 'CASE-917' } }, () => {});\n`, 'utf8');
    const result = await readTestSource(file, root, 'vitest', 'unit', loaded.rules, documents);
    expect(result.diagnostics).toEqual([]);
    expect(result.cases.map((item) => item.fields.rank)).toEqual(['S']);
  });

  it('reads tests imported from configured runner modules, including relative fixtures resolved by path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-runner-modules-'));
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, `${(await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8'))}runners:\n  playwright:\n    testModules: ['@company/e2e/fixtures', 'apps/**/__e2e__/fixtures']\n`, 'utf8');
    const loaded = await loadRules(config);
    expect(loaded.diagnostics).toEqual([]);
    if (!loaded.rules) throw new Error('rules did not load');
    const rules = loaded.rules;
    const ids = async (relative: string, specifier: string) => {
      const file = path.join(root, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `import { test } from '${specifier}';\n${marker}\ntest('case', { annotation: { type: 'case-id', description: 'CASE-950' } }, async () => {});\n`, 'utf8');
      return (await readTestSource(file, root, 'playwright', 'e2e', rules, documents)).cases.map((item) => item.id);
    };
    expect(await ids('apps/web/screen/__e2e__/a.spec.ts', './fixtures')).toEqual(['CASE-950']);
    expect(await ids('apps/web/screen/__e2e__/nested/b.spec.ts', '../fixtures.ts')).toEqual(['CASE-950']);
    expect(await ids('apps/web/other/c.spec.ts', '@company/e2e/fixtures')).toEqual(['CASE-950']);
    expect(await ids('apps/web/other/d.spec.ts', '@playwright/test')).toEqual(['CASE-950']);
    expect(await ids('apps/web/screen/__e2e__/g.spec.ts', './fixtures/index.js')).toEqual(['CASE-950']);
    expect(await ids('apps/web/screen/__e2e__/h.spec.ts', './fixtures.ts?raw')).toEqual(['CASE-950']);
    expect(await ids('apps/web/other/e.spec.ts', './helpers')).toEqual([]);
    expect(await ids('apps/web/other/f.spec.ts', '@company/other')).toEqual([]);
  });

  it('reads Vitest tests imported from configured modules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-vitest-modules-'));
    const config = path.join(root, 'test-manager.yaml');
    await writeFile(config, `${(await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8'))}runners:\n  vitest:\n    testModules: ['src/test-utils']\n`, 'utf8');
    const loaded = await loadRules(config);
    if (!loaded.rules) throw new Error('rules did not load');
    const file = path.join(root, 'src/domain/a.test.ts');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `import { it } from '../test-utils';\n${marker}\nit('case', { meta: { caseId: 'CASE-951' } }, () => {});\n`, 'utf8');
    expect((await readTestSource(file, root, 'vitest', 'unit', loaded.rules, documents)).cases.map((item) => item.id)).toEqual(['CASE-951']);
  });

  it('rejects invalid tag templates and tag fields outside classification', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-playwright-tag-rules-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    for (const [name, field] of [
      ['no-placeholder', "    rank: { required: false, placement: classification, type: enum, playwrightTag: '@rank', values: { A: { description: a } } }\n"],
      ['no-at', "    rank: { required: false, placement: classification, type: enum, playwrightTag: 'rank-{value}', values: { A: { description: a } } }\n"],
      ['detail', "    rank: { required: false, placement: detail, type: enum, playwrightTag: '@rank-{value}', values: { A: { description: a } } }\n"],
      ['text', "    rank: { required: false, placement: classification, type: text, playwrightTag: '@rank-{value}' }\n"],
    ] as const) {
      const config = path.join(root, `${name}.yaml`);
      await writeFile(config, source.replace('    reason: {', `${field}    reason: {`), 'utf8');
      const loaded = await loadRules(config);
      expect(loaded.rules, name).toBeUndefined();
    }
  });
});
