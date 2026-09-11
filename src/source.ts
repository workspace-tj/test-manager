import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import { z } from 'zod';
import { caseIdSchema } from './ids.js';
import { parseCaseFields, partitionCaseFields } from './case-fields.js';
import type { Diagnostic, KnowledgeDocument, Location, ManagedCase, ProjectRules, SourceKind } from './model.js';
import { diagnostic, location } from './diagnostics.js';
import { isRecord, parseStrictYaml } from './yaml.js';
import { yamlPathLine } from './yaml.js';

type Comment = t.CommentBlock | t.CommentLine;

const traverse = traverseModule;

const commentLines = (comment: Comment): ReadonlyArray<string> => comment.value
  .split(/\r?\n/u)
  .map((line) => line.replace(/^\s*\* ?/u, ''));

const markerYaml = (
  comment: Comment | undefined,
  marker: '@case' | '@case-doc',
  file: string,
  allowedKeys: ReadonlyArray<string>,
  placementCode: 'TM207' | 'TM208',
): Readonly<{ found: boolean; value?: Record<string, unknown>; location?: Location; fieldLocations?: Readonly<Record<string, Location>>; diagnostics: ReadonlyArray<Diagnostic> }> => {
  if (!comment) return { found: false, diagnostics: [] };
  const lines = commentLines(comment);
  const markerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (markerIndex < 0 || lines[markerIndex]?.trim() !== marker) return { found: false, diagnostics: [] };
  const markerLine = (comment.loc?.start.line ?? 1) + markerIndex;
  const markerLocation = location(file, markerLine, 1);
  const yamlSource = lines.slice(markerIndex + 1).join('\n').trimEnd();
  const parsed = parseStrictYaml(yamlSource, file);
  if (parsed.diagnostics.length > 0) {
    return {
      found: true,
      location: markerLocation,
      diagnostics: parsed.diagnostics.map((item) => ({ ...item, location: location(file, markerLine + item.location.line, item.location.column) })),
    };
  }
  if (!isRecord(parsed.value)) return { found: true, location: markerLocation, diagnostics: [diagnostic('TM201', file, marker, 'comment body must be a YAML mapping', markerLine)] };
  const shape: Record<string, z.ZodType> = {};
  for (const key of allowedKeys) shape[key] = z.unknown().optional();
  const placement = z.strictObject(shape).safeParse(parsed.value);
  if (!placement.success) {
    return {
      found: true,
      location: markerLocation,
      diagnostics: placement.error.issues.map((item) => {
        const key = item.code === 'unrecognized_keys' ? item.keys[0] : item.path[0];
        const subject = String(key ?? marker);
        return diagnostic(placementCode, file, subject, `${String(key ?? 'field')} is not allowed in ${marker}`, markerLine + yamlPathLine(yamlSource, [subject]));
      }),
    };
  }
  const fieldLocations = Object.fromEntries(Object.keys(placement.data).map((key) => [key, location(file, markerLine + yamlPathLine(yamlSource, [key]), 1)]));
  return { found: true, value: placement.data, location: markerLocation, fieldLocations, diagnostics: [] };
};

const immediateComment = (node: t.Node): Comment | undefined => {
  const comments = node.leadingComments;
  const comment = comments?.[comments.length - 1];
  if (!comment?.loc || !node.loc || comment.loc.end.line + 1 !== node.loc.start.line) return undefined;
  return comment;
};

const memberName = (node: t.Node | null | undefined): string | undefined => {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    const base = memberName(node.object);
    return base ? `${base}.${node.property.name}` : undefined;
  }
  return undefined;
};

const stringValue = (node: t.Node | null | undefined): string | undefined =>
  t.isStringLiteral(node) ? node.value : t.isTemplateLiteral(node) && node.expressions.length === 0 ? node.quasis[0]?.value.cooked ?? undefined : undefined;

const objectProperty = (object: t.ObjectExpression, name: string): t.ObjectProperty | undefined =>
  object.properties.find((property): property is t.ObjectProperty =>
    t.isObjectProperty(property) && !property.computed &&
    ((t.isIdentifier(property.key) && property.key.name === name) || (t.isStringLiteral(property.key) && property.key.value === name)));

const ambiguousObject = (object: t.ObjectExpression): boolean => {
  const keys = new Set<string>();
  for (const property of object.properties) {
    if (!t.isObjectProperty(property) || property.computed) return true;
    const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) || t.isNumericLiteral(property.key) ? String(property.key.value) : undefined;
    if (key === undefined || keys.has(key)) return true;
    keys.add(key);
  }
  return false;
};

