import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { diagnostic } from './diagnostics.js';
import { caseSources, type Diagnostic, type FieldRule, type ProjectRules } from './model.js';
import { parseStrictYaml, yamlPathLine } from './yaml.js';
import { breakdownBuiltInAxes, breakdownFieldAllowed } from './breakdowns.js';

const KindRuleSchema = z.object({
  description: z.string().min(1),
  parent: z.object({ required: z.boolean(), targetKinds: z.array(z.string().min(1)) }).strict(),
}).strict();

// A Playwright tag template such as `@rank-{value}`; the enum value replaces `{value}`.
const PlaywrightTagSchema = z.string().refine((value) => value.startsWith('@') && value.split('{value}').length === 2, 'must start with @ and contain {value} exactly once');

const ConditionValueSchema = z.union([z.string(), z.number().int()]);

// `equals` names one value; `in` names several, any of which makes the field required.
const RequiredWhenSchema = z.union([
  z.object({ field: z.string().min(1), equals: ConditionValueSchema }).strict(),
  z.object({
    field: z.string().min(1),
    in: z.array(ConditionValueSchema).min(1).refine((values) => new Set(values).size === values.length, 'must contain unique values').meta({ uniqueItems: true }),
  }).strict(),
]).meta({ id: 'RequiredWhen' });

const conditionValues = (condition: z.infer<typeof RequiredWhenSchema>): ReadonlyArray<string | number> => 'in' in condition ? condition.in : [condition.equals];

const conditionValuePath = (condition: z.infer<typeof RequiredWhenSchema>, index: number): ReadonlyArray<string | number> => 'in' in condition ? ['in', index] : ['equals'];

const RequirednessShape = {
  label: z.string().min(1).optional(),
  // Optional only when requiredWhen states the condition; otherwise every field says whether it is required.
  required: z.boolean().optional(),
  placement: z.enum(['classification', 'detail']),
  requiredWhen: RequiredWhenSchema.optional(),
} as const;

const ValuesSchema = z.record(z.string(), z.object({ label: z.string().min(1).optional(), description: z.string().min(1) }).strict())
  .refine((values) => Object.keys(values).length > 0, 'values must not be empty');

const DisplayOrderSchema = z.record(
  z.string(),
  z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length, 'must contain unique document IDs'),
);

const FieldRuleSchema = z.discriminatedUnion('type', [
  z.object({ ...RequirednessShape, type: z.literal('reference'), targetKinds: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('reference-list'), targetKinds: z.array(z.string().min(1)).min(1), minItems: z.number().int().nonnegative().optional(), uniqueItems: z.boolean().optional() }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('enum'), values: ValuesSchema, playwrightTag: PlaywrightTagSchema.optional() }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('integer-enum'), values: ValuesSchema }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('text') }).strict(),
  z.object({ ...RequirednessShape, type: z.literal('text-list'), minItems: z.number().int().nonnegative().optional(), uniqueItems: z.boolean().optional() }).strict(),
]).superRefine((field, context) => {
  if (field.required && field.requiredWhen) context.addIssue({ code: 'custom', message: 'required and requiredWhen are mutually exclusive' });
  if (field.required === undefined && !field.requiredWhen) context.addIssue({ code: 'custom', path: ['required'], message: 'required must be set unless requiredWhen is given' });
});

const GlobsSchema = z.array(z.string().min(1)).min(1);

// One layer and the files each case source reads for it; a layer is the key, so it is always present.
const LayerSourcesSchema = z.object({
  description: z.string().min(1).optional(),
  ...Object.fromEntries(caseSources.map((kind) => [kind, GlobsSchema.optional()])) as Record<typeof caseSources[number], z.ZodOptional<typeof GlobsSchema>>,
}).strict().refine((layer) => caseSources.some((kind) => layer[kind] !== undefined), 'a layer must list files for at least one source kind')
  .meta({ anyOf: caseSources.map((kind) => ({ required: [kind] })) });

// Integer-like keys are reordered by JavaScript objects, which would lose the written layer order.
// The check runs in validateRuleRelationships so the diagnostic can name the reason; the pattern only informs editors.
const integerName = /^(?:0|[1-9][0-9]*)$/u;
const LayerNameSchema = z.string().min(1).meta({ pattern: '^(?!(?:0|[1-9][0-9]*)$)' });

