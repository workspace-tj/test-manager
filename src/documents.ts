import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { documentIdSchema } from './ids.js';
import type { Diagnostic, KnowledgeDocument, ProjectRules } from './model.js';
import { diagnostic, location } from './diagnostics.js';
import { parseStrictYaml, yamlPathLine } from './yaml.js';

export const readKnowledgeDocument = async (
  file: string,
  projectRoot: string,
  rules: ProjectRules,
): Promise<Readonly<{ document?: KnowledgeDocument; diagnostics: ReadonlyArray<Diagnostic> }>> => {
  const relative = path.relative(projectRoot, file);
  const source = await readFile(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (!match) return { diagnostics: [diagnostic('TM100', relative, 'frontmatter', 'Markdown must begin with one YAML frontmatter block')] };
  const parsed = parseStrictYaml(match[1] ?? '', relative);
  if (parsed.diagnostics.length > 0) return { diagnostics: parsed.diagnostics.map((item) => ({ ...item, location: location(relative, item.location.line + 1, item.location.column) })) };
  const id = documentIdSchema(new RegExp(rules.idPattern));
  const schema = z.strictObject({
    id,
    kind: z.string().refine((kind) => rules.documents.kinds[kind] !== undefined, 'must name a configured document kind'),
    title: z.string().min(1),
    parent: id.optional(),
    refs: z.array(id).refine((items) => new Set(items).size === items.length, 'must contain unique document IDs').optional(),
  });
  const result = schema.safeParse(parsed.value);
  if (!result.success) {
    const codes: Readonly<Record<string, string>> = { id: 'TM103', kind: 'TM104', title: 'TM105', parent: 'TM106', refs: 'TM107' };
    return { diagnostics: result.error.issues.map((item) => {
      const subject = item.path.join('.') || 'frontmatter';
      const code = item.code === 'unrecognized_keys' ? 'TM102' : codes[String(item.path[0])] ?? 'TM101';
      const unknownKey = item.code === 'unrecognized_keys' ? item.keys[0] : undefined;
      const diagnosticPath = [...item.path, ...(unknownKey ? [unknownKey] : [])];
      return diagnostic(code, relative, diagnosticPath.join('.') || subject, item.message, yamlPathLine(match[1] ?? '', diagnosticPath, 1));
    }) };
  }
  const document: KnowledgeDocument = {
      id: result.data.id,
      kind: result.data.kind,
      title: result.data.title,
      ...(result.data.parent ? { parent: result.data.parent } : {}),
      ...(result.data.refs ? { refs: result.data.refs } : {}),
      body: match[2] ?? '',
      location: location(relative),
      fieldLocations: Object.fromEntries(['id', 'kind', 'title', 'parent', 'refs'].map((field) => [field, location(relative, yamlPathLine(match[1] ?? '', [field], 1), 1)])),
  };
  return { document, diagnostics: [] };
};

export const validateDocumentGraph = (
  documents: ReadonlyArray<KnowledgeDocument>,
  rules: ProjectRules,
): ReadonlyArray<Diagnostic> => {
  const diagnostics: Diagnostic[] = [];
  const at = (code: string, document: KnowledgeDocument, subject: string, reason: string): Diagnostic => {
    const fieldLocation = document.fieldLocations?.[subject] ?? document.location;
    return diagnostic(code, document.location.file, subject, reason, fieldLocation.line, fieldLocation.column);
  };
  const byId = new Map<string, KnowledgeDocument>();
  for (const document of documents) {
    const duplicate = byId.get(document.id);
    if (duplicate) diagnostics.push(at('TM110', document, 'id', `duplicate document ID; first declared in ${duplicate.location.file}`));
    else byId.set(document.id, document);
  }
  for (const document of documents) {
    const rule = rules.documents.kinds[document.kind];
    if (!rule) continue;
    if (rule.parent.required && !document.parent) diagnostics.push(at('TM111', document, 'parent', 'parent is required for this kind'));
    if (!document.parent) continue;
    const parent = byId.get(document.parent);
    if (!parent) diagnostics.push(at('TM112', document, 'parent', `reference ${document.parent} does not exist`));
    else if (!rule.parent.targetKinds.includes(parent.kind)) diagnostics.push(at('TM113', document, 'parent', `target ${document.parent} has disallowed kind ${parent.kind}`));
  }
  for (const document of documents) {
    for (const reference of document.refs ?? []) if (!byId.has(reference)) diagnostics.push(at('TM115', document, 'refs', `reference ${reference} does not exist`));
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (document: KnowledgeDocument, chain: ReadonlyArray<string>): void => {
    if (state.get(document.id) === 'done') return;
    if (state.get(document.id) === 'visiting') {
      diagnostics.push(at('TM114', document, 'parent', `parent cycle: ${[...chain, document.id].join(' -> ')}`));
      return;
    }
    state.set(document.id, 'visiting');
    const parent = document.parent ? byId.get(document.parent) : undefined;
    if (parent) visit(parent, [...chain, document.id]);
    state.set(document.id, 'done');
  };
  for (const document of documents) visit(document, []);
  return diagnostics;
};

export const validateDocumentDisplayOrder = (
  documents: ReadonlyArray<KnowledgeDocument>,
  rules: ProjectRules,
  configFile: string,
): ReadonlyArray<Diagnostic> => {
  const byId = new Map<string, KnowledgeDocument>(documents.map((document) => [document.id, document]));
  const diagnostics: Diagnostic[] = [];
  for (const [kind, ids] of Object.entries(rules.documents.displayOrder)) {
    const subject = `documents.displayOrder.${kind}`;
    for (const id of ids) {
      const document = byId.get(id);
      if (!document) diagnostics.push(diagnostic('TM116', configFile, subject, `document ${id} does not exist`));
      else if (document.kind !== kind) diagnostics.push(diagnostic('TM117', configFile, subject, `document ${id} has kind ${document.kind}`));
    }
  }
  return diagnostics;
};

export const sortDocumentsForDisplay = (
  documents: ReadonlyArray<KnowledgeDocument>,
  rules: ProjectRules,
): ReadonlyArray<KnowledgeDocument> => {
  const displayRanks = new Map(Object.entries(rules.documents.displayOrder).map(([kind, ids]) => [
    kind,
    new Map(ids.map((id, index) => [id, index])),
  ]));
  const kindRanks = new Map(Object.keys(rules.documents.kinds).map((kind, index) => [kind, index]));
  return [...documents].sort((left, right) => {
    if (left.kind !== right.kind) return (kindRanks.get(left.kind) ?? Number.MAX_SAFE_INTEGER) - (kindRanks.get(right.kind) ?? Number.MAX_SAFE_INTEGER);
    const ranks = displayRanks.get(left.kind);
    const rankDifference = (ranks?.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (ranks?.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference !== 0) return rankDifference;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
};
