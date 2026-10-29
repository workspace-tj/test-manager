import { describe, expect, it } from 'vitest';
import { createCaseFieldParser, parseCaseFields } from './case-fields.js';
import { documentIdSchema } from './ids.js';
import type { FieldRule, KnowledgeDocument } from './model.js';

const rules = {
  belongsTo: { type: 'reference', targetKinds: ['feature'], required: true, placement: 'classification' },
  reason: { type: 'text', required: false, placement: 'detail', requiredWhen: { field: 'source', in: ['vitest'] } },
} as const satisfies Readonly<Record<string, FieldRule>>;
const documents: KnowledgeDocument[] = [{ id: documentIdSchema(/.*/u).parse('orders'), kind: 'feature', title: 'Orders', body: '', location: { file: 'orders.md', line: 1, column: 1 } }];

describe('case field parser', () => {
  it('reuses project validation while reporting each case input and source location independently', () => {
    const parse = createCaseFieldParser({ source: 'vitest', layer: 'unit' }, rules, documents, /^[a-z]+$/u);
    expect(parse({ belongsTo: 'orders', reason: 'normal' }, 'first.ts').ok).toBe(true);
    expect(parse({ belongsTo: 'missing', reason: 'normal' }, 'second.ts', { file: 'second.ts', line: 7, column: 3 })).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'TM126', location: { file: 'second.ts', line: 7, column: 3 } })] });
    const input = { belongsTo: 'orders' };
    expect(parse(input, 'third.ts')).toEqual(parseCaseFields(input, { source: 'vitest', layer: 'unit' }, rules, documents, /^[a-z]+$/u, 'third.ts'));
    expect(parse(input, 'third.ts')).toMatchObject({ ok: false, diagnostics: [{ code: 'TM121', subject: 'reason' }] });
    expect(createCaseFieldParser({ source: 'manual', layer: 'manual' }, rules, documents, /^[a-z]+$/u)(input, 'fourth.yaml').ok).toBe(true);
    expect(parse({ belongsTo: 'orders', reason: 'again' }, 'fifth.ts').ok).toBe(true);
  });
});
