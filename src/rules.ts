import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { diagnostic } from './diagnostics.js';
import type { Diagnostic, FieldRule, ProjectRules } from './model.js';
import { parseStrictYaml, yamlPathLine } from './yaml.js';

const KindRuleSchema = z.object({
  description: z.string().min(1),
  parent: z.object({ required: z.boolean(), targetKinds: z.array(z.string().min(1)) }).strict(),
}).strict();

const RequirednessShape = {
  required: z.boolean(),
  placement: z.enum(['classification', 'detail']),
  requiredWhen: z.object({ field: z.string().min(1), equals: z.union([z.string(), z.number().int()]) }).strict().optional(),
} as const;

const ValuesSchema = z.record(z.string(), z.object({ description: z.string().min(1) }).strict())
  .refine((values) => Object.keys(values).length > 0, 'values must not be empty');

const DisplayOrderSchema = z.record(
  z.string(),
  z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length, 'must contain unique document IDs'),
);

const FieldRuleSchema = z.discriminatedUnion('type', [
  z.object({ ...RequirednessShape, type: z.literal('reference'), targetKinds: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('reference-list'), targetKinds: z.array(z.string().min(1)).min(1), minItems: z.number().int().nonnegative().optional(), uniqueItems: z.boolean().optional() }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('enum'), values: ValuesSchema }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('integer-enum'), values: ValuesSchema }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('text') }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('text-list'), minItems: z.number().int().nonnegative().optional(), uniqueItems: z.boolean().optional() }).strict(),
]).superRefine((field, context) => {
  if (field.required && field.requiredWhen) context.addIssue({ code: 'custom', message: 'required and requiredWhen are mutually exclusive' });
});

const RulesShape = z.object({
  version: z.literal(1),
  idPattern: z.string().min(1).refine((value) => {
    try { new RegExp(value); return true; } catch { return false; }
  }, 'must be a valid regular expression'),
  discovery: z.object({
    documents: z.array(z.string().min(1)).min(1),
    manualCases: z.array(z.string().min(1)),
    sources: z.array(z.object({
      kind: z.enum(['vitest', 'playwright', 'storybook']),
      paths: z.array(z.string().min(1)).min(1),
    }).strict()),
  }).strict(),
  documents: z.object({
    kinds: z.record(z.string(), KindRuleSchema),
    displayOrder: DisplayOrderSchema.optional().default({}),
  }).strict(),
  case: z.object({ fields: z.record(z.string(), FieldRuleSchema) }).strict(),
}).strict();

const validateRuleRelationships = (rules: z.infer<typeof RulesShape>, context: z.RefinementCtx): void => {
  const reservedFields = new Set(['id', 'title', 'steps', 'source', 'status', 'details', 'procedure', 'parameters', 'location', 'snippet', 'owner']);
  for (const name of Object.keys(rules.case.fields)) if (reservedFields.has(name)) context.addIssue({ code: 'custom', path: ['case', 'fields', name], message: `${name} is reserved by the case model` });
  const belongsTo = rules.case.fields.belongsTo;
  if (!belongsTo || !belongsTo.required || belongsTo.type !== 'reference') {
    context.addIssue({ code: 'custom', path: ['case', 'fields', 'belongsTo'], message: 'belongsTo must be a required reference field' });
  }
  if (belongsTo?.placement !== 'classification') context.addIssue({ code: 'custom', path: ['case', 'fields', 'belongsTo', 'placement'], message: 'belongsTo must be a classification field' });
  const refs = rules.case.fields.refs;
  if (refs && refs.type !== 'reference-list') context.addIssue({ code: 'custom', path: ['case', 'fields', 'refs'], message: 'refs must be a reference-list field' });
  if (refs?.placement === 'detail') context.addIssue({ code: 'custom', path: ['case', 'fields', 'refs', 'placement'], message: 'refs must be a classification field' });
  for (const [name, field] of Object.entries(rules.case.fields)) {
    if (field.requiredWhen) {
      const conditionField = rules.case.fields[field.requiredWhen.field];
      if (conditionField === undefined) {
        context.addIssue({ code: 'custom', path: ['case', 'fields', name, 'requiredWhen', 'field'], message: `unknown condition field ${field.requiredWhen.field}` });
      } else {
        const equals = field.requiredWhen.equals;
        const canMatch = conditionField.type === 'enum'
          ? typeof equals === 'string' && equals in conditionField.values
          : conditionField.type === 'integer-enum'
            ? typeof equals === 'number' && Number.isInteger(equals) && String(equals) in conditionField.values
            : conditionField.type === 'text' || conditionField.type === 'reference'
              ? typeof equals === 'string'
              : false;
        if (!canMatch) context.addIssue({ code: 'custom', path: ['case', 'fields', name, 'requiredWhen', 'equals'], message: `value cannot match ${field.requiredWhen.field}` });
      }
    }
    if (field.type === 'reference' || field.type === 'reference-list') {
      for (const targetKind of field.targetKinds) if (rules.documents.kinds[targetKind] === undefined) {
        context.addIssue({ code: 'custom', path: ['case', 'fields', name, 'targetKinds'], message: `unknown document kind ${targetKind}` });
      }
    }
  }
  for (const [kind, rule] of Object.entries(rules.documents.kinds)) {
    for (const targetKind of rule.parent.targetKinds) if (rules.documents.kinds[targetKind] === undefined) {
      context.addIssue({ code: 'custom', path: ['documents', 'kinds', kind, 'parent', 'targetKinds'], message: `unknown document kind ${targetKind}` });
    }
  }
  for (const kind of Object.keys(rules.documents.displayOrder)) if (rules.documents.kinds[kind] === undefined) {
    context.addIssue({ code: 'custom', path: ['documents', 'displayOrder', kind], message: `unknown document kind ${kind}` });
  }
};

