import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRules } from './rules.js';
import { validateCaseFields } from './case-fields.js';
import { documentIdSchema } from './ids.js';

describe('project-defined vocabulary', () => {
  it('accepts a different document kind, role vocabulary, and impact scale', async () => {
    const result = await loadRules(path.resolve('fixtures/alternate-rules.yaml'));
    expect(result.diagnostics).toEqual([]);
    expect(result.rules?.documents.kinds.module).toBeDefined();
    const role = result.rules?.case.fields.role;
    const impact = result.rules?.case.fields.impact;
    expect(Object.keys(role?.type === 'enum' ? role.values : {})).toEqual(['contract']);
    expect(Object.keys(impact?.type === 'integer-enum' ? impact.values : {})).toEqual(['10', '20']);
  });

  it('rejects unknown config keys', async () => {
    const result = await loadRules(path.resolve('fixtures/invalid/test-manager.yaml'));
    expect(result.rules).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === 'TM003' && item.subject === 'unexpected')).toBe(true);
  });

  it('rejects a rule set that cannot produce the required membership invariant', async () => {
    const result = await loadRules(path.resolve('fixtures/invalid/test-manager.yaml'));
    expect(result.diagnostics.some((item) => item.subject === 'case.fields.belongsTo')).toBe(true);
  });

  it('supports project-defined conditional required fields', () => {
    const diagnostics = validateCaseFields(
      { belongsTo: 'area', role: 'product' },
      {
        belongsTo: { required: true, placement: 'classification', type: 'reference', targetKinds: ['area'] },
        role: { required: true, placement: 'classification', type: 'enum', values: { product: { description: 'product' } } },
        refs: { required: false, placement: 'classification', requiredWhen: { field: 'role', equals: 'product' }, type: 'reference-list', targetKinds: ['area'] },
      },
      [{ id: documentIdSchema(/.*/u).parse('area'), kind: 'area', title: 'Area', body: '', location: { file: 'area.md', line: 1, column: 1 } }],
      'case.ts',
    );
    expect(diagnostics.map((item) => item.code)).toEqual(['TM121']);
    expect(diagnostics[0]?.reason).toContain('required when role');
  });

  it('distinguishes missing references from disallowed target kinds', () => {
    const rule = { belongsTo: { required: true, placement: 'classification' as const, type: 'reference' as const, targetKinds: ['area'] } };
    const documents = [{ id: documentIdSchema(/.*/u).parse('spec'), kind: 'specification', title: 'Spec', body: '', location: { file: 'spec.md', line: 1, column: 1 } }];
    expect(validateCaseFields({ belongsTo: 'missing' }, rule, documents, 'case.ts').map((item) => item.code)).toEqual(['TM126']);
    expect(validateCaseFields({ belongsTo: 'spec' }, rule, documents, 'case.ts').map((item) => item.code)).toEqual(['TM127']);
  });

  it('rejects requiredWhen values that cannot match the target field', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-rule-condition-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    await writeFile(path.join(root, 'test-manager.yaml'), source.replace('required: false, placement: classification, type: reference-list', 'required: false, placement: classification, requiredWhen: { field: impact, equals: impossible }, type: reference-list'), 'utf8');
    const result = await loadRules(path.join(root, 'test-manager.yaml'));
    expect(result.rules).toBeUndefined();
    expect(result.diagnostics.some((item) => item.subject.endsWith('requiredWhen.equals'))).toBe(true);
  });

  it('rejects case field names reserved by the common model', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-reserved-field-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    await writeFile(path.join(root, 'test-manager.yaml'), `${source}\n    status: { required: false, placement: classification, type: text }\n`, 'utf8');
    const result = await loadRules(path.join(root, 'test-manager.yaml'));
    expect(result.rules).toBeUndefined();
    expect(result.diagnostics.some((item) => item.subject === 'case.fields.status')).toBe(true);
  });

  it('rejects the legacy owner field instead of giving membership two names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-legacy-owner-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    await writeFile(path.join(root, 'test-manager.yaml'), `${source}\n    owner: { required: false, placement: classification, type: text }\n`, 'utf8');
    const result = await loadRules(path.join(root, 'test-manager.yaml'));
    expect(result.rules).toBeUndefined();
    expect(result.diagnostics.some((item) => item.subject === 'case.fields.owner')).toBe(true);
  });
});
