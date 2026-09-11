import { z } from 'zod';
import { documentIdSchema } from './ids.js';
import type { CaseFields, Diagnostic, FieldRule, KnowledgeDocument, Location } from './model.js';
import { diagnostic } from './diagnostics.js';

type ParsedCaseFields = Readonly<
  | { ok: true; fields: CaseFields }
  | { ok: false; diagnostics: ReadonlyArray<Diagnostic> }
>;

const issue = (code: string, message: string): Readonly<{ message: string }> => ({ message: `${code} ${message}` });

const schemaFor = (rule: FieldRule, idPattern: RegExp): z.ZodType => {
  switch (rule.type) {
    case 'reference':
      return documentIdSchema(idPattern);
    case 'reference-list': {
      let schema: z.ZodType = z.array(documentIdSchema(idPattern));
      const minItems = rule.minItems;
      if (minItems !== undefined) schema = schema.refine((items) => Array.isArray(items) && items.length >= minItems, issue('TM124', `requires at least ${minItems} item(s)`));
      if (rule.uniqueItems) schema = schema.refine((items) => Array.isArray(items) && new Set(items).size === items.length, issue('TM125', 'duplicate items are not allowed'));
      return schema;
    }
    case 'enum':
      return z.string().refine((value) => rule.values !== undefined && value in rule.values, issue('TM123', 'value is not allowed'));
    case 'integer-enum':
      return z.number().int().refine((value) => rule.values !== undefined && String(value) in rule.values, issue('TM123', 'value is not allowed'));
    case 'text':
      return z.string();
    case 'text-list': {
      let schema: z.ZodType = z.array(z.string());
      const minItems = rule.minItems;
      if (minItems !== undefined) schema = schema.refine((items) => Array.isArray(items) && items.length >= minItems, issue('TM124', `requires at least ${minItems} item(s)`));
      if (rule.uniqueItems) schema = schema.refine((items) => Array.isArray(items) && new Set(items).size === items.length, issue('TM125', 'duplicate items are not allowed'));
      return schema;
    }
  }
};

const diagnosticCode = (item: z.core.$ZodIssue): string => {
  const prefixed = /^(TM\d+)\s/u.exec(item.message)?.[1];
  if (prefixed) return prefixed;
  if (item.code === 'unrecognized_keys') return 'TM120';
  return item.input === undefined ? 'TM121' : 'TM122';
};

const diagnosticReason = (item: z.core.$ZodIssue): string => item.message.replace(/^TM\d+\s/u, '');

export const parseCaseFields = (
  input: unknown,
  rules: Readonly<Record<string, FieldRule>>,
  documents: ReadonlyArray<KnowledgeDocument>,
  idPattern: RegExp,
  file: string,
  baseLocation?: Location,
  fieldLocations?: Readonly<Record<string, Location>>,
): ParsedCaseFields => {
  const at = (code: string, subject: string, reason: string): Diagnostic => {
    const fieldLocation = fieldLocations?.[subject.split('.')[0] ?? ''] ?? baseLocation;
    return diagnostic(code, file, subject, reason, fieldLocation?.line ?? 1, fieldLocation?.column ?? 1);
  };
  const shape: Record<string, z.ZodType> = {};
  for (const [name, rule] of Object.entries(rules)) shape[name] = rule.required ? schemaFor(rule, idPattern) : schemaFor(rule, idPattern).optional();
  const schema = z.strictObject(shape).superRefine((fields, context) => {
    for (const [name, rule] of Object.entries(rules)) {
      if (rule.requiredWhen && fields[name] === undefined && fields[rule.requiredWhen.field] === rule.requiredWhen.equals) {
        context.addIssue({ code: 'custom', path: [name], message: `TM121 required when ${rule.requiredWhen.field} equals ${JSON.stringify(rule.requiredWhen.equals)}` });
      }
    }
  });
  const parsed = schema.safeParse(input, { reportInput: true });
  if (!parsed.success) {
    return { ok: false, diagnostics: parsed.error.issues.map((item) => at(diagnosticCode(item), item.path.join('.') || 'case', diagnosticReason(item))) };
  }
  const owner = documentIdSchema(idPattern).safeParse(parsed.data.owner);
  if (!owner.success) return { ok: false, diagnostics: [at('TM121', 'owner', 'owner must be configured as a required reference field')] };
  const refs = parsed.data.refs === undefined ? undefined : z.array(documentIdSchema(idPattern)).safeParse(parsed.data.refs);
  if (refs !== undefined && !refs.success) return { ok: false, diagnostics: [at('TM122', 'refs', 'refs must be configured as a reference-list field')] };
  const fields: CaseFields = { ...parsed.data, owner: owner.data, ...(refs?.success ? { refs: refs.data } : {}) };
  const knownDocuments = new Map(documents.map((document) => [document.id, document]));
  const diagnostics: Diagnostic[] = [];
  for (const [name, rule] of Object.entries(rules)) {
    const value = fields[name];
    const references = rule.type === 'reference' && typeof value === 'string' ? [value] : rule.type === 'reference-list' && Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    for (const reference of references) {
      const referenceId = documentIdSchema(idPattern).safeParse(reference);
      if (!referenceId.success) continue;
      const target = knownDocuments.get(referenceId.data);
      if (!target) diagnostics.push(at('TM126', name, `reference ${reference} does not exist`));
      else if ((rule.type === 'reference' || rule.type === 'reference-list') && !rule.targetKinds.includes(target.kind)) diagnostics.push(at('TM127', name, `reference ${reference} has disallowed kind ${target.kind}`));
    }
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, fields };
};

export const validateCaseFields = (
  fields: unknown,
  rules: Readonly<Record<string, FieldRule>>,
  documents: ReadonlyArray<KnowledgeDocument>,
  file: string,
): ReadonlyArray<Diagnostic> => {
  const parsed = parseCaseFields(fields, rules, documents, /.*/u, file);
  return parsed.ok ? [] : parsed.diagnostics;
};

export const partitionCaseFields = (
  fields: CaseFields,
  rules: Readonly<Record<string, FieldRule>>,
): Readonly<{ classification: CaseFields; details: Readonly<Record<string, unknown>> }> => {
  const classification: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) (rules[name]?.placement === 'detail' ? details : classification)[name] = value;
  return { classification: classification as CaseFields, details };
};