type ExtractedId = Readonly<{ id?: string; invalidMultiplicity: boolean; unsupportedShape?: boolean }>;

const extractVitestId = (call: t.CallExpression): ExtractedId => {
  const options = call.arguments[1];
  if (!t.isObjectExpression(options)) return { invalidMultiplicity: false };
  const meta = objectProperty(options, 'meta')?.value;
  if (!t.isObjectExpression(meta)) return { invalidMultiplicity: false };
  const unsupportedShape = ambiguousObject(options) || ambiguousObject(meta);
  const current = meta.properties.filter((property) => t.isObjectProperty(property) && !property.computed && ((t.isIdentifier(property.key) && property.key.name === 'caseId') || (t.isStringLiteral(property.key) && property.key.value === 'caseId')));
  const legacy = meta.properties.some((property) => t.isObjectProperty(property) && !property.computed && ((t.isIdentifier(property.key) && property.key.name === 'caseIds') || (t.isStringLiteral(property.key) && property.key.value === 'caseIds')));
  const id = current.length === 1 && t.isObjectProperty(current[0]) ? stringValue(current[0].value) : undefined;
  return { ...(id !== undefined ? { id } : {}), invalidMultiplicity: legacy || current.length > 1, ...(unsupportedShape ? { unsupportedShape: true } : {}) };
};

const extractPlaywrightId = (call: t.CallExpression): ExtractedId => {
  const options = call.arguments[1];
  if (!t.isObjectExpression(options)) return { invalidMultiplicity: false };
  const annotationProperties = options.properties.filter((property) => t.isObjectProperty(property) && !property.computed && ((t.isIdentifier(property.key) && property.key.name === 'annotation') || (t.isStringLiteral(property.key) && property.key.value === 'annotation')));
  const annotation = annotationProperties.length === 1 && t.isObjectProperty(annotationProperties[0]) ? annotationProperties[0].value : undefined;
  let unsupportedShape = ambiguousObject(options) || (t.isArrayExpression(annotation) && annotation.elements.some((item) => t.isSpreadElement(item)));
  const annotations = t.isArrayExpression(annotation) ? annotation.elements : [annotation];
  const ids: string[] = [];
  let occurrences = 0;
  for (const item of annotations) {
    if (!t.isObjectExpression(item)) continue;
    if (ambiguousObject(item)) unsupportedShape = true;
    const type = stringValue(objectProperty(item, 'type')?.value);
    const description = stringValue(objectProperty(item, 'description')?.value);
    if (type === 'case-id') {
      occurrences += 1;
      if (description !== undefined) ids.push(description);
    }
  }
  const id = ids.length === 1 ? ids[0] : undefined;
  return { ...(id !== undefined ? { id } : {}), invalidMultiplicity: annotationProperties.length > 1 || occurrences > 1, ...(unsupportedShape ? { unsupportedShape: true } : {}) };
};

const hasLegacyStoryId = (story: t.ObjectExpression): boolean => {
  const parameters = objectProperty(story, 'parameters')?.value;
  if (!t.isObjectExpression(parameters)) return false;
  const manager = objectProperty(parameters, 'testManager')?.value;
  return t.isObjectExpression(manager) && (objectProperty(manager, 'caseId') !== undefined || objectProperty(manager, 'caseIds') !== undefined);
};

const allowedDeclaration = (name: string, importedTests: ReadonlySet<string>, kind: Exclude<SourceKind, 'storybook'>, each: boolean): boolean => {
  const [root, ...modifiers] = name.split('.');
  if (!root || !importedTests.has(root)) return false;
  const expectedModifiers = each ? modifiers.slice(0, -1) : modifiers;
  if (each && modifiers[modifiers.length - 1] !== 'each') return false;
  const allowed = kind === 'vitest'
    ? new Set(['skip', 'todo', 'only', 'concurrent', 'fails'])
    : new Set(['skip', 'fixme', 'only', 'fail']);
  return expectedModifiers.every((modifier) => allowed.has(modifier));
};

const staticValue = (node: t.Node | null | undefined): Readonly<{ ok: true; value: unknown } | { ok: false }> => {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) return { ok: true, value: node.value };
  if (t.isNullLiteral(node)) return { ok: true, value: null };
  if (t.isUnaryExpression(node) && (node.operator === '-' || node.operator === '+') && t.isNumericLiteral(node.argument)) return { ok: true, value: node.operator === '-' ? -node.argument.value : node.argument.value };
  if (t.isArrayExpression(node)) {
    const values: unknown[] = [];
    for (const item of node.elements) {
      if (!item || t.isSpreadElement(item)) return { ok: false };
      const parsed = staticValue(item);
      if (!parsed.ok) return parsed;
      values.push(parsed.value);
    }
    return { ok: true, value: values };
  }
  if (t.isObjectExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed) return { ok: false };
      const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) || t.isNumericLiteral(property.key) ? String(property.key.value) : undefined;
      const parsed = staticValue(property.value);
      if (key === undefined || !parsed.ok) return { ok: false };
      value[key] = parsed.value;
    }
    return { ok: true, value };
  }
  return { ok: false };
};

