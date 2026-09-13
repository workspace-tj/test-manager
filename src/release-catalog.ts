import { z } from 'zod';
import type { Catalog, ManagedCase } from './model.js';

const CommitSchema = z.string().regex(/^[0-9a-f]{7,64}$/u);
const IdentifierSchema = z.string().min(1);
const fieldsSchema = z.object({ belongsTo: IdentifierSchema, refs: z.array(IdentifierSchema).optional() }).catchall(z.unknown());
const caseBase = {
  id: IdentifierSchema,
  title: z.string().min(1),
  fields: fieldsSchema,
  details: z.record(z.string(), z.unknown()),
};
const releaseCaseSchema = z.discriminatedUnion('source', [
  z.strictObject({ ...caseBase, source: z.literal('manual'), status: z.literal('active'), procedure: z.array(z.strictObject({ action: z.string(), expected: z.string() })) }),
  z.strictObject({ ...caseBase, source: z.literal('vitest'), status: z.enum(['active', 'skip', 'todo']), parameters: z.array(z.unknown()).optional() }),
  z.strictObject({ ...caseBase, source: z.literal('playwright'), status: z.enum(['active', 'skip']) }),
  z.strictObject({ ...caseBase, source: z.literal('storybook'), status: z.enum(['active', 'skip']) }),
]);

const snapshotShape = z.strictObject({
  schemaVersion: z.literal(1),
  commit: CommitSchema,
  idPattern: z.string().min(1),
  documents: z.array(z.strictObject({
    id: IdentifierSchema, kind: z.string().min(1), title: z.string().min(1), parent: IdentifierSchema.optional(),
  })),
  cases: z.array(releaseCaseSchema),
});

export type ReleaseCatalogSnapshot = z.infer<typeof snapshotShape>;
export type ReleaseCatalogCase = ReleaseCatalogSnapshot['cases'][number];

const semanticCase = (managedCase: ManagedCase): ReleaseCatalogCase => {
  const { refs, ...fieldsWithoutRefs } = managedCase.fields;
  const base = {
    id: managedCase.id,
    title: managedCase.title,
    fields: { ...fieldsWithoutRefs, ...(refs === undefined ? {} : { refs: [...refs] }) },
    details: { ...managedCase.details },
  };
  switch (managedCase.source) {
    case 'manual': return { ...base, source: managedCase.source, status: managedCase.status, procedure: managedCase.procedure.map((step) => ({ ...step })) };
    case 'vitest': return { ...base, source: managedCase.source, status: managedCase.status, ...(managedCase.parameters === undefined ? {} : { parameters: [...managedCase.parameters] }) };
    case 'playwright': return { ...base, source: managedCase.source, status: managedCase.status };
    case 'storybook': return { ...base, source: managedCase.source, status: managedCase.status };
  }
};

export const createReleaseCatalogSnapshot = (catalog: Catalog, commit: string): ReleaseCatalogSnapshot => snapshotShape.parse({
  schemaVersion: 1,
  commit,
  idPattern: catalog.rules.idPattern,
  documents: catalog.documents.map((document) => ({
    id: document.id, kind: document.kind, title: document.title, ...(document.parent === undefined ? {} : { parent: document.parent }),
  })),
  cases: catalog.cases.map(semanticCase),
});

export const parseReleaseCatalogSnapshot = (input: unknown) => snapshotShape.superRefine((snapshot, context) => {
  let idPattern: RegExp;
  try { idPattern = new RegExp(snapshot.idPattern, 'u'); } catch {
    context.addIssue({ code: 'custom', path: ['idPattern'], message: 'idPattern must be a valid regular expression' });
    return;
  }
  const documentIds = new Set(snapshot.documents.map((document) => document.id));
  if (documentIds.size !== snapshot.documents.length) context.addIssue({ code: 'custom', path: ['documents'], message: 'document IDs must be unique' });
  const caseIds = new Set(snapshot.cases.map((managedCase) => managedCase.id));
  if (caseIds.size !== snapshot.cases.length) context.addIssue({ code: 'custom', path: ['cases'], message: 'case IDs must be unique' });
  for (const id of caseIds) if (documentIds.has(id)) context.addIssue({ code: 'custom', path: ['cases'], message: `case ID ${id} collides with a document ID` });
  const documentsById = new Map(snapshot.documents.map((document) => [document.id, document]));
  for (const [index, document] of snapshot.documents.entries()) {
    if (!idPattern.test(document.id)) context.addIssue({ code: 'custom', path: ['documents', index, 'id'], message: 'document ID does not match idPattern' });
    if (document.parent !== undefined && !documentIds.has(document.parent)) context.addIssue({ code: 'custom', path: ['documents', index, 'parent'], message: 'parent document is missing' });
    const visited = new Set<string>();
    let current: typeof document | undefined = document;
    while (current) {
      if (visited.has(current.id)) {
        context.addIssue({ code: 'custom', path: ['documents', index, 'parent'], message: 'document parent graph must be acyclic' });
        break;
      }
      visited.add(current.id);
      current = current.parent === undefined ? undefined : documentsById.get(current.parent);
    }
  }
  for (const [index, managedCase] of snapshot.cases.entries()) {
    if (!idPattern.test(managedCase.id)) context.addIssue({ code: 'custom', path: ['cases', index, 'id'], message: 'case ID does not match idPattern' });
    if (!documentIds.has(managedCase.fields.belongsTo)) context.addIssue({ code: 'custom', path: ['cases', index, 'fields', 'belongsTo'], message: 'membership document is missing' });
  }
}).safeParse(input);