const RulesSchema = RulesShape.superRefine(validateRuleRelationships);

const normalizeFieldRule = (field: z.infer<typeof FieldRuleSchema>): FieldRule => {
  const requiredness = field.required
    ? { required: true } as const
    : { required: false, ...(field.requiredWhen ? { requiredWhen: field.requiredWhen } : {}) } as const;
  switch (field.type) {
    case 'reference': return { ...requiredness, placement: field.placement, type: field.type, targetKinds: field.targetKinds };
    case 'reference-list': return { ...requiredness, placement: field.placement, type: field.type, targetKinds: field.targetKinds, ...(field.minItems !== undefined ? { minItems: field.minItems } : {}), ...(field.uniqueItems !== undefined ? { uniqueItems: field.uniqueItems } : {}) };
    case 'enum': return { ...requiredness, placement: field.placement, type: field.type, values: field.values };
    case 'integer-enum': return { ...requiredness, placement: field.placement, type: field.type, values: field.values };
    case 'text': return { ...requiredness, placement: field.placement, type: field.type };
    case 'text-list': return { ...requiredness, placement: field.placement, type: field.type, ...(field.minItems !== undefined ? { minItems: field.minItems } : {}), ...(field.uniqueItems !== undefined ? { uniqueItems: field.uniqueItems } : {}) };
  }
};

const normalizeFieldRules = (fields: z.infer<typeof RulesShape>['case']['fields']): Readonly<Record<string, FieldRule>> => {
  const normalized: Record<string, FieldRule> = {};
  for (const [name, field] of Object.entries(fields)) normalized[name] = normalizeFieldRule(field);
  return normalized;
};

export const loadRules = async (
  configPath: string,
): Promise<Readonly<{ rules?: ProjectRules; diagnostics: ReadonlyArray<Diagnostic> }>> => {
  const absolute = path.resolve(configPath);
  let source: string;
  try {
    source = await readFile(absolute, 'utf8');
  } catch (error) {
    return { diagnostics: [diagnostic('TM002', absolute, 'config', `cannot read: ${String(error)}`)] };
  }
  const parsed = parseStrictYaml(source, absolute);
  if (parsed.diagnostics.length > 0) return { diagnostics: parsed.diagnostics };
  const result = RulesSchema.safeParse(parsed.value);
  if (!result.success) {
    return { diagnostics: result.error.issues.map((issue) => {
      const unknownKey = issue.code === 'unrecognized_keys' ? issue.keys[0] : undefined;
      const issuePath = [...issue.path, ...(unknownKey ? [unknownKey] : [])];
      return diagnostic('TM003', absolute, issuePath.join('.') || 'config', issue.message, yamlPathLine(source, issuePath));
    }) };
  }
  try {
    new RegExp(result.data.idPattern);
  } catch (error) {
    return { diagnostics: [diagnostic('TM003', absolute, 'idPattern', `invalid regular expression: ${String(error)}`)] };
  }
  return { rules: { ...result.data, case: { fields: normalizeFieldRules(result.data.case.fields) } }, diagnostics: [] };
};
