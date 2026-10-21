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
    expect(result.rules?.documents.displayOrder).toEqual({ module: ['MOD-2', 'MOD-1'] });
    const role = result.rules?.case.fields.role;
    const impact = result.rules?.case.fields.impact;
    expect(Object.keys(role?.type === 'enum' ? role.values : {})).toEqual(['contract']);
    expect(Object.keys(impact?.type === 'integer-enum' ? impact.values : {})).toEqual(['10', '20']);
  });

  it('accepts optional display labels without changing stable field keys and values', async () => {
    const result = await loadRules(path.resolve('fixtures/valid/test-manager.yaml'));
    expect(result.diagnostics).toEqual([]);
    const role = result.rules?.case.fields.role;
    expect(role?.label).toBe('確認担当');
    expect(role?.type === 'enum' && role.values.product).toEqual({ label: 'プロダクト', description: 'プロダクトの振る舞い' });
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
        refs: { required: false, placement: 'classification', requiredWhen: { field: 'role', in: ['product'] }, type: 'reference-list', targetKinds: ['area'] },
      },
      [{ id: documentIdSchema(/.*/u).parse('area'), kind: 'area', title: 'Area', body: '', location: { file: 'area.md', line: 1, column: 1 } }],
      'case.ts',
    );
    expect(diagnostics.map((item) => item.code)).toEqual(['TM121']);
    expect(diagnostics[0]?.reason).toContain('required when role');
  });

  it('supports requiredWhen conditioned on the case source', () => {
    const rules = {
      belongsTo: { required: true as const, placement: 'classification' as const, type: 'reference' as const, targetKinds: ['area'] },
      device: { required: false as const, placement: 'classification' as const, requiredWhen: { field: 'source', in: ['playwright'] }, type: 'text' as const },
    };
    const documents = [{ id: documentIdSchema(/.*/u).parse('area'), kind: 'area', title: 'Area', body: '', location: { file: 'area.md', line: 1, column: 1 } }];
    const diagnostics = validateCaseFields({ belongsTo: 'area' }, rules, documents, 'case.ts', { source: 'playwright', layer: 'e2e' });
    expect(diagnostics.map((item) => item.code)).toEqual(['TM121']);
    expect(diagnostics[0]?.reason).toContain('required when source');
    expect(validateCaseFields({ belongsTo: 'area' }, rules, documents, 'case.ts', { source: 'vitest', layer: 'unit' })).toEqual([]);
  });

  it('requires a field when the condition matches any value listed in requiredWhen.in', () => {
    const rules = {
      belongsTo: { required: true as const, placement: 'classification' as const, type: 'reference' as const, targetKinds: ['area'] },
      characteristic: { required: false as const, placement: 'classification' as const, requiredWhen: { field: 'layer', in: ['e2e', 'integration'] }, type: 'text' as const },
    };
    const documents = [{ id: documentIdSchema(/.*/u).parse('area'), kind: 'area', title: 'Area', body: '', location: { file: 'area.md', line: 1, column: 1 } }];
    const integration = validateCaseFields({ belongsTo: 'area' }, rules, documents, 'case.ts', { source: 'vitest', layer: 'integration' });
    expect(integration.map((item) => item.code)).toEqual(['TM121']);
    expect(integration[0]?.reason).toContain('required when layer is one of "e2e", "integration"');
    expect(validateCaseFields({ belongsTo: 'area' }, rules, documents, 'case.ts', { source: 'playwright', layer: 'e2e' }).map((item) => item.code)).toEqual(['TM121']);
    expect(validateCaseFields({ belongsTo: 'area' }, rules, documents, 'case.ts', { source: 'vitest', layer: 'unit' })).toEqual([]);
  });

  it('accepts requiredWhen.in from configuration and reports each value that cannot match', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-rule-condition-in-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    const target = 'required: false, placement: classification, type: reference-list';
    await writeFile(path.join(root, 'valid.yaml'), source.replace(target, 'required: false, placement: classification, requiredWhen: { field: layer, in: [e2e, unit] }, type: reference-list'), 'utf8');
    const valid = await loadRules(path.join(root, 'valid.yaml'));
    expect(valid.diagnostics).toEqual([]);
    expect(valid.rules?.case.fields.refs?.requiredWhen).toEqual({ field: 'layer', in: ['e2e', 'unit'] });
    await writeFile(path.join(root, 'invalid.yaml'), source.replace(target, 'required: false, placement: classification, requiredWhen: { field: layer, in: [e2e, integration] }, type: reference-list'), 'utf8');
    const invalid = await loadRules(path.join(root, 'invalid.yaml'));
    expect(invalid.diagnostics.map((item) => item.subject)).toEqual(['case.fields.refs.requiredWhen.in.1']);
    for (const [name, condition] of [['both', '{ field: layer, equals: e2e, in: [unit] }'], ['empty', '{ field: layer, in: [] }'], ['duplicate', '{ field: layer, in: [e2e, e2e] }']] as const) {
      await writeFile(path.join(root, `${name}.yaml`), source.replace(target, `required: false, placement: classification, requiredWhen: ${condition}, type: reference-list`), 'utf8');
      const rejected = await loadRules(path.join(root, `${name}.yaml`));
      expect(rejected.rules).toBeUndefined();
      expect(rejected.diagnostics.some((item) => item.subject.startsWith('case.fields.refs.requiredWhen'))).toBe(true);
    }
    await writeFile(path.join(root, 'integer.yaml'), source.replace(target, 'required: false, placement: classification, requiredWhen: { field: impact, in: [1, "2"] }, type: reference-list'), 'utf8');
    expect((await loadRules(path.join(root, 'integer.yaml'))).diagnostics.map((item) => item.subject)).toEqual(['case.fields.refs.requiredWhen.in.1']);
  });

  it('distinguishes missing references from disallowed target kinds', () => {
    const rule = { belongsTo: { required: true, placement: 'classification' as const, type: 'reference' as const, targetKinds: ['area'] } };
    const documents = [{ id: documentIdSchema(/.*/u).parse('spec'), kind: 'specification', title: 'Spec', body: '', location: { file: 'spec.md', line: 1, column: 1 } }];
    expect(validateCaseFields({ belongsTo: 'missing' }, rule, documents, 'case.ts').map((item) => item.code)).toEqual(['TM126']);
    expect(validateCaseFields({ belongsTo: 'spec' }, rule, documents, 'case.ts').map((item) => item.code)).toEqual(['TM127']);
  });

  it('rejects requiredWhen layer values that no discovery source defines', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-rule-layer-condition-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    await writeFile(path.join(root, 'test-manager.yaml'), source.replace('required: false, placement: classification, type: reference-list', 'required: false, placement: classification, requiredWhen: { field: layer, equals: integration }, type: reference-list'), 'utf8');
    const result = await loadRules(path.join(root, 'test-manager.yaml'));
    expect(result.rules).toBeUndefined();
    expect(result.diagnostics.some((item) => item.subject.endsWith('requiredWhen.equals') && item.reason.includes('e2e, unit, ui'))).toBe(true);
    await writeFile(path.join(root, 'numeric.yaml'), source.replace('layer: unit', 'layer: "1"').replace('required: false, placement: classification, type: reference-list', 'required: false, placement: classification, requiredWhen: { field: layer, equals: 1 }, type: reference-list'), 'utf8');
    const numeric = await loadRules(path.join(root, 'numeric.yaml'));
    expect(numeric.rules).toBeUndefined();
    expect(numeric.diagnostics.some((item) => item.subject.endsWith('requiredWhen.equals'))).toBe(true);
  });

  it('requires a layer on every discovery source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-rule-layer-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    await writeFile(path.join(root, 'missing-layer.yaml'), source.replace('      layer: unit\n', ''), 'utf8');
    const missing = await loadRules(path.join(root, 'missing-layer.yaml'));
    expect(missing.rules).toBeUndefined();
    expect(missing.diagnostics.some((item) => item.subject.endsWith('layer'))).toBe(true);
  });

  it('rejects requiredWhen source values that are not case sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-rule-source-condition-'));
    const source = await readFile(path.resolve('fixtures/valid/test-manager.yaml'), 'utf8');
    await writeFile(path.join(root, 'test-manager.yaml'), source.replace('required: false, placement: classification, type: reference-list', 'required: false, placement: classification, requiredWhen: { field: source, equals: cypress }, type: reference-list'), 'utf8');
    const result = await loadRules(path.join(root, 'test-manager.yaml'));
    expect(result.rules).toBeUndefined();
    expect(result.diagnostics.some((item) => item.subject.endsWith('requiredWhen.equals'))).toBe(true);
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

  it('rejects duplicate document IDs in a display order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-display-order-'));
    const source = await readFile(path.resolve('fixtures/alternate-rules.yaml'), 'utf8');
    await writeFile(path.join(root, 'test-manager.yaml'), source.replace('[MOD-2, MOD-1]', '[MOD-1, MOD-1]'), 'utf8');
    const result = await loadRules(path.join(root, 'test-manager.yaml'));
    expect(result.rules).toBeUndefined();
    expect(result.diagnostics.some((item) => item.subject === 'documents.displayOrder.module')).toBe(true);
  });
});