const RulesShape = z.object({
  version: z.literal(1),
  idPattern: z.string().min(1).refine((value) => {
    try { new RegExp(value); return true; } catch { return false; }
  }, 'must be a valid regular expression'),
  discovery: z.object({
    documents: z.array(z.string().min(1)).min(1),
    sources: z.record(LayerNameSchema, LayerSourcesSchema),
  }).strict(),
  documents: z.object({
    kinds: z.record(z.string(), KindRuleSchema),
    displayOrder: DisplayOrderSchema.optional().default({}),
  }).strict(),
  case: z.object({ fields: z.record(z.string(), FieldRuleSchema) }).strict(),
  runners: z.object(Object.fromEntries((['vitest', 'playwright'] as const).map((kind) => [kind, z.object({
    testModules: z.array(z.string().min(1)).min(1),
  }).strict().optional()])) as Record<'vitest' | 'playwright', z.ZodOptional<z.ZodObject<{ testModules: z.ZodArray<z.ZodString> }, z.core.$strict>>>).strict().optional(),
  reports: z.object({
    breakdowns: z.array(z.object({ rows: z.string().min(1), columns: z.string().min(1) }).strict()).min(1),
  }).strict().optional(),
}).strict();

const validateRuleRelationships = (rules: z.infer<typeof RulesShape>, context: z.RefinementCtx): void => {
  const reservedFields = new Set(['id', 'title', 'steps', 'source', 'status', 'details', 'procedure', 'parameters', 'parametersSource', 'location', 'snippet', 'owner', 'layer']);
  for (const name of Object.keys(rules.case.fields)) if (reservedFields.has(name)) context.addIssue({ code: 'custom', path: ['case', 'fields', name], message: `${name} is reserved by the case model` });
  const belongsTo = rules.case.fields.belongsTo;
  if (!belongsTo || !belongsTo.required || belongsTo.type !== 'reference') {
    context.addIssue({ code: 'custom', path: ['case', 'fields', 'belongsTo'], message: 'belongsTo must be a required reference field' });
  }
  if (belongsTo?.placement !== 'classification') context.addIssue({ code: 'custom', path: ['case', 'fields', 'belongsTo', 'placement'], message: 'belongsTo must be a classification field' });
  const refs = rules.case.fields.refs;
  if (refs && refs.type !== 'reference-list') context.addIssue({ code: 'custom', path: ['case', 'fields', 'refs'], message: 'refs must be a reference-list field' });
  if (refs?.placement === 'detail') context.addIssue({ code: 'custom', path: ['case', 'fields', 'refs', 'placement'], message: 'refs must be a classification field' });
  const layers = Object.keys(rules.discovery.sources);
  for (const layer of layers) if (integerName.test(layer)) {
    context.addIssue({ code: 'custom', path: ['discovery', 'sources', layer], message: 'layer name must not be an integer, which would change the written order' });
  }
  for (const [name, field] of Object.entries(rules.case.fields)) {
    if (field.type === 'enum' && field.playwrightTag !== undefined && field.placement !== 'classification') {
      context.addIssue({ code: 'custom', path: ['case', 'fields', name, 'playwrightTag'], message: 'playwrightTag requires a classification field' });
    }
    const condition = field.requiredWhen;
    const conditionField = condition && condition.field !== 'source' && condition.field !== 'layer' ? rules.case.fields[condition.field] : undefined;
    if (condition && condition.field !== 'source' && condition.field !== 'layer' && conditionField === undefined) {
      context.addIssue({ code: 'custom', path: ['case', 'fields', name, 'requiredWhen', 'field'], message: `unknown condition field ${condition.field}` });
    } else if (condition) {
      conditionValues(condition).forEach((value, index) => {
        const path = ['case', 'fields', name, 'requiredWhen', ...conditionValuePath(condition, index)];
        if (condition.field === 'source') {
          if (!(caseSources as ReadonlyArray<unknown>).includes(value)) context.addIssue({ code: 'custom', path, message: `source must be one of ${caseSources.join(', ')}` });
        } else if (condition.field === 'layer') {
          if (!(layers as ReadonlyArray<unknown>).includes(value)) context.addIssue({ code: 'custom', path, message: `layer must be one of ${layers.join(', ')}` });
        } else if (conditionField) {
          const canMatch = conditionField.type === 'enum'
            ? typeof value === 'string' && value in conditionField.values
            : conditionField.type === 'integer-enum'
              ? typeof value === 'number' && Number.isInteger(value) && String(value) in conditionField.values
              : conditionField.type === 'text' || conditionField.type === 'reference'
                ? typeof value === 'string'
                : false;
          if (!canMatch) context.addIssue({ code: 'custom', path, message: `value cannot match ${condition.field}` });
        }
      });
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
  rules.reports?.breakdowns.forEach((breakdown, index) => {
    for (const axis of ['rows', 'columns'] as const) {
      const name = breakdown[axis];
      if ((breakdownBuiltInAxes as ReadonlyArray<string>).includes(name)) continue;
      if (!breakdownFieldAllowed(rules.case.fields[name])) context.addIssue({ code: 'custom', path: ['reports', 'breakdowns', index, axis], message: `${name} must be ${breakdownBuiltInAxes.join(', ')}, or a classification enum, integer-enum, or reference field` });
    }
    if (breakdown.rows === breakdown.columns) context.addIssue({ code: 'custom', path: ['reports', 'breakdowns', index, 'columns'], message: 'rows and columns must differ' });
  });
  for (const kind of Object.keys(rules.documents.displayOrder)) if (rules.documents.kinds[kind] === undefined) {
    context.addIssue({ code: 'custom', path: ['documents', 'displayOrder', kind], message: `unknown document kind ${kind}` });
  }
};

const RulesSchema = RulesShape.superRefine(validateRuleRelationships);

export const rulesJsonSchema = (): Record<string, unknown> => ({
  title: 'test-manager.yaml',
  description: 'Structure of a test-manager project configuration. Rules that relate several values (document kinds, requiredWhen targets, required/requiredWhen exclusivity, required being set unless requiredWhen is given, reserved field names) are checked by `test-manager check`, not by this schema.',
  ...z.toJSONSchema(RulesShape, { io: 'input' }),
});

const normalizeEnumValues = (
  values: Readonly<Record<string, Readonly<{ label?: string | undefined; description: string }>>>,
): Readonly<Record<string, Readonly<{ label?: string; description: string }>>> => Object.fromEntries(
  Object.entries(values).map(([key, value]) => [key, {
    description: value.description,
    ...(value.label === undefined ? {} : { label: value.label }),
  }]),
);

const normalizeFieldRule = (field: z.infer<typeof FieldRuleSchema>): FieldRule => {
  const requiredness = field.required
    ? { required: true } as const
    : { required: false, ...(field.requiredWhen ? { requiredWhen: { field: field.requiredWhen.field, in: conditionValues(field.requiredWhen) } } : {}) } as const;
  const presentation = field.label === undefined ? {} : { label: field.label };
  switch (field.type) {
    case 'reference': return { ...requiredness, ...presentation, placement: field.placement, type: field.type, targetKinds: field.targetKinds };
    case 'reference-list': return { ...requiredness, ...presentation, placement: field.placement, type: field.type, targetKinds: field.targetKinds, ...(field.minItems !== undefined ? { minItems: field.minItems } : {}), ...(field.uniqueItems !== undefined ? { uniqueItems: field.uniqueItems } : {}) };
    case 'enum': return { ...requiredness, ...presentation, placement: field.placement, type: field.type, values: normalizeEnumValues(field.values), ...(field.playwrightTag !== undefined ? { playwrightTag: field.playwrightTag } : {}) };
    case 'integer-enum': return { ...requiredness, ...presentation, placement: field.placement, type: field.type, values: normalizeEnumValues(field.values) };
    case 'text': return { ...requiredness, ...presentation, placement: field.placement, type: field.type };
    case 'text-list': return { ...requiredness, ...presentation, placement: field.placement, type: field.type, ...(field.minItems !== undefined ? { minItems: field.minItems } : {}), ...(field.uniqueItems !== undefined ? { uniqueItems: field.uniqueItems } : {}) };
  }
};

const normalizeFieldRules = (fields: z.infer<typeof RulesShape>['case']['fields']): Readonly<Record<string, FieldRule>> => {
  const normalized: Record<string, FieldRule> = {};
  for (const [name, field] of Object.entries(fields)) normalized[name] = normalizeFieldRule(field);
  return normalized;
};

const normalizeDiscovery = (discovery: z.infer<typeof RulesShape>['discovery']): ProjectRules['discovery'] => ({
  documents: discovery.documents,
  layers: Object.entries(discovery.sources).map(([name, layer]) => ({ name, ...(layer.description !== undefined ? { description: layer.description } : {}) })),
  sources: Object.entries(discovery.sources).flatMap(([layer, sources]) => caseSources.flatMap((kind) => {
    const paths = sources[kind];
    return paths ? [{ kind, layer, paths }] : [];
  })),
});

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
  return { rules: { ...result.data, discovery: normalizeDiscovery(result.data.discovery), case: { fields: normalizeFieldRules(result.data.case.fields) } }, diagnostics: [] };
};