const callShape = (call: t.CallExpression, importedTests: ReadonlySet<string>, kind: Exclude<SourceKind, 'storybook'>): Readonly<{ declaration?: string; parameters?: ReadonlyArray<unknown>; dynamicEach?: boolean }> => {
  const direct = memberName(call.callee);
  if (direct && !direct.endsWith('.each') && allowedDeclaration(direct, importedTests, kind, false)) {
    const hasCallback = call.arguments.some((argument) => t.isArrowFunctionExpression(argument) || t.isFunctionExpression(argument));
    if (!hasCallback && !(kind === 'vitest' && direct.split('.').includes('todo'))) return {};
    return { declaration: direct };
  }
  if (t.isTaggedTemplateExpression(call.callee)) {
    const taggedName = memberName(call.callee.tag);
    if (taggedName && allowedDeclaration(taggedName, importedTests, kind, true)) return { declaration: taggedName, dynamicEach: true };
  }
  if (!t.isCallExpression(call.callee)) return {};
  const eachName = memberName(call.callee.callee);
  if (!eachName || !allowedDeclaration(eachName, importedTests, kind, true)) return {};
  const table = call.callee.arguments[0];
  if (!t.isArrayExpression(table)) return { declaration: eachName, dynamicEach: true };
  const parameters: unknown[] = [];
  for (const entry of table.elements) {
    const parsed = staticValue(entry);
    if (!parsed.ok) return { declaration: eachName, dynamicEach: true };
    parameters.push(parsed.value);
  }
  return { declaration: eachName, parameters };
};

const isRunnerImportBinding = (callPath: NodePath<t.CallExpression>, declaration: string, kind: Exclude<SourceKind, 'storybook'>): boolean => {
  const root = declaration.split('.')[0];
  if (!root) return false;
  const binding = callPath.scope.getBinding(root);
  if (!binding?.path.isImportSpecifier()) return false;
  const importedName = binding.path.node.imported;
  const name = t.isIdentifier(importedName) ? importedName.name : importedName.value;
  const parent = binding.path.parentPath;
  const expected = kind === 'vitest' ? 'vitest' : '@playwright/test';
  return (name === 'test' || name === 'it') && parent?.isImportDeclaration() === true && parent.node.source.value === expected;
};

const firstBodyComment = (call: t.CallExpression): Comment | undefined => {
  const callback = call.arguments.find((argument) => t.isArrowFunctionExpression(argument) || t.isFunctionExpression(argument));
  if (!callback || !t.isBlockStatement(callback.body)) return undefined;
  const first = callback.body.body[0];
  if (first) return immediateComment(first);
  return callback.body.innerComments?.[0];
};

const parseSource = (source: string, file: string): Readonly<{ ast?: t.File; diagnostics: ReadonlyArray<Diagnostic> }> => {
  try {
    return { ast: parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false }), diagnostics: [] };
  } catch (error) {
    const at = isRecord(error) && isRecord(error.loc) ? error.loc : undefined;
    return { diagnostics: [diagnostic('TM200', file, 'source', String(error), typeof at?.line === 'number' ? at.line : 1, typeof at?.column === 'number' ? at.column + 1 : 1)] };
  }
};

const markerFieldLocations = (marker: Readonly<{ fieldLocations?: Readonly<Record<string, Location>> }>): Readonly<Record<string, Location>> => marker.fieldLocations ?? {};

