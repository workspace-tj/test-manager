import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { caseIdSchema } from './ids.js';
import { parseCaseFields, partitionCaseFields } from './case-fields.js';
import type { Diagnostic, KnowledgeDocument, ManagedCase, ProjectRules } from './model.js';
import { diagnostic, location } from './diagnostics.js';
import { isRecord, parseStrictYaml, yamlPathLine } from './yaml.js';

const fieldLine = (source: string, subject: string): number => {
  return yamlPathLine(source, subject.split('.').map((part) => /^\d+$/u.test(part) ? Number(part) : part));
};

export const readManualCase = async (
  file: string,
  projectRoot: string,
  rules: ProjectRules,
  documents: ReadonlyArray<KnowledgeDocument>,
): Promise<Readonly<{ managedCase?: ManagedCase; diagnostics: ReadonlyArray<Diagnostic> }>> => {
  const relative = path.relative(projectRoot, file);
  const source = await readFile(file, 'utf8');
  const parsed = parseStrictYaml(source, relative);
  if (parsed.diagnostics.length > 0) return { diagnostics: parsed.diagnostics };
  if (!isRecord(parsed.value)) return { diagnostics: [diagnostic('TM130', relative, 'manual case', 'expected one case mapping per file')] };
  const { id, title, steps, ...fields } = parsed.value;
  const fixed = z.strictObject({
    id: caseIdSchema(new RegExp(rules.idPattern)),
    title: z.string().min(1),
    steps: z.array(z.strictObject({ action: z.string().min(1), expected: z.string().min(1) })).min(1),
  }).safeParse({ id, title, steps });
  if (!fixed.success) {
    const codes: Readonly<Record<string, string>> = { id: 'TM132', title: 'TM133', steps: 'TM134' };
    return { diagnostics: fixed.error.issues.map((item) => {
      const subject = item.path.join('.') || 'manual case';
      return diagnostic(codes[String(item.path[0])] ?? 'TM130', relative, subject, item.message, fieldLine(source, subject));
    }) };
  }
  const parsedFields = parseCaseFields(fields, rules.case.fields, documents, new RegExp(rules.idPattern), relative);
  if (!parsedFields.ok) return { diagnostics: parsedFields.diagnostics.map((item) => ({ ...item, location: location(relative, fieldLine(source, item.subject), 1) })) };
  const separated = partitionCaseFields(parsedFields.fields, rules.case.fields);
  return { managedCase: { id: fixed.data.id, title: fixed.data.title, source: 'manual', status: 'active', fields: separated.classification, details: separated.details, procedure: fixed.data.steps, location: location(relative), snippet: source }, diagnostics: [] };
};