export const readTestSource = async (
  file: string,
  projectRoot: string,
  kind: SourceKind,
  rules: ProjectRules,
  documents: ReadonlyArray<KnowledgeDocument>,
): Promise<Readonly<{ cases: ReadonlyArray<ManagedCase>; diagnostics: ReadonlyArray<Diagnostic> }>> => {
  const relative = path.relative(projectRoot, file);
  const source = await readFile(file, 'utf8');
  const parsed = parseSource(source, relative);
  if (!parsed.ast) return { cases: [], diagnostics: parsed.diagnostics };
  const cases: ManagedCase[] = [];
  const diagnostics: Diagnostic[] = [...parsed.diagnostics];
  const imported = new Set<string>();
  traverse(parsed.ast, {
    ImportDeclaration(importPath: NodePath<t.ImportDeclaration>) {
      const expected = kind === 'vitest' ? 'vitest' : kind === 'playwright' ? '@playwright/test' : undefined;
      if (expected && importPath.node.source.value === expected) {
        for (const specifier of importPath.node.specifiers) {
          if (!t.isImportSpecifier(specifier)) continue;
          const importedName = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
          if (importedName === 'test' || importedName === 'it') imported.add(specifier.local.name);
        }
      }
    },
  });
  if (kind !== 'storybook') {
    const detailKeys = Object.entries(rules.case.fields).filter(([, rule]) => rule.placement === 'detail').map(([key]) => key);
    const classificationKeys = Object.entries(rules.case.fields).filter(([, rule]) => rule.placement === 'classification').map(([key]) => key);
    traverse(parsed.ast, {
      CallExpression(callPath: NodePath<t.CallExpression>) {
        const call = callPath.node;
        const shape = callShape(call, imported, kind);
        if (!shape.declaration || !isRunnerImportBinding(callPath, shape.declaration, kind)) {
          const statement = t.isExpressionStatement(callPath.parent) ? callPath.parent : undefined;
          const unsupported = statement ? markerYaml(immediateComment(statement), '@case', relative, Object.keys(rules.case.fields), 'TM207') : { found: false };
          if (unsupported.found) diagnostics.push(diagnostic('TM203', relative, 'declaration', 'marked declaration uses an unsupported runner syntax or wrapper', call.loc?.start.line ?? 1));
          return;
        }
        const title = stringValue(call.arguments[0]);
        const line = call.loc?.start.line ?? 1;
        if (!title) {
          diagnostics.push(diagnostic('TM202', relative, 'title', 'managed test title must be a static string', line));
          return;
        }
        if (shape.dynamicEach) diagnostics.push(diagnostic('TM203', relative, title, 'each table must be an inline array literal', line));
        const commentNode = t.isExpressionStatement(callPath.parent) ? callPath.parent : call;
        const before = markerYaml(immediateComment(commentNode), '@case', relative, classificationKeys, 'TM207');
        diagnostics.push(...before.diagnostics);
        if (!before.found) diagnostics.push(diagnostic('TM204', relative, title, 'managed test requires an immediately preceding @case comment', line));
        const details = markerYaml(firstBodyComment(call), '@case-doc', relative, detailKeys, 'TM208');
        diagnostics.push(...details.diagnostics);
        const extractedId = kind === 'vitest' ? extractVitestId(call) : extractPlaywrightId(call);
        const rawId = extractedId.id;
        if (extractedId.invalidMultiplicity) diagnostics.push(diagnostic('TM209', relative, title, 'a declaration must contain exactly one current case ID field', line));
        if (extractedId.unsupportedShape) diagnostics.push(diagnostic('TM210', relative, title, 'case ID metadata must not use spreads or computed properties', line));
        if (!rawId) diagnostics.push(diagnostic('TM205', relative, title, kind === 'vitest' ? 'meta.caseId is required in the declaration options' : 'annotation { type: case-id, description: ID } is required in declaration options', line));
        const id = caseIdSchema(new RegExp(rules.idPattern)).safeParse(rawId);
        if (rawId && !id.success) diagnostics.push(diagnostic('TM206', relative, rawId, 'case ID does not match idPattern', line));
        if (!before.value || (details.found && !details.value) || !id.success || shape.dynamicEach || extractedId.invalidMultiplicity || extractedId.unsupportedShape) return;
        const fields = parseCaseFields({ ...before.value, ...details.value }, rules.case.fields, documents, new RegExp(rules.idPattern), relative, before.location, { ...markerFieldLocations(before), ...markerFieldLocations(details) });
        if (!fields.ok) {
          diagnostics.push(...fields.diagnostics);
          return;
        }
        const endLine = call.loc?.end.line ?? line;
        const separated = partitionCaseFields(fields.fields, rules.case.fields);
        const base = { id: id.data, title, fields: separated.classification, details: separated.details, location: location(relative, line), snippet: source.split(/\r?\n/u).slice(line - 1, endLine).join('\n') };
        const skipped = shape.declaration.includes('.skip') || shape.declaration.includes('.fixme');
        if (kind === 'vitest') cases.push({ ...base, source: 'vitest', status: shape.declaration.includes('.todo') ? 'todo' : skipped ? 'skip' : 'active', ...(shape.parameters ? { parameters: shape.parameters } : {}) });
        else cases.push({ ...base, source: 'playwright', status: skipped ? 'skip' : 'active' });
      },
    });
  } else {
    const detailKeys = Object.entries(rules.case.fields).filter(([, rule]) => rule.placement === 'detail').map(([key]) => key);
    const classificationKeys = Object.entries(rules.case.fields).filter(([, rule]) => rule.placement === 'classification').map(([key]) => key);
    traverse(parsed.ast, {
      ExportNamedDeclaration(exportPath: NodePath<t.ExportNamedDeclaration>) {
        const declaration = exportPath.node.declaration;
        if (!t.isVariableDeclaration(declaration)) return;
        for (const variable of declaration.declarations) {
          if (!t.isIdentifier(variable.id)) continue;
          if (!t.isObjectExpression(variable.init)) {
            const marker = markerYaml(immediateComment(exportPath.node) ?? immediateComment(declaration), '@case', relative, Object.keys(rules.case.fields), 'TM207');
            if (marker.found) diagnostics.push(diagnostic('TM222', relative, variable.id.name, 'marked Story must use an object literal', variable.loc?.start.line ?? 1));
            continue;
          }
          const before = markerYaml(immediateComment(exportPath.node) ?? immediateComment(declaration), '@case', relative, classificationKeys, 'TM207');
          const nameProperty = objectProperty(variable.init, 'name');
          const rawName = stringValue(nameProperty?.value);
          if (!rawName) {
            if (!before.found) continue;
            diagnostics.push(...before.diagnostics);
            diagnostics.push(diagnostic('TM220', relative, variable.id.name, 'managed Story must have an explicit static name with [CASE-ID] prefix', variable.loc?.start.line ?? 1));
            continue;
          }
          const nameMatch = /^\[([^\]]+)\]\s+(.+)$/u.exec(rawName);
          if (!nameMatch) {
            if (!before.found) continue;
            diagnostics.push(diagnostic('TM221', relative, variable.id.name, 'Story name must begin with [CASE-ID] followed by a display name', variable.loc?.start.line ?? 1));
            continue;
          }
          diagnostics.push(...before.diagnostics);
          const ambiguous = ambiguousObject(variable.init);
          if (ambiguous) diagnostics.push(diagnostic('TM223', relative, variable.id.name, 'Story object must not use spreads, computed properties, or duplicate keys', variable.loc?.start.line ?? 1));
          if (hasLegacyStoryId(variable.init)) diagnostics.push(diagnostic('TM209', relative, variable.id.name, 'Story case ID must appear only in the name prefix', variable.loc?.start.line ?? 1));
          if (!before.found) diagnostics.push(diagnostic('TM204', relative, rawName, 'managed Story requires an immediately preceding @case comment', variable.loc?.start.line ?? 1));
          const firstProperty = variable.init.properties.find((property) => t.isObjectProperty(property));
          const details = markerYaml(firstProperty ? immediateComment(firstProperty) : undefined, '@case-doc', relative, detailKeys, 'TM208');
          diagnostics.push(...details.diagnostics);
          const rawId = nameMatch[1] ?? '';
          const id = caseIdSchema(new RegExp(rules.idPattern)).safeParse(rawId);
          if (!id.success) diagnostics.push(diagnostic('TM206', relative, rawId, 'case ID does not match idPattern', variable.loc?.start.line ?? 1));
          if (!before.value || (details.found && !details.value) || !id.success || hasLegacyStoryId(variable.init) || ambiguous) continue;
          const fields = parseCaseFields({ ...before.value, ...details.value }, rules.case.fields, documents, new RegExp(rules.idPattern), relative, before.location, { ...markerFieldLocations(before), ...markerFieldLocations(details) });
          if (!fields.ok) {
            diagnostics.push(...fields.diagnostics);
            continue;
          }
          const tags = objectProperty(variable.init, 'tags')?.value;
          const skipped = t.isArrayExpression(tags) && tags.elements.some((tag) => stringValue(tag) === 'skip-test');
          const separated = partitionCaseFields(fields.fields, rules.case.fields);
          cases.push({ id: id.data, title: nameMatch[2] ?? rawName, source: 'storybook', status: skipped ? 'skip' : 'active', fields: separated.classification, details: separated.details, location: location(relative, variable.loc?.start.line ?? 1), snippet: source.split(/\r?\n/u).slice((variable.loc?.start.line ?? 1) - 1, variable.loc?.end.line ?? variable.loc?.start.line ?? 1).join('\n') });
        }
      },
    });
  }
  return { cases, diagnostics };
};
